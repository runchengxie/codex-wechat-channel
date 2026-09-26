import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { CodexAppServerClient } from "./codex-app-server.js";
import type { Model } from "./protocol.js";
import type { ThreadRecord, ThreadStore } from "./thread-store.js";

interface WechatCommand { name: string; argument: string | null; original: string }

const execFileAsync = promisify(execFile);
const MODEL_ALIASES = new Map([
  ["luna", "gpt-6-luna"],
  ["sol", "gpt-6-sol"],
  ["terra", "gpt-5.6-terra"],
  ["astra", "gpt-6-astra"],
]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
const COMMANDS = new Set([
  "help", "config", "status", "new", "model", "models", "effort",
  "compact", "fork", "rename", "review", "diff", "permissions", "threads", "resume", "cwd",
]);
const NO_ARGUMENT_COMMANDS = new Set(["help", "config", "status", "new", "models", "compact", "fork", "review", "diff", "threads"]);

function savedThreads(record: ThreadRecord) {
  return Array.isArray(record.history) ? record.history : [];
}

function rememberCurrentThread(record: ThreadRecord) {
  if (!record.threadId) return savedThreads(record);
  return [...savedThreads(record), { threadId: record.threadId, name: record.name || null, cwd: record.cwd || null }].slice(-20);
}

export function parseWechatCommand(text: string): WechatCommand | null {
  const trimmed = String(text ?? "").trim();
  if (trimmed.startsWith("//")) return null;
  const match = /^\/([a-z][a-z0-9-]*)(?:\s+([^\n]+))?\s*$/i.exec(trimmed);
  if (!match) return null;
  const name = match[1].toLowerCase();
  return { name: COMMANDS.has(name) ? name : "unsupported", argument: match[2]?.trim() || null, original: name };
}

export function conversationSettings(client: CodexAppServerClient, record: ThreadRecord = {}) {
  return {
    model: record.model ?? client.options.model ?? null,
    effort: record.effort ?? null,
    sandbox: client.options.sandbox,
    cwd: record.cwd || client.options.cwd,
  };
}

async function modelCatalog(client: CodexAppServerClient) {
  const result = await client.listModels();
  return result.filter((entry) => !entry.hidden);
}

function modelId(entry: Model) {
  return entry.model || entry.id;
}

async function gitSummary(cwd: string) {
  try {
    await execFileAsync("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"], { timeout: 5_000 });
  } catch {
    return null;
  }
  let hasHead = true;
  try { await execFileAsync("git", ["-C", cwd, "rev-parse", "--verify", "HEAD"], { timeout: 5_000 }); }
  catch { hasHead = false; }
  const [status, diff] = await Promise.all([
    execFileAsync("git", ["-C", cwd, "status", "--short"], { timeout: 10_000, maxBuffer: 512_000 }),
    execFileAsync("git", ["-C", cwd, "diff", "--stat", ...(hasHead ? ["HEAD"] : [])], { timeout: 10_000, maxBuffer: 512_000 }),
  ]);
  return ["Git status:", status.stdout.trim() || "clean", "", "Diff stat:", diff.stdout.trim() || "no tracked changes"].join("\n").slice(0, 3500);
}

