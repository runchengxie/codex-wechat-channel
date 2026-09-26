import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_CODEX_BIN,
  DEFAULT_SANDBOX,
  loadJson,
} from "./constants.js";

import { errorMessage, object, string, model, type Model, type ThreadSettings, type UserInput, type TurnResult } from "./protocol.js";

interface ClientOptions extends ThreadSettings {
  sandbox?: string;
  approvalPolicy?: string;
  codexBin?: string;
  codexAuthPath?: string;
  serviceName?: string;
  turnTimeoutMs?: number;
  appServerUrl?: string;
  developerInstructions?: string;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}
type ResolvedOptions = ClientOptions & Required<Pick<ClientOptions,
  "cwd" | "sandbox" | "approvalPolicy" | "codexBin" | "codexAuthPath" | "serviceName" | "turnTimeoutMs">>;
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason: unknown) => void;
}
interface TurnEvents { finalText: string; commentary: string[]; stream: string[] }
type TurnWaiter = Deferred<TurnResult> & TurnEvents;
type ThreadOperation = Deferred<void> & { turnId?: string };

function resolveCodexAuthPath() {
  return path.join(os.homedir(), ".codex", "auth.json");
}

function readApiKeyFromAuthFile(authPath: string) {
  const auth = loadJson(authPath, null);
  const apiKey = auth && typeof auth === "object" && "OPENAI_API_KEY" in auth ? auth.OPENAI_API_KEY : undefined;
  if (typeof apiKey !== "string") {
    return null;
  }

  const trimmed = apiKey.trim();
  return trimmed || null;
}

