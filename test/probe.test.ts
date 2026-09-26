import assert from "node:assert/strict";
import test from "node:test";
import { CodexAppServerClient } from "../src/codex-app-server.js";
import { runProbe } from "../scripts/probe-app-server.js";

await test("probe closes the client and clears deadlines after a successful turn", async (t) => {
  t.mock.method(CodexAppServerClient.prototype, "connect", async () => {});
  t.mock.method(CodexAppServerClient.prototype, "createThread", async () => ({ id: "probe" }));
  t.mock.method(CodexAppServerClient.prototype, "sendTurn", async () => ({ text: "PONG", commentary: "" }));
  const close = t.mock.method(CodexAppServerClient.prototype, "close", async () => {});
  const clear = t.mock.method(globalThis, "clearTimeout");
  assert.equal((await runProbe({ deadlineMs: 10 })).text, "PONG");
  assert.equal(close.mock.callCount(), 1);
  assert.equal(clear.mock.callCount(), 3);
});

await test("probe deadlines reject stalled connections and still close the client", async (t) => {
  t.mock.method(CodexAppServerClient.prototype, "connect", () => new Promise<void>(() => {}));
  const close = t.mock.method(CodexAppServerClient.prototype, "close", async () => {});
  await assert.rejects(runProbe({ deadlineMs: 5 }), /connect timeout/);
  assert.equal(close.mock.callCount(), 1);
});
