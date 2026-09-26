import assert from "node:assert/strict";
import test from "node:test";

import { CodexAppServerClient } from "../src/codex-app-server.js";
import { accountFromJson, updatesFromJson } from "../src/wechat-types.js";
import { threadStoreFromJson } from "../src/thread-store.js";

test("invalid account credentials and nested message data are rejected at the boundary", () => {
  assert.throws(() => accountFromJson({ token: 42 }), /Expected a string/);
  assert.throws(() => updatesFromJson({ msgs: [{ item_list: [{ type: 1, text_item: { text: 42 } }] }] }), /Expected a string/);
  assert.throws(() => updatesFromJson({ msgs: {} }), /Expected msgs array/);
});

test("message decoding accepts unknown fields and missing optional content", () => {
  assert.deepEqual(updatesFromJson({
    ret: 0,
    msgs: [{ message_type: 1, from_user_id: "sender", future_field: true }],
    get_updates_buf: "next",
  }), { ret: 0, msgs: [{ message_type: 1, from_user_id: "sender" }], get_updates_buf: "next" });
});

test("saved thread settings and history survive validation", () => {
  const saved = { chat: { threadId: "current", model: null, effort: "high", history: [{ threadId: "older", name: "old", cwd: null }] } };
  assert.deepEqual(threadStoreFromJson(saved), saved);
  assert.throws(() => threadStoreFromJson({ chat: { history: [{ threadId: false }] } }), /Expected a string/);
});

function pendingResult(client: CodexAppServerClient, method: string) {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((resolveResult, rejectResult) => {
    resolve = resolveResult;
    reject = rejectResult;
  });
  client.pending.set("1", { method, promise, resolve, reject });
  return promise;
}

test("malformed turn responses reject the waiting request and release its entry", async () => {
  const client = new CodexAppServerClient();
  const result = pendingResult(client, "turn/start");
  client.handleMessage(JSON.stringify({ id: "1", result: { turn: { id: 7 } } }));
  await assert.rejects(result, /Expected a string/);
  assert.equal(client.pending.size, 0);
  assert.equal(client.turnWaiters.size, 0);
});

test("RPC methods with no return value accept null results", async () => {
  const client = new CodexAppServerClient();
  const result = pendingResult(client, "thread/name/set");
  client.handleMessage(JSON.stringify({ id: "1", result: null }));
  assert.equal(await result, null);
});
