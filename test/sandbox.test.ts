import assert from "node:assert/strict";
import test from "node:test";
import { effectiveSandbox, parseSandboxMode, SANDBOX_MODES } from "../src/sandbox.js";
import { threadStoreFromJson } from "../src/thread-store.js";
import { CodexAppServerClient } from "../src/codex-app-server.js";

await test("sandbox choices are validated and bounded by the service maximum", () => {
  for (const maximum of SANDBOX_MODES) {
    assert.equal(effectiveSandbox(undefined, maximum), maximum);
    for (const selected of SANDBOX_MODES) {
      assert.equal(effectiveSandbox(selected, maximum), SANDBOX_MODES[Math.min(SANDBOX_MODES.indexOf(selected), SANDBOX_MODES.indexOf(maximum))]);
    }
  }
  assert.equal(parseSandboxMode(null), null);
  assert.equal(parseSandboxMode("invalid"), null);
  assert.throws(() => effectiveSandbox(undefined, "invalid"), /Unsupported service sandbox/);
});

await test("stored sandbox survives decoding and invalid values are rejected", () => {
  assert.deepEqual(threadStoreFromJson({ chat: { sandbox: "read-only", threadId: "existing" } }), { chat: { sandbox: "read-only", threadId: "existing" } });
  assert.throws(() => threadStoreFromJson({ chat: { sandbox: "invalid" } }), /Invalid stored sandbox/);
});

await test("start, resume and fork pass bounded conversation permissions to Codex", async () => {
  const client = new CodexAppServerClient({ sandbox: "workspace-write" });
  const calls: unknown[] = [];
  client.request = async (method, params) => {
    calls.push({ method, params });
    return { thread: { id: "existing" } };
  };
  await client.createThread({ settings: { sandbox: "read-only" } });
  client.invalidateLoadedThread("existing");
  assert.equal(client.isThreadLoaded("existing"), false);
  await client.resumeThread("existing", { settings: { sandbox: "read-only" } });
  assert.equal(client.isThreadLoaded("existing"), true);
  await client.forkThread("existing", { sandbox: "danger-full-access" });
  assert.ok(calls.length === 3);
  const serialized = JSON.stringify(calls);
  assert.match(serialized, /thread\/start.*"sandbox":"read-only"/);
  assert.match(serialized, /thread\/resume.*"sandbox":"read-only"/);
  assert.match(serialized, /thread\/fork.*"sandbox":"workspace-write"/);
});
