import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_CODEX_BIN,
  DEFAULT_SANDBOX,
  loadJson,
} from "./constants.mjs";

function resolveCodexAuthPath() {
  return path.join(os.homedir(), ".codex", "auth.json");
}

function readApiKeyFromAuthFile(authPath) {
  const auth = loadJson(authPath, null);
  const apiKey = auth?.OPENAI_API_KEY;
  if (typeof apiKey !== "string") {
    return null;
  }

  const trimmed = apiKey.trim();
  return trimmed || null;
}

function buildMissingAuthError(authPath) {
  return new Error(
    [
      "Codex authentication missing for embedded app-server.",
      "Set OPENAI_API_KEY in the environment or run `codex login` so the key is stored at",
      authPath,
    ].join(" "),
  );
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createTurnWaiter() {
  const done = deferred();
  return {
    ...done,
    finalText: "",
    commentary: [],
    stream: [],
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function killProcessTree(pid) {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForReady(readyUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(readyUrl, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for Codex app-server readiness at ${readyUrl}`);
}

export class CodexAppServerClient {
  constructor(options = {}) {
    this.options = {
      sandbox: DEFAULT_SANDBOX,
      approvalPolicy: DEFAULT_APPROVAL_POLICY,
      codexBin: DEFAULT_CODEX_BIN,
      codexAuthPath: resolveCodexAuthPath(),
      serviceName: "codex-wechat-channel",
      ...options,
    };
    this.pending = new Map();
    this.turnWaiters = new Map();
    this.turnEventBuffers = new Map();
    this.completedTurns = new Map();
    this.threadOperationWaiters = new Map();
    this.loadedThreads = new Set();
    this.nextId = 1;
    this.socket = null;
    this.child = null;
    this.closeReason = null;
    this.launchEnv = null;
  }

  log(message) {
    this.options.log?.(message);
  }

  logError(message) {
    this.options.logError?.(message);
  }

  async connect() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    this.launchEnv = this.prepareLaunchEnv();
    const appServerUrl =
      this.options.appServerUrl || (await this.startEmbeddedAppServer());

    await this.openSocket(appServerUrl);
    await this.request("initialize", {
      clientInfo: {
        name: "codex-wechat-channel",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }));
  }

  async startEmbeddedAppServer() {
    const port = await getFreePort();
    const wsUrl = `ws://127.0.0.1:${port}`;
    const readyUrl = `http://127.0.0.1:${port}/readyz`;
    const args = ["app-server", "--listen", wsUrl];
    const spawnOptions = {
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: this.launchEnv || process.env,
    };

    this.log(`starting embedded codex app-server on ${wsUrl}`);
    this.child = spawn(this.options.codexBin, args, spawnOptions);

    this.child.once("error", (error) => {
      this.logError(`codex app-server failed to start: ${error.message}`);
    });

    this.child.stdout.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) {
        this.log(`[app-server] ${text}`);
      }
    });

    this.child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) {
        this.log(`[app-server] ${text}`);
      }
    });

    this.child.once("exit", (code, signal) => {
      this.closeReason = `embedded app-server exited (code=${code}, signal=${signal})`;
      this.rejectAllPending(new Error(this.closeReason));
    });

    await waitForReady(readyUrl, 15_000);
    return wsUrl;
  }

  prepareLaunchEnv() {
    if (this.options.appServerUrl) {
      return process.env;
    }

    const envApiKey = process.env.OPENAI_API_KEY?.trim();
    if (envApiKey) {
      return process.env;
    }

    const authPath = this.options.codexAuthPath;
    const apiKey = readApiKeyFromAuthFile(authPath);
    if (!apiKey) {
      throw buildMissingAuthError(authPath);
    }

    this.log(`reusing OPENAI_API_KEY from ${authPath} for embedded app-server`);
    return {
      ...process.env,
      OPENAI_API_KEY: apiKey,
    };
  }

  async openSocket(wsUrl) {
    const opened = deferred();
    const socket = new WebSocket(wsUrl);

    socket.addEventListener("open", () => {
      this.socket = socket;
      opened.resolve(undefined);
    });

    socket.addEventListener("error", () => {
      if (socket.readyState !== WebSocket.OPEN) {
        opened.reject(new Error(`Failed to connect to Codex app-server at ${wsUrl}`));
      }
    });

    socket.addEventListener("close", (event) => {
      this.closeReason = `websocket closed (${event.code}) ${event.reason}`.trim();
      this.rejectAllPending(new Error(this.closeReason));
    });

    socket.addEventListener("message", (event) => {
      this.handleMessage(String(event.data));
    });

    await opened.promise;
  }

  rejectAllPending(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();

    for (const waiter of this.turnWaiters.values()) {
      waiter.reject(error);
    }
    this.turnWaiters.clear();
    for (const waiter of this.threadOperationWaiters.values()) {
      waiter.reject(error);
    }
    this.threadOperationWaiters.clear();
  }

  handleMessage(raw) {
    const message = JSON.parse(raw);

    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        if (
          (pending.method === "turn/start" || pending.method === "review/start") &&
          message.result?.turn?.id &&
          !this.completedTurns.has(message.result.turn.id) &&
          !this.turnWaiters.has(message.result.turn.id)
        ) {
          const waiter = createTurnWaiter();
          Object.assign(waiter, this.turnEventBuffers.get(message.result.turn.id) || {});
          this.turnEventBuffers.delete(message.result.turn.id);
          this.turnWaiters.set(message.result.turn.id, waiter);
        }
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      this.handleNotification(message.method, message.params);
    }
  }

  handleNotification(method, params) {
    switch (method) {
      case "thread/started":
        this.loadedThreads.add(params.thread.id);
        return;
      case "item/agentMessage/delta": {
        const waiter = this.turnWaiters.get(params.turnId) || this.bufferTurnEvents(params.turnId);
        waiter.stream.push(params.delta);
        return;
      }
      case "item/started": {
        const operation = this.threadOperationWaiters.get(params.threadId);
        if (operation && params.item?.type === "contextCompaction") {
          operation.turnId = params.turnId;
        }
        return;
      }
      case "item/completed": {
        const waiter = this.turnWaiters.get(params.turnId) || this.bufferTurnEvents(params.turnId);

        const item = params.item;
        if (item.type === "agentMessage") {
          if (item.phase === "final_answer" || item.phase == null) {
            waiter.finalText = item.text;
          } else {
            waiter.commentary.push(item.text);
          }
        }
        return;
      }
      case "turn/completed": {
        const operation = this.threadOperationWaiters.get(params.threadId);
        if (operation?.turnId === params.turn.id) {
          this.threadOperationWaiters.delete(params.threadId);
          if (params.turn.status === "completed") operation.resolve();
          else operation.reject(new Error(params.turn.error?.message || `turn ended with status ${params.turn.status}`));
        }
        const waiter = this.turnWaiters.get(params.turn.id);
        const events = waiter || this.turnEventBuffers.get(params.turn.id);
        this.turnWaiters.delete(params.turn.id);
        this.turnEventBuffers.delete(params.turn.id);
        const result = {
          text: events?.finalText || events?.stream.join("").trim() || events?.commentary.join("\n").trim() || "",
          commentary: events?.commentary.join("\n").trim() || "",
        };
        this.completedTurns.set(params.turn.id, { status: params.turn.status, result, error: params.turn.error?.message });
        if (this.completedTurns.size > 50) this.completedTurns.delete(this.completedTurns.keys().next().value);
        if (!waiter) return;
        if (params.turn.status === "completed") {
          waiter.resolve(result);
        } else {
          const reason = params.turn.error?.message || `turn ended with status ${params.turn.status}`;
          waiter.reject(new Error(reason));
        }
        return;
      }
      case "error":
        this.logError(`server notification: ${params.message || JSON.stringify(params)}`);
        return;
      default:
        return;
    }
  }

  bufferTurnEvents(turnId) {
    if (!this.turnEventBuffers.has(turnId)) {
      this.turnEventBuffers.set(turnId, { finalText: "", commentary: [], stream: [] });
      if (this.turnEventBuffers.size > 50) this.turnEventBuffers.delete(this.turnEventBuffers.keys().next().value);
    }
    return this.turnEventBuffers.get(turnId);
  }

  request(method, params) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex app-server websocket is not connected");
    }

    const id = String(this.nextId++);
    const pending = deferred();
    this.pending.set(id, {
      ...pending,
      method,
    });
    this.socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
    );
    const timeout = setTimeout(() => {
      if (!this.pending.has(id)) return;
      this.pending.delete(id);
      pending.reject(new Error(`${method} timed out after 30000ms`));
    }, 30_000);
    return pending.promise.finally(() => clearTimeout(timeout));
  }

  isThreadLoaded(threadId) {
    return this.loadedThreads.has(threadId);
  }

  buildThreadParams(settings = {}) {
    return {
      cwd: settings.cwd || this.options.cwd,
      model: settings.model ?? this.options.model ?? null,
      approvalPolicy: this.options.approvalPolicy,
      sandbox: this.options.sandbox,
      serviceName: this.options.serviceName,
      developerInstructions: this.options.developerInstructions,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    };
  }

  async createThread({ name, settings } = {}) {
    const result = await this.request("thread/start", this.buildThreadParams(settings));
    this.loadedThreads.add(result.thread.id);
    if (name) {
      await this.setThreadName(result.thread.id, name);
    }
    return result.thread;
  }

  async resumeThread(threadId, { name, settings = {} } = {}) {
    const result = await this.request("thread/resume", {
      threadId,
      cwd: settings.cwd || this.options.cwd,
      model: settings.model ?? this.options.model ?? null,
      approvalPolicy: this.options.approvalPolicy,
      sandbox: this.options.sandbox,
      developerInstructions: this.options.developerInstructions,
      persistExtendedHistory: false,
    });
    this.loadedThreads.add(result.thread.id);
    if (name) {
      await this.setThreadName(result.thread.id, name);
    }
    return result.thread;
  }

  async setThreadName(threadId, name) {
    await this.request("thread/name/set", {
      threadId,
      name,
    });
  }

  async sendTurn(threadId, input, settings = {}) {
    const result = await this.request("turn/start", {
      threadId,
      input,
      model: settings.model ?? this.options.model ?? null,
      ...(settings.cwd ? { cwd: settings.cwd } : {}),
      ...(settings.effort ? { effort: settings.effort } : {}),
    });
    const turnId = result.turn.id;
    const completed = this.completedTurns.get(turnId);
    if (completed) {
      this.completedTurns.delete(turnId);
      if (completed.status !== "completed") throw new Error(completed.error || `turn ended with status ${completed.status}`);
      return completed.result;
    }
    const waiter = this.turnWaiters.get(turnId) || createTurnWaiter();
    if (!this.turnWaiters.has(turnId)) {
      this.turnWaiters.set(turnId, waiter);
    }
    return waiter.promise;
  }

  async listModels() {
    const models = [];
    let cursor = null;
    do {
      const page = await this.request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      models.push(...(page.data || []));
      cursor = page.nextCursor;
    } while (cursor);
    return models;
  }

  async compactThread(threadId) {
    const waiter = deferred();
    this.threadOperationWaiters.set(threadId, waiter);
    const timeout = setTimeout(() => waiter.reject(new Error("compaction timed out")), 180_000);
    try {
      await this.request("thread/compact/start", { threadId });
      await waiter.promise;
    } finally {
      clearTimeout(timeout);
      if (this.threadOperationWaiters.get(threadId) === waiter) this.threadOperationWaiters.delete(threadId);
    }
  }

  async forkThread(threadId, settings = {}) {
    const result = await this.request("thread/fork", {
      threadId,
      model: settings.model ?? this.options.model ?? null,
      cwd: settings.cwd || this.options.cwd,
      sandbox: this.options.sandbox,
      approvalPolicy: this.options.approvalPolicy,
    });
    this.loadedThreads.add(result.thread.id);
    return result.thread;
  }

  async reviewThread(threadId) {
    const result = await this.request("review/start", { threadId, target: { type: "uncommittedChanges" } });
    const turnId = result.turn.id;
    const completed = this.completedTurns.get(turnId);
    if (completed) {
      this.completedTurns.delete(turnId);
      if (completed.status !== "completed") throw new Error(completed.error || `turn ended with status ${completed.status}`);
      return completed.result;
    }
    const waiter = this.turnWaiters.get(turnId) || createTurnWaiter();
    this.turnWaiters.set(turnId, waiter);
    const timeout = setTimeout(() => waiter.reject(new Error("review timed out")), 180_000);
    try { return await waiter.promise; }
    finally { clearTimeout(timeout); this.turnWaiters.delete(turnId); }
  }

  async close() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
    this.socket = null;

    if (this.child && !this.child.killed) {
      await killProcessTree(this.child.pid);
      await sleep(300);
    }
  }
}
