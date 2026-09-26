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
  return { name: Object.hasOwn(COMMAND_HANDLERS, name) ? name : "unsupported", argument: match[2]?.trim() || null, original: name };
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

interface CommandRequest {
  command: WechatCommand;
  client: CodexAppServerClient;
  threadStore: ThreadStore;
  conversationKey: string;
}
interface CommandContext extends CommandRequest {
  record: ThreadRecord;
  settings: ReturnType<typeof conversationSettings>;
  argument: string | null;
}

function handleHelp(): string {
  return "Commands: /model [name], /models, /effort [level], /status, /config, /cwd [repo], /new, /threads, /resume <id>, /compact, /fork, /rename <name>, /review, /diff, /permissions. Terminal-only commands are unavailable here.";
}

function handleUnsupported({ command }: CommandContext): string {
  return `/${command.original} is not available in WeChat. Send /help for supported commands. Prefix a literal slash message with //.`;
}

function handleStatus({ record, settings }: CommandContext): string {
  return `model: ${settings.model || "Codex default"}\neffort: ${settings.effort || "Codex default"}\nsandbox: ${settings.sandbox}\ncwd: ${settings.cwd}\nthread: ${record.threadId || "none"}`;
}

function handlePermissions({ settings }: CommandContext): string {
  return `sandbox: ${settings.sandbox}. Permissions are fixed by the bridge service; change its startup configuration to change this limit.`;
}

async function handleModel({ command, client, threadStore, conversationKey, record, argument }: CommandContext): Promise<string> {
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

async function handleEffort({ client, threadStore, conversationKey, record, settings, argument }: CommandContext): Promise<string> {
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

function handleNew({ threadStore, conversationKey, record }: CommandContext): string {
  threadStore[conversationKey] = { model: record.model, effort: record.effort, cwd: record.cwd, history: rememberCurrentThread(record) };
  return "New conversation ready. Your next message starts a fresh Codex thread.";
}

async function handleCwd({ client, threadStore, conversationKey, record, settings, argument }: CommandContext): Promise<string> {
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

function handleThreads({ record }: CommandContext): string {
  return `Current thread: ${record.threadId || "none"}\nSaved threads:\n${savedThreads(record).map((item) => `${item.threadId}${item.name ? ` (${item.name})` : ""}`).join("\n") || "none"}`;
}

function handleResume({ threadStore, conversationKey, record, argument }: CommandContext): string {
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

async function handleRename({ client, threadStore, conversationKey, record, argument }: CommandContext): Promise<string> {
  if (!record.threadId) return "No active thread to rename. Send a message first.";
  if (!argument || argument.length > 80) return "Usage: /rename <name> (up to 80 characters).";
  await client.setThreadName(record.threadId, argument);
  threadStore[conversationKey] = { ...record, name: argument };
  return `Thread renamed to ${argument}.`;
}

async function handleCompact({ client, record }: CommandContext): Promise<string> {
  if (!record.threadId) return "No active thread to compact. Send a message first.";
  await client.compactThread(record.threadId);
  return "Conversation context compacted.";
}

async function handleFork({ client, threadStore, conversationKey, record, settings }: CommandContext): Promise<string> {
  if (!record.threadId) return "No active thread to fork. Send a message first.";
  const thread = await client.forkThread(record.threadId, settings);
  threadStore[conversationKey] = { ...record, threadId: thread.id, history: rememberCurrentThread(record) };
  return `Forked conversation. Current thread: ${thread.id}.`;
}

async function handleDiff({ settings }: CommandContext): Promise<string> {
  const summary = await gitSummary(settings.cwd);
  return summary || `Configured cwd is not a Git worktree: ${settings.cwd}`;
}

async function handleReview({ client, record, settings }: CommandContext): Promise<string> {
  if (!(await gitSummary(settings.cwd))) {
    return `Configured cwd is not a Git worktree: ${settings.cwd}`;
  }
  if (!record.threadId) return "No active thread to review. Send a message first.";
  const result = await client.reviewThread(record.threadId);
  return result.text || "Review completed without a text summary.";
}

const COMMAND_HANDLERS: Record<string, (context: CommandContext) => string | Promise<string>> = {
  help: handleHelp,
  unsupported: handleUnsupported,
  config: handleStatus,
  status: handleStatus,
  permissions: handlePermissions,
  models: handleModel,
  model: handleModel,
  effort: handleEffort,
  new: handleNew,
  cwd: handleCwd,
  threads: handleThreads,
  resume: handleResume,
  rename: handleRename,
  compact: handleCompact,
  fork: handleFork,
  diff: handleDiff,
  review: handleReview,
};

export async function runWechatCommand(request: CommandRequest): Promise<string> {
  const { command, client, threadStore, conversationKey } = request;
  if (command.argument && NO_ARGUMENT_COMMANDS.has(command.name)) return `Usage: /${command.name}`;
  const handler = Object.hasOwn(COMMAND_HANDLERS, command.name) ? COMMAND_HANDLERS[command.name] : undefined;
  if (!handler) return "Command unavailable. Send /help for supported commands.";
  const record = threadStore[conversationKey] || {};
  return handler({ ...request, record, settings: conversationSettings(client, record), argument: command.argument });
}
