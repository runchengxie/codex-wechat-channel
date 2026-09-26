import assert from "node:assert/strict";
import test from "node:test";
import { CodexAppServerClient } from "../src/codex-app-server.js";
import { processMessage } from "../src/start.js";
import { processUpdateBatch } from "../src/update-batch.js";
import type { WechatMessage } from "../src/wechat-types.js";

const account = { token: "test-token", baseUrl: "https://wechat.invalid", accountId: "test", savedAt: "test" };
const message: WechatMessage = {
  message_type: 1,
  from_user_id: "sender",
  item_list: [{ type: 1, text_item: { text: "hello" } }],
};

test("the message pipeline rejects unlisted senders before connecting or sending", async (t) => {
  const client = new CodexAppServerClient();
  const connect = t.mock.method(client, "connect", async () => assert.fail("must not connect"));
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("must not send"));
  await processMessage({ account, client, message, contextTokens: new Map(), threadStore: {}, allowedUsers: new Set(["allowed"]) });
  assert.equal(connect.mock.callCount(), 0);
  assert.equal(fetch.mock.callCount(), 0);
});

for (const delivered of [true, false]) {
  test(`the real failure-notice pipeline ${delivered ? "advances" : "holds"} the cursor`, async (t) => {
    const client = new CodexAppServerClient();
    t.mock.method(client, "connect", async () => { throw new Error("Codex unavailable"); });
    const sent: unknown[] = [];
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/getconfig")) return Response.json({});
      assert.ok(url.endsWith("/sendmessage"));
      sent.push(JSON.parse(String(init?.body)));
      return delivered ? Response.json({ ret: 0 }) : new Response("send failed", { status: 503 });
    });
    const saved: string[] = [];
    const processing = processUpdateBatch({
      response: { msgs: [message], get_updates_buf: "next" },
      dispatch: (incoming) => processMessage({
        account, client, message: incoming,
        contextTokens: new Map([["sender", "context"]]), threadStore: {}, allowedUsers: new Set(),
      }),
      saveCursor: (cursor) => { saved.push(cursor); },
    });
    if (delivered) await processing;
    else await assert.rejects(processing, /update message task failed/);
    assert.deepEqual(saved, delivered ? ["next"] : []);
    assert.equal(sent.length, 1);
    assert.match(JSON.stringify(sent), /Codex unavailable/);
  });
}
