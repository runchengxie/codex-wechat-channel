import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { extractDocumentAttachment, extractTextAttachment, extractVideoFrames } from "../src/attachments.js";
import { temporaryData } from "./helpers.js";

function encrypt(data: Buffer, key: Buffer) {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function makePdf(text: string) {
  const textOperators = text.match(/.{1,100}/g)?.map((chunk) => `(${chunk}) Tj`).join(" ") ?? "";
  const fontSize = text.length > 500 ? 0.001 : 12;
  const stream = `BT /F1 ${fontSize} Tf 72 720 Td ${textOperators} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, "0")} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(document);
}

await test("text attachments are decrypted from the WeChat CDN reference and decode UTF-8", async (t) => {
  const key = Buffer.alloc(16, 9);
  const encrypted = encrypt(Buffer.from("你好\n"), key);
  let requestedUrl = "";
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return new Response(encrypted);
  });
  const result = await extractTextAttachment({
    file_name: "memo.md",
    media: { encrypt_query_param: "opaque / param", aes_key: Buffer.from(key.toString("hex")).toString("base64") },
  });
  assert.equal(requestedUrl, "https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=opaque+%2F+param");
  assert.deepEqual(result, { fileName: "memo.md", text: "你好\n" });
});

await test("unsupported file types are skipped without downloading", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("unexpected"));
  assert.equal(await extractTextAttachment({ file_name: "report.pdf" }), null);
  assert.equal(fetch.mock.callCount(), 0);
});

await test("PDF attachments extract bounded page text and release the document", async (t) => {
  const key = Buffer.alloc(16, 7);
  t.mock.method(globalThis, "fetch", async () => new Response(encrypt(makePdf("PDF attachment text"), key)));
  const result = await extractDocumentAttachment({
    file_name: "report.PDF",
    media: { full_url: "https://cdn.weixin.qq.com/report", aes_key: key.toString("base64") },
  });
  assert.deepEqual(result, { fileName: "report.PDF", text: "PDF attachment text" });
});

await test("long PDF text is truncated with a marker", async (t) => {
  const key = Buffer.alloc(16, 1);
  t.mock.method(globalThis, "fetch", async () => new Response(encrypt(makePdf("a".repeat(100_001)), key)));
  const result = await extractDocumentAttachment({
    file_name: "long.pdf",
    media: { full_url: "https://cdn.weixin.qq.com/long", aes_key: key.toString("base64") },
  });
  assert.ok(result);
  assert.ok(result.text.endsWith("[文件内容过长，已截断]"));
  assert.equal(result.text.length, 100_000 + "\n[文件内容过长，已截断]".length);
});

await test("DOCX attachments extract paragraphs as plain text", async (t) => {
  const key = Buffer.alloc(16, 6);
  const fixture = await fs.readFile("test/fixtures/attachment.docx");
  t.mock.method(globalThis, "fetch", async () => new Response(encrypt(fixture, key)));
  const result = await extractDocumentAttachment({
    file_name: "notes.docx",
    media: { full_url: "https://cdn.weixin.qq.com/notes", aes_key: key.toString("base64") },
  });
  assert.deepEqual(result, { fileName: "notes.docx", text: "DOCX attachment text\n\n第二段内容" });
});

await test("legacy DOC files remain unsupported", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("unexpected"));
  assert.equal(await extractDocumentAttachment({ file_name: "legacy.doc" }), null);
  assert.equal(fetch.mock.callCount(), 0);
});

await test("oversized or non-Tencent download locations are rejected", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("small", {
    headers: { "content-length": String(26 * 1024 * 1024) },
  }));
  await assert.rejects(extractTextAttachment({
    file_name: "large.txt",
    media: { full_url: "https://cdn.weixin.qq.com/large", aes_key: Buffer.alloc(16).toString("base64") },
  }), /25 MiB/);
  await assert.rejects(extractTextAttachment({
    file_name: "local.txt",
    media: { full_url: "http://127.0.0.1/private", aes_key: Buffer.alloc(16).toString("base64") },
  }), /Unsupported media download URL/);
  assert.equal(fetch.mock.callCount(), 1);
});

await test("long text files are truncated before becoming Codex input", async (t) => {
  const key = Buffer.alloc(16, 8);
  t.mock.method(globalThis, "fetch", async () => new Response(encrypt(Buffer.alloc(100_001, 97), key)));
  const result = await extractTextAttachment({
    file_name: "long.txt",
    media: { full_url: "https://cdn.weixin.qq.com/long", aes_key: key.toString("base64") },
  });
  assert.ok(result);
  assert.equal(result.text.length, 100_000 + "\n[文件内容过长，已截断]".length);
  assert.ok(result.text.endsWith("[文件内容过长，已截断]"));
});

await test("video extraction samples at most six frames and removes temporary media", async (t) => {
  const outputDir = temporaryData(t);
  const key = Buffer.alloc(16, 3);
  const encrypted = encrypt(Buffer.from("video bytes"), key);
  t.mock.method(globalThis, "fetch", async () => new Response(encrypted));
  const commands: { command: string; args: string[] }[] = [];
  const runner = async (command: string, args: string[]) => {
    commands.push({ command, args });
    if (command === "ffprobe") return JSON.stringify({ format: { duration: "12" } });
    const pattern = args.at(-1);
    assert.ok(pattern);
    const directory = path.dirname(pattern);
    await fs.writeFile(path.join(directory, "frame-01.jpg"), "frame");
    return "";
  };
  const result = await extractVideoFrames({ media: { full_url: "https://cdn.weixin.qq.com/video", aes_key: key.toString("base64") } }, outputDir, runner);
  assert.equal(result.paths.length, 1);
  assert.equal(commands[0].command, "ffprobe");
  assert.equal(commands[1].command, "ffmpeg");
  assert.ok(commands[1].args.includes("-frames:v"));
  assert.ok(commands[1].args.includes("6"));
  assert.ok(commands[1].args.includes("fps=0.5,scale=768:768:force_original_aspect_ratio=decrease"));
  assert.ok(commands[1].args.includes("-an"));
  const workDir = path.dirname(result.paths[0]);
  await result.cleanup();
  await assert.rejects(fs.access(workDir));
});

await test("video extraction creates a bounded MP3 when an audio stream exists", async (t) => {
  const outputDir = temporaryData(t);
  const key = Buffer.alloc(16, 2);
  t.mock.method(globalThis, "fetch", async () => new Response(encrypt(Buffer.from("video bytes"), key)));
  const commands: { command: string; args: string[] }[] = [];
  const runner = async (command: string, args: string[]) => {
    commands.push({ command, args });
    if (command === "ffprobe") return JSON.stringify({ format: { duration: "12" }, streams: [{ codec_type: "audio" }] });
    const output = args.at(-1);
    assert.ok(output);
    if (output.endsWith(".jpg")) {
      await fs.writeFile(path.join(path.dirname(output), "frame-01.jpg"), "frame");
    } else {
      await fs.writeFile(output, "mp3 audio");
    }
    return "";
  };
  const result = await extractVideoFrames({ media: { full_url: "https://cdn.weixin.qq.com/video", aes_key: key.toString("base64") } }, outputDir, runner);
  assert.equal(result.audioPath && path.extname(result.audioPath), ".mp3");
  const audioCommand = commands.find(({ args }) => args.at(-1)?.endsWith(".mp3"));
  assert.ok(audioCommand);
  assert.ok(audioCommand.args.includes("-ac"));
  assert.ok(audioCommand.args.includes("-b:a"));
  assert.ok(audioCommand.args.includes("32k"));
  const workDir = path.dirname(result.paths[0]);
  await result.cleanup();
  await assert.rejects(fs.access(workDir));
});

await test("video duration limits reject long media before invoking ffmpeg", async (t) => {
  const outputDir = temporaryData(t);
  const key = Buffer.alloc(16, 4);
  t.mock.method(globalThis, "fetch", async () => new Response(encrypt(Buffer.from("video"), key)));
  const commands: string[] = [];
  const runner = async (command: string) => {
    commands.push(command);
    return JSON.stringify({ format: { duration: "181" } });
  };
  await assert.rejects(extractVideoFrames({ media: { full_url: "https://cdn.weixin.qq.com/video", aes_key: key.toString("base64") } }, outputDir, runner), /between 0 and 180 seconds/);
  assert.deepEqual(commands, ["ffprobe"]);
  assert.deepEqual(await fs.readdir(outputDir), []);
});