function buildMissingAuthError(authPath: string) {
  return new Error(
    [
      "Codex authentication missing for embedded app-server.",
      "Set OPENAI_API_KEY in the environment or run `codex login` so the key is stored at",
      authPath,
    ].join(" "),
  );
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createTurnWaiter(): TurnWaiter {
  const done = deferred<TurnResult>();
  return {
    ...done,
    finalText: "",
    commentary: [],
    stream: [],
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function killProcessTree(pid: number | undefined) {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
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
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        if (!address || typeof address === "string") {
          reject(new Error("Unable to allocate a TCP port"));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForReady(readyUrl: string, timeoutMs: number) {
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
  options: ResolvedOptions;
  pending: Map<string, Deferred<unknown> & { method: string }>;
  turnWaiters: Map<string, TurnWaiter>;
  turnEventBuffers: Map<string, TurnEvents>;
  completedTurns: Map<string, { status: string; result: TurnResult; error?: string }>;
  threadOperationWaiters: Map<string, ThreadOperation>;
  loadedThreads: Set<string>;
  nextId: number;
  socket: WebSocket | null;
  child: ChildProcess | null;
  embeddedAppServerUrl: string | null;
  initialized: boolean;
  closeReason: string | null;
  launchEnv: NodeJS.ProcessEnv | null;
  connectPromise: Promise<void> | null;

  constructor(options: ClientOptions = {}) {
    this.options = {
      cwd: process.cwd(),
      sandbox: DEFAULT_SANDBOX,
      approvalPolicy: DEFAULT_APPROVAL_POLICY,
      codexBin: DEFAULT_CODEX_BIN,
      codexAuthPath: resolveCodexAuthPath(),
      serviceName: "codex-wechat-channel",
      turnTimeoutMs: 180_000,
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
    this.embeddedAppServerUrl = null;
    this.initialized = false;
    this.closeReason = null;
    this.launchEnv = null;
    this.connectPromise = null;
  }

  log(message: string) {
    this.options.log?.(message);
  }

  logError(message: string) {
    this.options.logError?.(message);
  }

  async connect() {
    if (this.connectPromise) {
      return this.connectPromise;
    }
    if (this.isConnected()) return;

    const connecting = this.connectInternal();
    this.connectPromise = connecting;
    try {
      await connecting;
    } catch (error) {
      this.invalidateConnection(`app-server initialization failed: ${errorMessage(error)}`);
      throw error;
    } finally {
      if (this.connectPromise === connecting) {
        this.connectPromise = null;
      }
    }
  }

  async connectInternal() {
    this.initialized = false;
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
    if (!this.socket) throw new Error("Socket closed during initialization");
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }));
    this.initialized = true;
  }

  async startEmbeddedAppServer() {
    if (this.child && this.child.exitCode === null && !this.child.killed && this.embeddedAppServerUrl) {
      return this.embeddedAppServerUrl;
    }
    const port = await getFreePort();
    const wsUrl = `ws://127.0.0.1:${port}`;
    const readyUrl = `http://127.0.0.1:${port}/readyz`;
    const args = ["app-server", "--listen", wsUrl];
    const spawnOptions = {
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
      env: this.launchEnv || process.env,
    };

    this.log(`starting embedded codex app-server on ${wsUrl}`);
    const child = spawn(this.options.codexBin, args, spawnOptions);
    this.child = child;
    this.embeddedAppServerUrl = wsUrl;

    child.once("error", (error) => {
      this.logError(`codex app-server failed to start: ${errorMessage(error)}`);
    });

    child.stdout.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) {
        this.log(`[app-server] ${text}`);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) {
        this.log(`[app-server] ${text}`);
      }
    });

    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.embeddedAppServerUrl = null;
      this.invalidateConnection(
        `embedded app-server exited (code=${code}, signal=${signal})`,
      );
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

  async openSocket(wsUrl: string) {
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
      if (this.socket === socket) {
        this.invalidateConnection(
          `websocket closed (${event.code}) ${event.reason}`.trim(),
        );
      } else {
        opened.reject(new Error(`Codex app-server closed before connecting to ${wsUrl}`));
      }
    });

    socket.addEventListener("message", (event) => {
      try {
        this.handleMessage(String(event.data));
      } catch (error) {
        this.invalidateConnection(`Invalid app-server message: ${errorMessage(error)}`);
      }
    });

    await opened.promise;
  }

  rejectAllPending(error: Error) {
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

  invalidateConnection(reason: string) {
    const socket = this.socket;
    this.socket = null;
    this.initialized = false;
    this.loadedThreads.clear();
    this.closeReason = reason;
    this.rejectAllPending(new Error(reason));
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  }

  isConnected() {
    return Boolean(this.initialized && this.socket && this.socket.readyState === WebSocket.OPEN);
  }

  handleMessage(raw: string) {
    const message = object(JSON.parse(raw));

    const id = typeof message.id === "string" ? message.id : String(message.id);
    const pending = this.pending.get(id);
    if (pending) {
      this.pending.delete(id);
      try {
        if (message.error) {
          pending.reject(new Error(String(object(message.error).message || JSON.stringify(message.error))));
        } else {
          if (pending.method === "turn/start" || pending.method === "review/start") {
            const turnId = string(object(object(message.result).turn).id);
            if (!this.completedTurns.has(turnId) && !this.turnWaiters.has(turnId)) {
              const waiter = createTurnWaiter();
              Object.assign(waiter, this.turnEventBuffers.get(turnId) || {});
              this.turnEventBuffers.delete(turnId);
              this.turnWaiters.set(turnId, waiter);
            }
          }
          pending.resolve(message.result);
        }
      } catch (error) {
        pending.reject(error);
      }
      return;
    }

    if (typeof message.method === "string") {
      this.handleNotification(message.method, message.params);
    }
  }

  handleNotification(method: string, rawParams: unknown) {
    const params = object(rawParams);
    switch (method) {
      case "thread/started":
        this.loadedThreads.add(string(object(params.thread).id));
        return;
      case "item/agentMessage/delta": {
        const waiter = this.turnWaiters.get(string(params.turnId)) || this.bufferTurnEvents(string(params.turnId));
        waiter.stream.push(string(params.delta));
        return;
      }
      case "item/started": {
        const operation = this.threadOperationWaiters.get(string(params.threadId));
        if (operation && (params.item ? object(params.item).type : undefined) === "contextCompaction") {
          operation.turnId = string(params.turnId);
        }
        return;
      }
      case "item/completed": {
        const waiter = this.turnWaiters.get(string(params.turnId)) || this.bufferTurnEvents(string(params.turnId));

        const item = object(params.item);
        if (item.type === "agentMessage") {
          if (item.phase === "final_answer" || item.phase == null) {
            waiter.finalText = string(item.text);
          } else {
            waiter.commentary.push(string(item.text));
          }
        }
        return;
      }
      case "turn/completed": {
        const turn = object(params.turn);
        const turnId = string(turn.id);
        const status = string(turn.status);
        const turnError = turn.error ? String(object(turn.error).message || "") : undefined;
        const operation = this.threadOperationWaiters.get(string(params.threadId));
        if (operation?.turnId === turnId) {
          this.threadOperationWaiters.delete(string(params.threadId));
          if (status === "completed") operation.resolve();
          else operation.reject(new Error(turnError || `turn ended with status ${status}`));
        }
        const waiter = this.turnWaiters.get(turnId);
        const events = waiter || this.turnEventBuffers.get(turnId);
        this.turnWaiters.delete(turnId);
        this.turnEventBuffers.delete(turnId);
        const result = {
          text: events?.finalText || events?.stream.join("").trim() || events?.commentary.join("\n").trim() || "",
          commentary: events?.commentary.join("\n").trim() || "",
        };
        this.completedTurns.set(turnId, { status: status, result, error: turnError });
        if (this.completedTurns.size > 50) this.completedTurns.delete(this.completedTurns.keys().next().value!);
        if (!waiter) return;
        if (status === "completed") {
          waiter.resolve(result);
        } else {
          const reason = turnError || `turn ended with status ${status}`;
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

  bufferTurnEvents(turnId: string): TurnEvents {
    if (!this.turnEventBuffers.has(turnId)) {
      this.turnEventBuffers.set(turnId, { finalText: "", commentary: [], stream: [] });
      if (this.turnEventBuffers.size > 50) this.turnEventBuffers.delete(this.turnEventBuffers.keys().next().value!);
    }
    return this.turnEventBuffers.get(turnId)!;
  }

  request(method: string, params: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex app-server websocket is not connected");
    }

    const id = String(this.nextId++);
    const pending = deferred<unknown>();
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

  isThreadLoaded(threadId: string) {
    return this.loadedThreads.has(threadId);
  }

  buildThreadParams(settings: ThreadSettings = {}) {
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

  async createThread({ name, settings }: { name?: string; settings?: ThreadSettings } = {}) {
    const result = await this.request("thread/start", this.buildThreadParams(settings));
    this.loadedThreads.add(string(object(object(result).thread).id));
    if (name) {
      await this.setThreadName(string(object(object(result).thread).id), name);
    }
    return { id: string(object(object(result).thread).id) };
  }

  async resumeThread(threadId: string, { name, settings = {} }: { name?: string; settings?: ThreadSettings } = {}) {
    const result = await this.request("thread/resume", {
      threadId,
      cwd: settings.cwd || this.options.cwd,
      model: settings.model ?? this.options.model ?? null,
      approvalPolicy: this.options.approvalPolicy,
      sandbox: this.options.sandbox,
      developerInstructions: this.options.developerInstructions,
      persistExtendedHistory: false,
    });
    this.loadedThreads.add(string(object(object(result).thread).id));
    if (name) {
      await this.setThreadName(string(object(object(result).thread).id), name);
    }
    return { id: string(object(object(result).thread).id) };
  }

  async setThreadName(threadId: string, name: string) {
    await this.request("thread/name/set", {
      threadId,
      name,
    });
  }

  async sendTurn(threadId: string, input: UserInput[], settings: ThreadSettings = {}) {
    const result = await this.request("turn/start", {
      threadId,
      input,
      model: settings.model ?? this.options.model ?? null,
      ...(settings.cwd ? { cwd: settings.cwd } : {}),
      ...(settings.effort ? { effort: settings.effort } : {}),
    });
    const turnId = string(object(object(result).turn).id);
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
    const timeout = setTimeout(() => {
      if (this.turnWaiters.get(turnId) !== waiter) return;
      this.turnWaiters.delete(turnId);
      waiter.reject(
        new Error(`Codex turn timed out after ${this.options.turnTimeoutMs}ms`),
      );
    }, this.options.turnTimeoutMs);
    try {
      return await waiter.promise;
    } finally {
      clearTimeout(timeout);
      if (this.turnWaiters.get(turnId) === waiter) {
        this.turnWaiters.delete(turnId);
      }
    }
  }

  async listModels() {
    const models: Model[] = [];
    let cursor: string | null = null;
    do {
      const page = object(await this.request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }));
      if (!Array.isArray(page.data)) throw new Error("Expected model list data array");
      models.push(...page.data.map(model));
      cursor = page.nextCursor == null ? null : string(page.nextCursor);
    } while (cursor);
    return models;
  }

  async compactThread(threadId: string) {
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

  async forkThread(threadId: string, settings: ThreadSettings = {}) {
    const result = await this.request("thread/fork", {
      threadId,
      model: settings.model ?? this.options.model ?? null,
      cwd: settings.cwd || this.options.cwd,
      sandbox: this.options.sandbox,
      approvalPolicy: this.options.approvalPolicy,
    });
    this.loadedThreads.add(string(object(object(result).thread).id));
    return { id: string(object(object(result).thread).id) };
  }

  async reviewThread(threadId: string) {
    const result = await this.request("review/start", { threadId, target: { type: "uncommittedChanges" } });
    const turnId = string(object(object(result).turn).id);
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
    this.initialized = false;

    if (this.child && !this.child.killed) {
      await killProcessTree(this.child.pid);
      await sleep(300);
    }
  }
}
