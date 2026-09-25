import assert from "node:assert/strict";
import test from "node:test";

import { CodexAppServerClient } from "../src/codex-app-server.mjs";

test("compaction waits for completion notification", async () => {
  const client = new CodexAppServerClient();
  client.request = async (method) => {
    assert.equal(method, "thread/compact/start");
    return {};
  };
  let finished = false;
  const compacting = client.compactThread("thread-1").then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  client.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "unrelated-turn", status: "completed" } });
  await Promise.resolve();
  assert.equal(finished, false);
  client.handleNotification("item/started", { threadId: "thread-1", turnId: "compact-1", item: { type: "contextCompaction" } });
  client.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "compact-1", status: "completed" } });
  await compacting;
  assert.equal(finished, true);
});

test("review collects its final message and ignores unrelated turn starts", async () => {
  const client = new CodexAppServerClient();
  client.request = async (method) => {
    assert.equal(method, "review/start");
    return { turn: { id: "review-1" } };
  };
  const reviewing = client.reviewThread("thread-1");
  await Promise.resolve();
  client.handleNotification("turn/started", { turn: { id: "unrelated" } });
  assert.equal(client.turnWaiters.has("unrelated"), false);
  client.handleNotification("item/completed", { turnId: "review-1", item: { type: "agentMessage", phase: "final_answer", text: "Review done" } });
  client.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "review-1", status: "completed" } });
  assert.equal((await reviewing).text, "Review done");
});

test("a failed turn completed before its RPC response still fails", async () => {
  const client = new CodexAppServerClient();
  client.request = async () => {
    client.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "failed", error: { message: "model unavailable" } } });
    return { turn: { id: "turn-1" } };
  };
  await assert.rejects(client.sendTurn("thread-1", []), /model unavailable/);
});
