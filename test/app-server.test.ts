import assert from "node:assert/strict";
import test from "node:test";
import { ChildProcess } from "node:child_process";

import { CodexAppServerClient } from "../src/codex-app-server.js";

await test("unknown app-server notifications can omit params", () => {
  const client = new CodexAppServerClient();
  assert.doesNotThrow(() => client.handleNotification("future/notification", undefined));
});

await test("compaction waits for completion notification", async () => {
  const client = new CodexAppServerClient();
  client.request = async (method) => {
    assert.equal(method, "thread/compact/start");
    return {};
  };
  let finished = false;
  const compacting = client.compactThread("thread-1").then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  client.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "unrelated-turn", status: "completed" } });
  await Promise.resolve();
  assert.equal(finished, false);
  client.handleNotification("item/started", { threadId: "thread-1", turnId: "compact-1", item: { type: "contextCompaction" } });
  client.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "compact-1", status: "completed" } });
  await compacting;
  assert.equal(finished, true);
});

await test("review collects its final message and ignores unrelated turn starts", async () => {
  const client = new CodexAppServerClient();
  client.request = async (method) => {
    assert.equal(method, "review/start");
    return { turn: { id: "review-1" } };
  };
  const reviewing = client.reviewThread("thread-1");
  await Promise.resolve();
  client.handleNotification("turn/started", { turn: { id: "unrelated" } });
  assert.equal(client.turnWaiters.has("unrelated"), false);
  client.handleNotification("item/completed", { turnId: "review-1", item: { type: "agentMessage", phase: "final_answer", text: "Review done" } });
  client.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "review-1", status: "completed" } });
  assert.equal((await reviewing).text, "Review done");
});

await test("a failed turn completed before its RPC response still fails", async () => {
  const client = new CodexAppServerClient();
  client.request = async () => {
    client.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "failed", error: { message: "model unavailable" } } });
    return { turn: { id: "turn-1" } };
  };
  await assert.rejects(client.sendTurn("thread-1", []), /model unavailable/);
});

await test("a turn that never completes times out and releases its waiter", async () => {
  const client = new CodexAppServerClient({ turnTimeoutMs: 10 });
  client.request = async () => ({ turn: { id: "turn-timeout" } });

  const result = await Promise.race([
    client.sendTurn("thread-1", []).then(
      () => "resolved",
      (error) => error,
    ),
    new Promise((resolve) => setTimeout(() => resolve("still-pending"), 50)),
  ]);

  assert.ok(result instanceof Error, "the turn should reject before the test deadline");
  assert.match(result.message, /timed out/);
  assert.equal(client.turnWaiters.has("turn-timeout"), false);
});

await test("socket close clears loaded threads and concurrent reconnects share one connection", async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  const sockets: FakeWebSocket[] = [];

  class FakeWebSocket extends EventTarget {
    static OPEN = 1;

    readyState = 0;

    url: string;

    constructor(url: string) {
      super();
      this.url = url;
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.dispatchEvent(new Event("open"));
      });
    }

    send(raw: string) {
      const request = JSON.parse(raw);
      if (request.method !== "initialize") return;
      queueMicrotask(() => {
        this.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }),
          }),
        );
      });
    }

    close() {
      this.readyState = 3;
      const event = new Event("close");
      Object.assign(event, { code: 1000, reason: "closed by test" });
      this.dispatchEvent(event);
    }
  }

  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: FakeWebSocket,
  });

  try {
    const client = new CodexAppServerClient({ appServerUrl: "ws://127.0.0.1:4501" });
    await Promise.all([client.connect(), client.connect()]);
    assert.equal(sockets.length, 1);
    assert.equal(client.isConnected(), true);

    client.loadedThreads.add("thread-1");
    sockets[0].close();
    assert.equal(client.isConnected(), false);
    assert.equal(client.loadedThreads.size, 0);

    await Promise.all([client.connect(), client.connect()]);
    assert.equal(sockets.length, 2);
    assert.equal(client.isConnected(), true);
    await client.close();
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "WebSocket", originalDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "WebSocket");
    }
  }
});

await test("connect waits for initialization and retries after initialization fails", async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  const sockets: FakeWebSocket[] = [];
  let releaseInitialize: () => void = () => assert.fail("initialize was not requested");
  let failFirstInitialize = true;

  class FakeWebSocket extends EventTarget {
    static OPEN = 1;
    readyState = 0;

    constructor() {
      super();
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.dispatchEvent(new Event("open"));
      });
    }

    send(raw: string) {
      const request = JSON.parse(raw);
      if (request.method !== "initialize") return;
      if (failFirstInitialize) {
        releaseInitialize = () => this.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { message: "init failed" } }),
        }));
        failFirstInitialize = false;
        return;
      }
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }),
      })));
    }

    close() {
      this.readyState = 3;
      const event = new Event("close");
      Object.assign(event, { code: 1000, reason: "closed by test" });
      this.dispatchEvent(event);
    }
  }

  Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: FakeWebSocket });
  try {
    const client = new CodexAppServerClient({ appServerUrl: "ws://127.0.0.1:4501" });
    const first = client.connect();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(client.isConnected(), false);
    let secondSettled = false;
    const second = client.connect().finally(() => { secondSettled = true; });
    await Promise.resolve();
    assert.equal(secondSettled, false);
    releaseInitialize();
    await assert.rejects(first, /init failed/);
    await assert.rejects(second, /init failed/);
    assert.equal(client.isConnected(), false);

    await client.connect();
    assert.equal(sockets.length, 2);
    assert.equal(client.isConnected(), true);
    await client.close();
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, "WebSocket", originalDescriptor);
    else Reflect.deleteProperty(globalThis, "WebSocket");
  }
});

await test("an embedded app-server is reused while its child process is alive", async () => {
  const client = new CodexAppServerClient();
  client.child = new ChildProcess();
  client.embeddedAppServerUrl = "ws://127.0.0.1:4502";

  assert.equal(await client.startEmbeddedAppServer(), client.embeddedAppServerUrl);
  assert.equal(client.child.exitCode, null);
});
