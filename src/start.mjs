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
} from "./constants.mjs";
import { CodexAppServerClient } from "./codex-app-server.mjs";
import { runSetup } from "./setup.mjs";
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
} from "./wechat-api.mjs";

const MAX_CONSECUTIVE_FAILURES = 3;
const RETRY_DELAY_MS = 2_000;
const BACKOFF_DELAY_MS = 30_000;

function log(message) {
  process.stderr.write(`[bridge] ${message}\n`);
}

function logError(message) {
  process.stderr.write(`[bridge] ERROR: ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ConversationQueue {
  constructor() {
    this.chains = new Map();
  }

  run(key, task) {
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
  return new Map(Object.entries(loadJson(PATHS.contextTokens, {})));
}

function persistContextTokens(contextTokens) {
  saveJson(PATHS.contextTokens, Object.fromEntries(contextTokens));
}

function loadThreadStore() {
  return loadJson(PATHS.threads, {});
}

function persistThreadStore(threadStore) {
  saveJson(PATHS.threads, threadStore);
}

function buildDeveloperInstructions(extraInstructions) {
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

function buildThreadName(meta) {
  if (meta.isGroup) {
    return `wechat:group:${shortId(meta.replyTarget)}`;
  }
  return `wechat:dm:${shortId(meta.replyTarget)}`;
}

function buildUserInputs(meta, extracted, localImagePath) {
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

  const inputs = [
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

async function ensureThread(client, threadStore, conversationKey, meta) {
  const existing = threadStore[conversationKey];
  if (existing?.threadId) {
    if (!client.isThreadLoaded(existing.threadId)) {
      try {
        await client.resumeThread(existing.threadId, {
          name: buildThreadName(meta),
        });
      } catch (error) {
        logError(
          `resume failed for ${conversationKey} (${existing.threadId}): ${error.message}; creating new thread`,
        );
        delete threadStore[conversationKey];
      }
    }

    if (threadStore[conversationKey]?.threadId) {
      threadStore[conversationKey].updatedAt = nowIso();
      threadStore[conversationKey].lastSenderId = meta.senderId;
      threadStore[conversationKey].lastReplyTarget = meta.replyTarget;
      return threadStore[conversationKey];
    }
  }

  const thread = await client.createThread({
    name: buildThreadName(meta),
  });
  const record = {
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

async function maybeDownloadImage(meta, extracted) {
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
    logError(`image download failed for ${meta.replyTarget}: ${error.message}`);
    return null;
  }
}

async function processMessage({
  account,
  client,
  contextTokens,
  threadStore,
  message,
}) {
  if (!isInboundUserMessage(message)) {
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
  const localImagePath = await maybeDownloadImage(meta, extracted);

  const threadRecord = await ensureThread(
    client,
    threadStore,
    conversationKey,
    meta,
  );
  persistThreadStore(threadStore);

  const reply = await client.sendTurn(
    threadRecord.threadId,
    buildUserInputs(meta, extracted, localImagePath),
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
}

export async function runStart(options = {}) {
  ensureDir(PATHS.dataDir);
  ensureDir(PATHS.mediaDir);

  let account = loadJson(PATHS.account, null);
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
    appServerUrl: options.appServerUrl || process.env.CODEX_WECHAT_APP_SERVER_URL || null,
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

  async function shutdown(signal) {
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
        consecutiveFailures += 1;
        logError(
          `getupdates failed ret=${response.ret} errcode=${response.errcode} errmsg=${response.errmsg || ""}`,
        );
        await sleep(
          consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
            ? BACKOFF_DELAY_MS
            : RETRY_DELAY_MS,
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0;
        }
        continue;
      }

      consecutiveFailures = 0;

      if (response.get_updates_buf) {
        getUpdatesBuf = response.get_updates_buf;
        saveText(PATHS.syncBuf, getUpdatesBuf);
      }

      for (const message of response.msgs || []) {
        const conversationKey = getConversationKey(message);
        if (!conversationKey) {
          continue;
        }

        queue
          .run(conversationKey, async () => {
            await processMessage({
              account,
              client,
              contextTokens,
              threadStore,
              message,
            });
          })
          .catch((error) => {
            logError(`message pipeline failed: ${error.message}`);
          });
      }
    } catch (error) {
      consecutiveFailures += 1;
      logError(`poll loop error: ${error.message}`);
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
