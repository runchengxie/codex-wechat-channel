import path from "node:path";

import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX,
  DEFAULT_WECHAT_BASE_URL,
  PATHS,
  ensureDir,
  loadJson,
  loadText,
  nowIso,
  saveJson,
  saveText,
  shortId,
} from "./constants.js";
import { CodexAppServerClient } from "./codex-app-server.js";
import { isSenderAllowed, parseAllowedUsers } from "./access-control.js";
import { conversationSettings, parseWechatCommand, runWechatCommand } from "./commands.js";
import { runSetup } from "./setup.js";
import { processUpdateBatch } from "./update-batch.js";
import {
  downloadImageAttachment,
  extractContent,
  getConversationKey,
  getReplyTarget,
  getUpdates,
  isInboundUserMessage,
  normalizeWechatText,
  sendTextMessage,
  showTypingIndicator,
} from "./wechat-api.js";

import { object, string, errorMessage, type UserInput, type ThreadSettings } from "./protocol.js";
import { accountFromJson, type Account, type WechatMessage, type ExtractedContent } from "./wechat-types.js";
import { threadStoreFromJson, isActiveThread, type ThreadStore, type ActiveThread } from "./thread-store.js";

interface MessageMeta {
  isGroup: boolean;
  replyTarget: string;
  senderId: string;
  senderLabel: string;
  conversationKey: string;
}
interface StartOptions extends ThreadSettings {
  baseUrl?: string;
  sandbox?: string;
  approvalPolicy?: string;
  appServerUrl?: string;
}

const MAX_CONSECUTIVE_FAILURES = 3;
const RETRY_DELAY_MS = 2_000;
const BACKOFF_DELAY_MS = 30_000;

function log(message: string) {
  process.stderr.write(`[bridge] ${message}\n`);
}

function logError(message: string) {
  process.stderr.write(`[bridge] ERROR: ${message}\n`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ConversationQueue {
  chains: Map<string, Promise<void>>;
  constructor() {
    this.chains = new Map();
  }

  run(key: string, task: () => Promise<void>) {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.chains.get(key) === next) {
          this.chains.delete(key);
        }
      });

    this.chains.set(key, next);
    return next;
  }
}

function loadContextTokens() {
  return new Map(Object.entries(object(loadJson(PATHS.contextTokens, {}))).map(([key, value]) => [key, string(value)]));
}

function persistContextTokens(contextTokens: Map<string, string>) {
  saveJson(PATHS.contextTokens, Object.fromEntries(contextTokens));
}

function loadThreadStore() {
  return threadStoreFromJson(loadJson(PATHS.threads, {}));
}

function persistThreadStore(threadStore: ThreadStore) {
  saveJson(PATHS.threads, threadStore);
}

function buildDeveloperInstructions(extraInstructions: string | undefined) {
  const base = [
    "You are replying inside a real WeChat chat through codex-wechat-channel.",
    "Reply in plain text only.",
    "Do not use Markdown tables.",
    "Avoid code fences unless the user explicitly asks for code.",
    "Keep replies concise unless the user clearly asks for depth.",
    "Default to Chinese unless the user is clearly using another language.",
    "If the user asks to modify code, treat the configured cwd as the workspace root.",
  ];

  if (extraInstructions) {
    base.push(extraInstructions);
  }

  return base.join("\n");
}

function buildThreadName(meta: MessageMeta) {
  if (meta.isGroup) {
    return `wechat:group:${shortId(meta.replyTarget)}`;
  }
  return `wechat:dm:${shortId(meta.replyTarget)}`;
}

function buildUserInputs(meta: MessageMeta, extracted: ExtractedContent, localImagePath: string | null) {
  const lines = [
    "WeChat inbound message.",
    `Chat type: ${meta.isGroup ? "group" : "direct"}`,
    `Reply target: ${meta.replyTarget}`,
    `Sender: ${meta.senderLabel}`,
    `Sender ID: ${meta.senderId}`,
    `Message type: ${extracted.msgType}`,
    "",
    "Message:",
    extracted.text,
  ];

  const inputs: UserInput[] = [
    {
      type: "text",
      text: lines.join("\n"),
      text_elements: [],
    },
  ];

  if (localImagePath) {
    inputs.push({
      type: "localImage",
      path: localImagePath,
    });
  }

  return inputs;
}

