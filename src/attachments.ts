import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { object } from "./protocol.js";
import { downloadAndDecryptMedia } from "./wechat-api.js";
import type { MediaItem } from "./wechat-types.js";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json"]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx"]);
const MAX_TEXT_CHARS = 100_000;
const MAX_PDF_PAGES = 100;
const MAX_VIDEO_DURATION_SECONDS = 180;
const MAX_VIDEO_FRAMES = 6;
const MAX_VIDEO_AUDIO_BYTES = 8 * 1024 * 1024;

export interface VideoFrameResult {
  paths: string[];
  audioPath?: string;
  audioError?: string;
  cleanup: () => Promise<void>;
}

export type MediaCommandRunner = (command: string, args: string[], timeoutMs: number) => Promise<string>;

function runMediaCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 }, (error, stdout) => {
      if (error) {
        reject(new Error(`${command} failed`));
        return;
      }
      resolve(stdout);
    });
  });
}

function textFileName(mediaItem: MediaItem) {
  const supplied = (mediaItem.file_name ?? "attachment").replaceAll("\\", "/").split("/").at(-1) ?? "attachment";
  return supplied.replace(/[\u0000-\u001f]/g, "").slice(0, 160) || "attachment";
}

export async function extractTextAttachment(mediaItem: MediaItem): Promise<{ fileName: string; text: string } | null> {
  const fileName = textFileName(mediaItem);
  if (!TEXT_EXTENSIONS.has(path.extname(fileName).toLowerCase())) return null;
  const buffer = await downloadAndDecryptMedia(mediaItem);
  if (!buffer) throw new Error("Attachment download information is incomplete");

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  } catch {
    throw new Error("Text attachment is not valid UTF-8");
  }
  if (text.includes("\0")) throw new Error("Text attachment contains binary data");
  if (text.length > MAX_TEXT_CHARS) {
    text = `${text.slice(0, MAX_TEXT_CHARS)}\n[文件内容过长，已截断]`;
  }
  return { fileName, text };
}

function boundedText(text: string) {
  return text.length > MAX_TEXT_CHARS
    ? `${text.slice(0, MAX_TEXT_CHARS)}\n[文件内容过长，已截断]`
    : text;
}

async function extractPdfText(buffer: Buffer) {
  const document = await getDocument({
    data: Uint8Array.from(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  try {
    const pageLimit = Math.min(document.numPages, MAX_PDF_PAGES);
    const pages: string[] = [];
    let remaining = MAX_TEXT_CHARS;
    let truncated = false;
    for (let pageNumber = 1; pageNumber <= pageLimit && remaining > 0; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => "str" in item && typeof item.str === "string" ? item.str : "")
        .filter(Boolean)
        .join(" ");
      const fragment = pageText.slice(0, remaining);
      if (fragment) pages.push(fragment);
      if (fragment.length < pageText.length) truncated = true;
      remaining -= fragment.length;
    }
    if (remaining === 0) truncated = true;
    let text = pages.join("\n");
    if (truncated && text.length === MAX_TEXT_CHARS) text += "\n[文件内容过长，已截断]";
    if (document.numPages > pageLimit && text.length < MAX_TEXT_CHARS) {
      text += "\n[页数过多，仅提取前 100 页]";
    }
    return boundedText(text);
  } finally {
    await document.destroy();
  }
}

export async function extractDocumentAttachment(mediaItem: MediaItem): Promise<{ fileName: string; text: string } | null> {
  const fileName = textFileName(mediaItem);
  const extension = path.extname(fileName).toLowerCase();
  if (!DOCUMENT_EXTENSIONS.has(extension)) return null;
  const buffer = await downloadAndDecryptMedia(mediaItem);
  if (!buffer) throw new Error("Attachment download information is incomplete");

  if (extension === ".pdf") return { fileName, text: await extractPdfText(buffer) };
  const result = await mammoth.extractRawText({ buffer });
  return { fileName, text: boundedText(result.value.trim()) };
}

export async function extractVideoFrames(
  mediaItem: MediaItem,
  outputDir: string,
  runCommand: MediaCommandRunner = runMediaCommand,
): Promise<VideoFrameResult> {
  const buffer = await downloadAndDecryptMedia(mediaItem);
  if (!buffer) throw new Error("Video download information is incomplete");
  await fs.mkdir(outputDir, { recursive: true });
  const workDir = await fs.mkdtemp(path.join(outputDir, ".video-"));
  const inputPath = path.join(workDir, "input.media");
  const framePattern = path.join(workDir, "frame-%02d.jpg");
  try {
    await fs.writeFile(inputPath, buffer, { mode: 0o600 });
    const probeOutput = await runCommand("ffprobe", [
      "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", inputPath,
    ], 15_000);
    const probe = object(JSON.parse(probeOutput));
    const format = probe.format === undefined ? {} : object(probe.format);
    const duration = typeof format.duration === "string" ? Number(format.duration) : Number.NaN;
    const streams = Array.isArray(probe.streams) ? probe.streams.map(object) : [];
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_DURATION_SECONDS) {
      throw new Error("Video duration must be between 0 and 180 seconds");
    }
    const framesPerSecond = Math.min(1, MAX_VIDEO_FRAMES / duration);
    await runCommand("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-i", inputPath,
      "-map", "0:v:0", "-an", "-sn", "-dn",
      "-vf", `fps=${framesPerSecond},scale=768:768:force_original_aspect_ratio=decrease`,
      "-frames:v", String(MAX_VIDEO_FRAMES), "-q:v", "5", "-y", framePattern,
    ], 30_000);
    const paths = (await fs.readdir(workDir))
      .filter((name) => /^frame-\d{2}\.jpg$/.test(name))
      .sort()
      .map((name) => path.join(workDir, name));
    if (paths.length === 0) throw new Error("Video did not contain readable frames");
    let audioPath: string | undefined;
    let audioError: string | undefined;
    if (streams.some((stream) => stream.codec_type === "audio")) {
      audioPath = path.join(workDir, "audio.mp3");
      try {
        await runCommand("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-nostdin", "-i", inputPath,
          "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-t", String(MAX_VIDEO_DURATION_SECONDS),
          "-fs", String(MAX_VIDEO_AUDIO_BYTES), "-y", audioPath,
        ], 30_000);
        const audio = await fs.stat(audioPath);
        if (audio.size === 0 || audio.size > MAX_VIDEO_AUDIO_BYTES) throw new Error("Invalid extracted audio size");
      } catch {
        await fs.rm(audioPath, { force: true });
        audioPath = undefined;
        audioError = "Video audio could not be extracted";
      }
    }
    return { paths, ...(audioPath ? { audioPath } : {}), ...(audioError ? { audioError } : {}), cleanup: () => fs.rm(workDir, { recursive: true, force: true }) };
  } catch (error) {
    await fs.rm(workDir, { recursive: true, force: true });
    throw error;
  }
}
