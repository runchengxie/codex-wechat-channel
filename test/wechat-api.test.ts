import assert from "node:assert/strict";
import test from "node:test";
import { extractContent, getUpdates, normalizeWechatText, sendTextMessage, fetchQrCode, pollQrStatus } from "../src/wechat-api.js";

const account = { token: "test-token", baseUrl: "https://wechat.invalid", accountId: "test", savedAt: "test" };

test("polling carries the cursor and token and validates returned messages", async (t) => {
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

test("a long-poll timeout preserves the current cursor", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new DOMException("timeout", "TimeoutError"); });
  assert.deepEqual(await getUpdates(account, "previous"), { ret: 0, msgs: [], get_updates_buf: "previous" });
});

test("send requests include routing context and propagate HTTP failures", async (t) => {
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.msg.to_user_id, "recipient");
    assert.equal(payload.msg.context_token, "context");
    assert.equal(payload.msg.item_list[0].text_item.text, "reply");
    return new Response("unavailable", { status: 503 });
  });
  await assert.rejects(sendTextMessage(account, "recipient", "reply", "context"), /HTTP 503/);
});

test("QR response validation rejects invalid fields and status timeout keeps waiting", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ qrcode: 42 }));
  await assert.rejects(fetchQrCode("https://wechat.invalid"), /Expected a string/);
  fetch.mock.mockImplementation(async () => { throw new DOMException("timeout", "TimeoutError"); });
  assert.deepEqual(await pollQrStatus("https://wechat.invalid", "qr"), { status: "wait" });
});

test("content extraction keeps quotes and transcription while normalizing reply markup", () => {
  assert.equal(extractContent({ item_list: [{ type: 1, text_item: { text: " hello " }, ref_msg: { title: "prior" } }] })?.text, "[引用] prior\nhello");
  assert.equal(extractContent({ item_list: [{ type: 3, voice_item: { text: "voice" } }] })?.text, "[语音转写]\nvoice");
  assert.equal(extractContent({ item_list: [] }), null);
  assert.equal(normalizeWechatText("```js\r\nconst x = `value`;\r\n```"), "const x = value;");
});
