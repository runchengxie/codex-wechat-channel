import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { extractTextAttachment, extractVideoFrames } from "../src/attachments.js";
import { temporaryData } from "./helpers.js";

function encrypt(data: Buffer, key: Buffer) {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(data), cipher.final()]);
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
