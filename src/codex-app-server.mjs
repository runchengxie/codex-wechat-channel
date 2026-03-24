import { spawn } from "node:child_process";
import net from "node:net";

import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_CODEX_BIN,
  DEFAULT_SANDBOX,
} from "./constants.mjs";

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
      serviceName: "codex-wechat-channel",
      ...options,
    };
    this.pending = new Map();
    this.turnWaiters = new Map();
    this.loadedThreads = new Set();
    this.nextId = 1;
    this.socket = null;
    this.child = null;
    this.closeReason = null;
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
  }

  async startEmbeddedAppServer() {
    const port = await getFreePort();
    const wsUrl = `ws://127.0.0.1:${port}`;
    const readyUrl = `http://127.0.0.1:${port}/readyz`;
    const args = ["app-server", "--listen", wsUrl];
    const spawnOptions = {
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
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
          pending.method === "turn/start" &&
          message.result?.turn?.id &&
          !this.turnWaiters.has(message.result.turn.id)
        ) {
          this.turnWaiters.set(message.result.turn.id, createTurnWaiter());
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
        const waiter = this.turnWaiters.get(params.turnId);
        if (waiter) {
          waiter.stream.push(params.delta);
        }
        return;
      }
      case "item/completed": {
        const waiter = this.turnWaiters.get(params.turnId);
        if (!waiter) {
          return;
        }

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
        const waiter = this.turnWaiters.get(params.turn.id);
        if (!waiter) {
          return;
        }

        this.turnWaiters.delete(params.turn.id);
        if (params.turn.status === "completed") {
          waiter.resolve({
            text:
              waiter.finalText ||
              waiter.stream.join("").trim() ||
              waiter.commentary.join("\n").trim(),
            commentary: waiter.commentary.join("\n").trim(),
          });
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
    return pending.promise;
  }

  isThreadLoaded(threadId) {
    return this.loadedThreads.has(threadId);
  }

  buildThreadParams() {
    return {
      cwd: this.options.cwd,
      model: this.options.model ?? null,
      approvalPolicy: this.options.approvalPolicy,
      sandbox: this.options.sandbox,
      serviceName: this.options.serviceName,
      developerInstructions: this.options.developerInstructions,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    };
  }

  async createThread({ name } = {}) {
    const result = await this.request("thread/start", this.buildThreadParams());
    this.loadedThreads.add(result.thread.id);
    if (name) {
      await this.setThreadName(result.thread.id, name);
    }
    return result.thread;
  }

  async resumeThread(threadId, { name } = {}) {
    const result = await this.request("thread/resume", {
      threadId,
      cwd: this.options.cwd,
      model: this.options.model ?? null,
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

  async sendTurn(threadId, input) {
    const result = await this.request("turn/start", {
      threadId,
      input,
      model: this.options.model ?? null,
    });
    const turnId = result.turn.id;
    const waiter = this.turnWaiters.get(turnId) || createTurnWaiter();
    if (!this.turnWaiters.has(turnId)) {
      this.turnWaiters.set(turnId, waiter);
    }
    return waiter.promise;
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