export async function runWechatCommand({ command, client, threadStore, conversationKey }: { command: WechatCommand; client: CodexAppServerClient; threadStore: ThreadStore; conversationKey: string }): Promise<string> {
  const record = threadStore[conversationKey] || {};
  const settings = conversationSettings(client, record);
  const argument = command.argument;

  if (argument && NO_ARGUMENT_COMMANDS.has(command.name)) {
    return `Usage: /${command.name}`;
  }

  switch (command.name) {
    case "help":
      return "Commands: /model [name], /models, /effort [level], /status, /config, /cwd [repo], /new, /threads, /resume <id>, /compact, /fork, /rename <name>, /review, /diff, /permissions. Terminal-only commands are unavailable here.";
    case "unsupported":
      return `/${command.original} is not available in WeChat. Send /help for supported commands. Prefix a literal slash message with //.`;
    case "config":
    case "status":
      return `model: ${settings.model || "Codex default"}\neffort: ${settings.effort || "Codex default"}\nsandbox: ${settings.sandbox}\ncwd: ${settings.cwd}\nthread: ${record.threadId || "none"}`;
    case "permissions":
      return `sandbox: ${settings.sandbox}. Permissions are fixed by the bridge service; change its startup configuration to change this limit.`;
    case "models":
    case "model": {
      const models = await modelCatalog(client);
      if (command.name === "models" || !argument) {
        return `Available models: ${models.map(modelId).join(", ")}. Use /model <name>.`;
      }
      const selected = MODEL_ALIASES.get(argument.toLowerCase()) || argument;
      const selectedEntry = models.find((entry) => modelId(entry) === selected);
      if (!selectedEntry) {
        return `Model ${selected} is not in the available model list. Send /models to see choices.`;
      }
      const supported = selectedEntry.supportedReasoningEfforts?.map((item) => item.reasoningEffort);
      const effort = record.effort && supported?.length && !supported.includes(record.effort) ? null : record.effort;
      threadStore[conversationKey] = { ...record, model: selected, effort };
      return `Model set to ${selected} for this WeChat conversation. It applies to the next turn.${record.effort && !effort ? " Unsupported reasoning effort was reset to the model default." : ""}`;
    }
    case "effort": {
      if (!argument || !EFFORTS.has(argument.toLowerCase())) {
        return `Usage: /effort ${[...EFFORTS].join("|")}`;
      }
      const effort = argument.toLowerCase();
      const model = (await modelCatalog(client)).find((entry) => modelId(entry) === settings.model);
      const supported = model?.supportedReasoningEfforts?.map((item) => item.reasoningEffort);
      if (supported?.length && !supported.includes(effort)) {
        return `${settings.model} supports: ${supported.join(", ")}.`;
      }
      threadStore[conversationKey] = { ...record, effort };
      return `Reasoning effort set to ${effort} for this WeChat conversation.`;
    }
    case "new":
      threadStore[conversationKey] = { model: record.model, effort: record.effort, cwd: record.cwd, history: rememberCurrentThread(record) };
      return "New conversation ready. Your next message starts a fresh Codex thread.";
    case "cwd": {
      if (!argument) return `cwd: ${settings.cwd}. Use /cwd <repo-path> to select a Git worktree under ${client.options.cwd}.`;
      const root = fs.realpathSync(client.options.cwd);
      let target;
      try { target = fs.realpathSync(path.resolve(root, argument)); }
      catch { return "Directory does not exist."; }
      const relative = path.relative(root, target);
      if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
        return `Choose a Git worktree under ${root}.`;
      }
      if (!(await gitSummary(target))) return `Not a Git worktree: ${target}`;
      threadStore[conversationKey] = { ...record, cwd: target, threadId: undefined, name: undefined, history: rememberCurrentThread(record) };
      return `Working directory set to ${target}. Your next message starts a new thread there.`;
    }
    case "threads":
      return `Current thread: ${record.threadId || "none"}\nSaved threads:\n${savedThreads(record).map((item) => `${item.threadId}${item.name ? ` (${item.name})` : ""}`).join("\n") || "none"}`;
    case "resume": {
      if (!argument) return "Usage: /resume <thread-id>. Send /threads to see saved threads.";
      const target = savedThreads(record).find((item) => item.threadId === argument);
      if (!target) return "Thread not found in this WeChat conversation. Send /threads to see saved threads.";
      threadStore[conversationKey] = {
        ...record,
        threadId: target.threadId,
        name: target.name,
        cwd: target.cwd || undefined,
        history: [...savedThreads(record).filter((item) => item.threadId !== argument), ...(record.threadId ? [{ threadId: record.threadId, name: record.name || null, cwd: record.cwd || null }] : [])].slice(-20),
      };
      return `Resumed thread ${target.threadId}. The next message continues it.`;
    }
    case "rename":
      if (!record.threadId) return "No active thread to rename. Send a message first.";
      if (!argument || argument.length > 80) return "Usage: /rename <name> (up to 80 characters).";
      await client.setThreadName(record.threadId, argument);
      threadStore[conversationKey] = { ...record, name: argument };
      return `Thread renamed to ${argument}.`;
    case "compact":
      if (!record.threadId) return "No active thread to compact. Send a message first.";
      await client.compactThread(record.threadId);
      return "Conversation context compacted.";
    case "fork": {
      if (!record.threadId) return "No active thread to fork. Send a message first.";
      const thread = await client.forkThread(record.threadId, settings);
      threadStore[conversationKey] = { ...record, threadId: thread.id, history: rememberCurrentThread(record) };
      return `Forked conversation. Current thread: ${thread.id}.`;
    }
    case "diff": {
      const summary = await gitSummary(settings.cwd);
      return summary || `Configured cwd is not a Git worktree: ${settings.cwd}`;
    }
    case "review": {
      if (!(await gitSummary(settings.cwd))) {
        return `Configured cwd is not a Git worktree: ${settings.cwd}`;
      }
      if (!record.threadId) return "No active thread to review. Send a message first.";
      const result = await client.reviewThread(record.threadId);
      return result.text || "Review completed without a text summary.";
    }
    default:
      return "Command unavailable. Send /help for supported commands.";
  }
}
