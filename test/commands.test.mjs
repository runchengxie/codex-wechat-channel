import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseWechatCommand, runWechatCommand } from "../src/commands.mjs";

function fakeClient() {
  return {
    options: { model: "gpt-6-sol", sandbox: "read-only", cwd: "/tmp" },
    async listModels() {
      return [
        { model: "gpt-6-luna", supportedReasoningEfforts: [{ reasoningEffort: "medium" }] },
        { model: "gpt-6-sol", supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }] },
      ];
    },
    async compactThread() {},
    async forkThread() { return { id: "forked-thread" }; },
  };
}

test("slash parser recognizes commands and rejects unsupported names", () => {
  assert.deepEqual(parseWechatCommand("/model luna"), { name: "model", argument: "luna", original: "model" });
  assert.deepEqual(parseWechatCommand("/plan"), { name: "unsupported", argument: null, original: "plan" });
  assert.equal(parseWechatCommand("hello"), null);
  assert.equal(parseWechatCommand("//model luna"), null);
});

test("model and effort are stored per conversation and survive /new", async () => {
  const client = fakeClient();
  const threadStore = { first: { threadId: "old-thread" }, second: { threadId: "other-thread" } };
  const run = (conversationKey, text) => runWechatCommand({ command: parseWechatCommand(text), client, threadStore, conversationKey });

  assert.match(await run("first", "/model luna"), /gpt-6-luna/);
  assert.equal(threadStore.first.model, "gpt-6-luna");
  assert.equal(threadStore.second.model, undefined);
  assert.match(await run("first", "/effort high"), /supports: medium/);
  assert.equal(threadStore.first.effort, undefined);
  assert.match(await run("first", "/effort medium"), /set to medium/);
  await run("first", "/new");
  assert.equal(threadStore.first.threadId, undefined);
  assert.equal(threadStore.first.history[0].threadId, "old-thread");
  assert.equal(threadStore.first.model, "gpt-6-luna");
  assert.equal(threadStore.first.effort, "medium");
  assert.match(await run("first", "/resume old-thread"), /Resumed thread/);
  assert.equal(threadStore.first.threadId, "old-thread");
});

test("compact and fork use the current thread, and permissions do not escalate", async () => {
  const client = fakeClient();
  const calls = [];
  client.compactThread = async (threadId) => calls.push(["compact", threadId]);
  client.forkThread = async (threadId, settings) => {
    calls.push(["fork", threadId, settings.sandbox]);
    return { id: "forked-thread" };
  };
  const threadStore = { first: { threadId: "old-thread" } };
  const run = (text) => runWechatCommand({ command: parseWechatCommand(text), client, threadStore, conversationKey: "first" });

  await run("/compact");
  await run("/fork");
  assert.deepEqual(calls, [["compact", "old-thread"], ["fork", "old-thread", "read-only"]]);
  assert.equal(threadStore.first.threadId, "forked-thread");
  assert.match(await run("/permissions danger-full-access"), /read-only/);
  assert.equal(threadStore.first.sandbox, undefined);
});

test("switching models clears an unsupported effort", async () => {
  const client = fakeClient();
  const threadStore = { first: { model: "gpt-6-sol", effort: "high" } };
  const response = await runWechatCommand({ command: parseWechatCommand("/model luna"), client, threadStore, conversationKey: "first" });
  assert.match(response, /effort was reset/);
  assert.equal(threadStore.first.model, "gpt-6-luna");
  assert.equal(threadStore.first.effort, null);
});

test("cwd accepts a Git worktree below the bridge root and rejects traversal", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-cwd-"));
  const root = path.join(base, "root");
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  try {
    const client = fakeClient();
    client.options.cwd = root;
    const threadStore = { first: { threadId: "old-thread" } };
    const run = (text) => runWechatCommand({ command: parseWechatCommand(text), client, threadStore, conversationKey: "first" });
    assert.match(await run("/cwd ../"), /Choose a Git worktree under/);
    assert.match(await run("/cwd repo"), /Working directory set/);
    assert.equal(threadStore.first.cwd, repo);
    assert.equal(threadStore.first.threadId, undefined);
    assert.equal(threadStore.first.history[0].threadId, "old-thread");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
