import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { downloadAndDecryptMedia } from "./wechat-api.js";
import type { MediaItem } from "./wechat-types.js";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json"]);
const MAX_TEXT_CHARS = 100_000;
const MAX_VIDEO_DURATION_SECONDS = 180;
const MAX_VIDEO_FRAMES = 6;

export interface VideoFrameResult {
  paths: string[];
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
      "-v", "error", "-select_streams", "v:0", "-show_entries", "format=duration", "-of", "json", inputPath,
    ], 15_000);
    const probe = JSON.parse(probeOutput) as { format?: { duration?: string } };
    const duration = Number(probe.format?.duration);
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
    return { paths, cleanup: () => fs.rm(workDir, { recursive: true, force: true }) };
  } catch (error) {
    await fs.rm(workDir, { recursive: true, force: true });
    throw error;
  }
}
