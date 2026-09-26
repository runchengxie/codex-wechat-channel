import assert from "node:assert/strict";
import test from "node:test";
import { CodexAppServerClient } from "../src/codex-app-server.js";
import { processMessage, runStart } from "../src/start.js";
import fs from "node:fs";
import { PATHS } from "../src/constants.js";
import { temporaryData } from "./helpers.js";
import { processUpdateBatch } from "../src/update-batch.js";
import type { WechatMessage } from "../src/wechat-types.js";
import type { ThreadStore } from "../src/thread-store.js";

const account = { token: "test-token", baseUrl: "https://wechat.invalid", accountId: "test", savedAt: "test" };
const message: WechatMessage = {
  message_type: 1,
  from_user_id: "sender",
  item_list: [{ type: 1, text_item: { text: "hello" } }],
};

for (const nextInput of ["hello", "/review"]) {
await test(`permission changes apply to restored historical threads before ${nextInput}`, async (t) => {
  temporaryData(t);
  const client = new CodexAppServerClient({ sandbox: "danger-full-access" });
  client.loadedThreads.add("existing");
  client.loadedThreads.add("current");
  t.mock.method(client, "connect", async () => {});
  const requests: string[] = [];
  t.mock.method(client, "request", async (method: string, params: unknown) => {
    requests.push(JSON.stringify({ method, params }));
    return { thread: { id: "existing" } };
  });
  t.mock.method(client, "sendTurn", async (threadId: string) => {
    assert.equal(threadId, "existing");
    assert.match(requests[0], /thread\/resume.*"sandbox":"read-only"/);
    return { text: "answer", commentary: "" };
  });
  t.mock.method(client, "reviewThread", async (threadId: string) => {
    assert.equal(threadId, "existing");
    assert.match(requests[0], /thread\/resume.*"sandbox":"read-only"/);
    return { text: "review", commentary: "" };
  });
  t.mock.method(globalThis, "fetch", async () => Response.json({ ret: 0 }));
  const threadStore: ThreadStore = { sender: { threadId: "current", history: [{ threadId: "existing", name: null, cwd: process.cwd() }] } };
  const context = { account, client, threadStore, contextTokens: new Map([["sender", "context"]]), allowedUsers: new Set<string>() };
  await processMessage({ ...context, message: { ...message, item_list: [{ type: 1, text_item: { text: "/permissions read-only" } }] } });
  assert.equal(client.isThreadLoaded("current"), false);
  assert.match(fs.readFileSync(PATHS.threads, "utf8"), /"sandbox": "read-only"/);
  await processMessage({ ...context, message: { ...message, item_list: [{ type: 1, text_item: { text: "/resume existing" } }] } });
  assert.equal(client.isThreadLoaded("existing"), false);
  await processMessage({ ...context, message: { ...message, item_list: [{ type: 1, text_item: { text: nextInput } }] } });
  assert.equal(threadStore.sender.threadId, "existing");
  assert.equal(client.isThreadLoaded("existing"), true);
});
}

await test("the message pipeline rejects unlisted senders before connecting or sending", async (t) => {
  const client = new CodexAppServerClient();
  const connect = t.mock.method(client, "connect", async () => assert.fail("must not connect"));
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("must not send"));
  await processMessage({ account, client, message, contextTokens: new Map(), threadStore: {}, allowedUsers: new Set(["allowed"]) });
  assert.equal(connect.mock.callCount(), 0);
  assert.equal(fetch.mock.callCount(), 0);
});

for (const delivered of [true, false]) {
  await test(`the real failure-notice pipeline ${delivered ? "advances" : "holds"} the cursor`, async (t) => {
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

await test("normal messages create and persist threads, reuse context, and send replies", async (t) => {
  temporaryData(t);
  const client = new CodexAppServerClient();
  t.mock.method(client, "connect", async () => {});
  t.mock.method(client, "createThread", async () => ({ id: "thread" }));
  t.mock.method(client, "sendTurn", async (threadId: string) => {
    assert.equal(threadId, "thread");
    return { text: "`answer`", commentary: "" };
  });
  const sent: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/getconfig")) return Response.json({});
    sent.push(String(init?.body));
    return Response.json({ ret: 0 });
  });
  const contextTokens = new Map<string, string>();
  const threadStore = {};
  await processMessage({ account, client, contextTokens, threadStore, allowedUsers: new Set(),
    message: { ...message, group_id: "group", context_token: "context" } });
  assert.equal(contextTokens.get("group"), "context");
  assert.equal(contextTokens.get("sender"), "context");
  assert.match(fs.readFileSync(PATHS.threads, "utf8"), /"threadId": "thread"/);
  assert.match(sent[0], /answer/);
  assert.doesNotMatch(sent[0], /`answer`/);
});

await test("startup loads saved state, polls and persists the cursor, then handles shutdown", async (t) => {
  temporaryData(t);
  fs.writeFileSync(PATHS.account, JSON.stringify(account));
  fs.writeFileSync(PATHS.contextTokens, JSON.stringify({ sender: "context" }));
  const originalInt = new Set(process.listeners("SIGINT"));
  const originalTerm = new Set(process.listeners("SIGTERM"));
  t.after(() => {
    for (const listener of process.listeners("SIGINT")) if (!originalInt.has(listener)) process.removeListener("SIGINT", listener);
    for (const listener of process.listeners("SIGTERM")) if (!originalTerm.has(listener)) process.removeListener("SIGTERM", listener);
  });
  t.mock.method(CodexAppServerClient.prototype, "connect", async () => {});
  const close = t.mock.method(CodexAppServerClient.prototype, "close", async () => {});
  const exit = t.mock.method(process, "exit", () => {});
  let polls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    polls += 1;
    if (polls === 2) process.emit("SIGINT");
    return Response.json({ ret: 0, msgs: [], get_updates_buf: `cursor-${polls}` });
  });
  await runStart({ cwd: process.cwd() });
  assert.equal(polls, 2);
  assert.equal(fs.readFileSync(PATHS.syncBuf, "utf8"), "cursor-2");
  assert.equal(close.mock.callCount(), 1);
  assert.equal(exit.mock.callCount(), 1);
});
