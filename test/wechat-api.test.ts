import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import { temporaryData } from "./helpers.js";
import { downloadImageAttachment, showTypingIndicator } from "../src/wechat-api.js";
import { extractContent, getUpdates, normalizeWechatText, sendTextMessage, fetchQrCode, pollQrStatus } from "../src/wechat-api.js";

const account = { token: "test-token", baseUrl: "https://wechat.invalid", accountId: "test", savedAt: "test" };

await test("polling carries the cursor and token and validates returned messages", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://wechat.invalid/ilink/bot/getupdates");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
    assert.equal(JSON.parse(String(init?.body)).get_updates_buf, "previous");
    return Response.json({ ret: 0, msgs: [{ message_type: 1, from_user_id: "sender" }], get_updates_buf: "next" });
  });
  const result = await getUpdates(account, "previous");
  assert.equal(result.get_updates_buf, "next");
  assert.equal(result.msgs?.[0].from_user_id, "sender");
});

await test("image attachments decrypt into a local image and typing uses the returned ticket", async (t) => {
  const outputDir = temporaryData(t);
  const key = Buffer.alloc(16, 7);
  const image = Buffer.from("89504e470d0a1a0a", "hex");
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  const encrypted = Buffer.concat([cipher.update(image), cipher.final()]);
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/image")) return new Response(encrypted);
    if (url.endsWith("/getconfig")) return Response.json({ typing_ticket: "ticket" });
    assert.equal(JSON.parse(String(init?.body)).typing_ticket, "ticket");
    return Response.json({ ret: 0 });
  });
  const file = await downloadImageAttachment({ mediaItem: { cdn_url: "https://novac2c.cdn.weixin.qq.com/image", aes_key: key.toString("base64") }, outputDir, fileStem: "attachment" });
  assert.ok(file);
  assert.ok(file.endsWith(".png"));
  assert.deepEqual(fs.readFileSync(file), image);
  await showTypingIndicator(account, "recipient", "context");
  assert.ok(requests.some((url) => url.endsWith("/sendtyping")));
});

await test("media extraction retains descriptions and skips empty text", () => {
  assert.equal(extractContent({ item_list: [{ type: 1, text_item: { text: " " } }, { type: 2, image_item: { width: 4, height: 5 } }] })?.text, "[图片 (4x5)]");
  assert.equal(extractContent({ item_list: [{ type: 4, file_item: { file_name: "sample.pdf" } }] })?.text, "[文件 sample.pdf]");
  assert.equal(extractContent({ item_list: [{ type: 5, video_item: { duration_ms: 1500 } }] })?.text, "[视频 1.5s]");
  assert.equal(extractContent({ item_list: [{ type: 5, video_item: { play_length: 2500 } }] })?.text, "[视频 2.5s]");
  assert.equal(extractContent({ item_list: [{ type: 99 }] })?.msgType, "unknown");
});

await test("message validation retains nested media references and video metadata", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    ret: 0,
    msgs: [{ item_list: [{
      type: 4,
      file_item: {
        media: {
          encrypt_query_param: "encrypted-file",
          aes_key: "key-base64",
          full_url: "https://cdn.weixin.qq.com/file",
        },
        file_name: "notes.txt",
        len: "12",
      },
    }, {
      type: 5,
      video_item: { play_length: 4000, video_size: 2048, thumb_media: { full_url: "https://cdn.weixin.qq.com/thumb" } },
    }] }],
  }));
  const result = await getUpdates(account, "");
  assert.deepEqual(result.msgs?.[0].item_list?.[0].file_item?.media, {
    encrypt_query_param: "encrypted-file",
    aes_key: "key-base64",
    full_url: "https://cdn.weixin.qq.com/file",
  });
  assert.equal(result.msgs?.[0].item_list?.[0].file_item?.len, "12");
  assert.equal(result.msgs?.[0].item_list?.[1].video_item?.play_length, 4000);
  assert.equal(result.msgs?.[0].item_list?.[1].video_item?.thumb_media?.full_url, "https://cdn.weixin.qq.com/thumb");
});

await test("a long-poll timeout preserves the current cursor", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new DOMException("timeout", "TimeoutError"); });
  assert.deepEqual(await getUpdates(account, "previous"), { ret: 0, msgs: [], get_updates_buf: "previous" });
});

await test("send requests include routing context and propagate HTTP failures", async (t) => {
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.msg.to_user_id, "recipient");
    assert.equal(payload.msg.context_token, "context");
    assert.equal(payload.msg.item_list[0].text_item.text, "reply");
    return new Response("unavailable", { status: 503 });
  });
  await assert.rejects(sendTextMessage(account, "recipient", "reply", "context"), /HTTP 503/);
});

await test("QR response validation rejects invalid fields and status timeout keeps waiting", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ qrcode: 42 }));
  await assert.rejects(fetchQrCode("https://wechat.invalid"), /Expected a string/);
  fetch.mock.mockImplementation(async () => { throw new DOMException("timeout", "TimeoutError"); });
  assert.deepEqual(await pollQrStatus("https://wechat.invalid", "qr"), { status: "wait" });
});

await test("content extraction keeps quotes and transcription while normalizing reply markup", () => {
  assert.equal(extractContent({ item_list: [{ type: 1, text_item: { text: " hello " }, ref_msg: { title: "prior" } }] })?.text, "[引用] prior\nhello");
  assert.equal(extractContent({ item_list: [{ type: 3, voice_item: { text: "voice" } }] })?.text, "[语音转写]\nvoice");
  assert.equal(extractContent({ item_list: [] }), null);
  assert.equal(normalizeWechatText("```js\r\nconst x = `value`;\r\n```"), "const x = value;");
});