async function ensureThread(client: CodexAppServerClient, threadStore: ThreadStore, conversationKey: string, meta: MessageMeta): Promise<ActiveThread> {
  const existing = threadStore[conversationKey];
  const settings = conversationSettings(client, existing);
  if (existing?.threadId) {
    if (!client.isThreadLoaded(existing.threadId)) {
      try {
        await client.resumeThread(existing.threadId, {
          name: existing.name || buildThreadName(meta),
          settings,
        });
      } catch (error) {
        logError(
          `resume failed for ${conversationKey} (${existing.threadId}): ${errorMessage(error)}; creating new thread`,
        );
        threadStore[conversationKey] = { model: existing.model, effort: existing.effort, cwd: existing.cwd, history: existing.history };
      }
    }

    if (isActiveThread(threadStore[conversationKey])) {
      threadStore[conversationKey].updatedAt = nowIso();
      threadStore[conversationKey].lastSenderId = meta.senderId;
      threadStore[conversationKey].lastReplyTarget = meta.replyTarget;
      return threadStore[conversationKey];
    }
  }

  const thread = await client.createThread({
    name: existing?.name || buildThreadName(meta),
    settings,
  });
  const record = {
    ...existing,
    threadId: thread.id,
    conversationKey,
    isGroup: meta.isGroup,
    lastSenderId: meta.senderId,
    lastReplyTarget: meta.replyTarget,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  threadStore[conversationKey] = record;
  return record;
}

async function maybeDownloadImage(meta: MessageMeta, extracted: ExtractedContent) {
  if (extracted.msgType !== "image" || !extracted.mediaItem) {
    return null;
  }

  const stamp = `${Date.now()}-${shortId(meta.replyTarget)}`;
  const outputDir = path.join(PATHS.mediaDir, meta.isGroup ? "groups" : "dms");

  try {
    return await downloadImageAttachment({
      mediaItem: extracted.mediaItem,
      outputDir,
      fileStem: stamp,
    });
  } catch (error) {
    logError(`image download failed for ${meta.replyTarget}: ${errorMessage(error)}`);
    return null;
  }
}

export async function processMessage({
  account,
  client,
  contextTokens,
  threadStore,
  message,
  allowedUsers,
}: { account: Account; client: CodexAppServerClient; contextTokens: Map<string, string>; threadStore: ThreadStore; message: WechatMessage; allowedUsers: ReadonlySet<string> }) {
  if (!isInboundUserMessage(message)) {
    return;
  }

  if (!isSenderAllowed(message.from_user_id, allowedUsers)) {
    log(`ignored message from unlisted sender ${message.from_user_id || "unknown"}`);
    return;
  }

  const extracted = extractContent(message);
  if (!extracted) {
    return;
  }

  const replyTarget = getReplyTarget(message);
  const conversationKey = getConversationKey(message);

  if (!replyTarget || !conversationKey || !message.from_user_id) {
    logError(`message missing routing fields: ${JSON.stringify(message)}`);
    return;
  }

  if (message.context_token) {
    contextTokens.set(replyTarget, message.context_token);
    if (message.group_id) {
      contextTokens.set(message.from_user_id, message.context_token);
    }
    persistContextTokens(contextTokens);
  }

  const contextToken = contextTokens.get(replyTarget);
  if (!contextToken) {
    logError(`no context_token for ${replyTarget}; waiting for a future message`);
    return;
  }

  const meta = {
    isGroup: Boolean(message.group_id),
    replyTarget,
    senderId: message.from_user_id,
    senderLabel: shortId(message.from_user_id),
    conversationKey,
  };

  log(
    `message ${extracted.msgType} from=${meta.senderLabel} target=${shortId(replyTarget)} text="${extracted.text.slice(0, 80)}"`,
  );

  showTypingIndicator(account, replyTarget, contextToken).catch(() => undefined);
  try {
    if (!client.isConnected()) {
      await client.connect();
    }

    const command = extracted.msgType === "text" ? parseWechatCommand(extracted.text) : null;
    if (command) {
      const record = threadStore[conversationKey];
      if (record?.threadId && ["compact", "fork", "rename", "review"].includes(command.name) && !client.isThreadLoaded(record.threadId)) {
        await client.resumeThread(record.threadId, {
          name: record.name || buildThreadName(meta),
          settings: conversationSettings(client, record),
        });
      }
      const response = await runWechatCommand({ command, client, threadStore, conversationKey });
      persistThreadStore(threadStore);
      await sendTextMessage(account, replyTarget, response, contextToken);
      return;
    }

    if (extracted.msgType === "text" && extracted.text.startsWith("//")) {
      extracted.text = extracted.text.slice(1);
    }
    const localImagePath = await maybeDownloadImage(meta, extracted);
    const threadRecord = await ensureThread(client, threadStore, conversationKey, meta);
    persistThreadStore(threadStore);
    const reply = await client.sendTurn(
      threadRecord.threadId,
      buildUserInputs(meta, extracted, localImagePath),
      conversationSettings(client, threadRecord),
    );
    const finalText = normalizeWechatText(reply.text);

    if (!finalText) {
      logError(`Codex returned empty text for ${replyTarget}`);
      return;
    }

    await sendTextMessage(account, replyTarget, finalText, contextToken);
    threadRecord.updatedAt = nowIso();
    persistThreadStore(threadStore);
    log(`reply sent to ${shortId(replyTarget)}: "${finalText.slice(0, 80)}"`);
  } catch (error) {
    logError(`message pipeline failed for ${shortId(replyTarget)}: ${errorMessage(error)}`);
    await sendTextMessage(account, replyTarget, `Codex command failed: ${errorMessage(error)}`.slice(0, 500), contextToken);
  }
}

export async function runStart(options: StartOptions = {}) {
  ensureDir(PATHS.dataDir);
  ensureDir(PATHS.mediaDir);

  const allowedUsers = parseAllowedUsers(process.env.CODEX_WECHAT_ALLOWED_USERS);
  if (allowedUsers.size === 0) {
    log("WARNING: CODEX_WECHAT_ALLOWED_USERS is empty; messages from all users are allowed.");
  }

  const savedAccount = loadJson(PATHS.account, null);
  let account = savedAccount === null ? null : accountFromJson(savedAccount);
  if (!account) {
    log("no saved WeChat credentials, starting QR login");
    account = await runSetup({
      baseUrl: options.baseUrl || DEFAULT_WECHAT_BASE_URL,
      force: false,
    });
  }

  const contextTokens = loadContextTokens();
  const threadStore = loadThreadStore();
  const queue = new ConversationQueue();
  const client = new CodexAppServerClient({
    cwd: options.cwd || process.env.CODEX_WECHAT_CWD || process.cwd(),
    model: options.model || process.env.CODEX_WECHAT_MODEL || null,
    sandbox: options.sandbox || DEFAULT_SANDBOX,
    approvalPolicy: options.approvalPolicy || DEFAULT_APPROVAL_POLICY,
    appServerUrl: options.appServerUrl || process.env.CODEX_WECHAT_APP_SERVER_URL || undefined,
    developerInstructions: buildDeveloperInstructions(
      process.env.CODEX_WECHAT_DEVELOPER_INSTRUCTIONS,
    ),
    log,
    logError,
  });

  await client.connect();
  log(`connected to Codex app-server, cwd=${client.options.cwd}`);

  let getUpdatesBuf = loadText(PATHS.syncBuf, "");
  let consecutiveFailures = 0;
  let stopping = false;

  async function shutdown(signal: string) {
    if (stopping) {
      return;
    }
    stopping = true;
    log(`received ${signal}, shutting down`);
    await client.close();
    process.exit(0);
  }

  process.on("SIGINT", () => {
    shutdown("SIGINT").catch((error) => {
      logError(error.message);
      process.exit(1);
    });
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch((error) => {
      logError(error.message);
      process.exit(1);
    });
  });

  while (!stopping) {
    try {
      const response = await getUpdates(account, getUpdatesBuf);
      const isError =
        (response.ret !== undefined && response.ret !== 0) ||
        (response.errcode !== undefined && response.errcode !== 0);

      if (isError) {
        throw new Error(
          `getupdates failed ret=${response.ret} errcode=${response.errcode} errmsg=${response.errmsg || ""}`,
        );
      }

      await processUpdateBatch({
        response,
        dispatch: (message) => {
          const conversationKey = getConversationKey(message);
          if (!conversationKey) {
            return;
          }

          return queue.run(conversationKey, () =>
            processMessage({
              account,
              client,
              contextTokens,
              threadStore,
              message,
              allowedUsers,
            }),
          );
        },
        saveCursor(cursor) {
          getUpdatesBuf = cursor;
          saveText(PATHS.syncBuf, cursor);
        },
      });
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      logError(`poll loop error: ${errorMessage(error)}`);
      await sleep(
        consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
          ? BACKOFF_DELAY_MS
          : RETRY_DELAY_MS,
      );
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        consecutiveFailures = 0;
      }
    }
  }
}
