import path from "node:path";
import { fileURLToPath } from "node:url";

import { CodexAppServerClient } from "../src/codex-app-server.js";

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

async function withDeadline<T>(operation: Promise<T>, deadlineMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timeout`)), deadlineMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function runProbe(options: { cwd?: string; deadlineMs?: number } = {}) {
  const client = new CodexAppServerClient({
    cwd: options.cwd || process.cwd(),
    approvalPolicy: "never",
    sandbox: process.env.CODEX_WECHAT_SANDBOX || "danger-full-access",
    developerInstructions: "Reply succinctly. Do not run tools.",
    log(message) {
      process.stderr.write(`[probe] ${message}\n`);
    },
    logError(message) {
      process.stderr.write(`[probe] ERROR: ${message}\n`);
    },
  });

  try {
    const deadline = options.deadlineMs || 30_000;
    process.stderr.write("[probe] connect\n");
    await withDeadline(client.connect(), deadline, "connect");
    process.stderr.write("[probe] connected\n");
    const thread = await withDeadline(client.createThread({ name: "probe" }), deadline, "thread start");
    process.stderr.write(`[probe] thread ${thread.id}\n`);
    const result = await withDeadline(client.sendTurn(thread.id, [{
      type: "text",
      text: "Reply with exactly: PONG",
      text_elements: [],
    }]), deadline, "turn");
    process.stderr.write("[probe] turn completed\n");
    console.log(result.text);
    return result;
  } finally {
    await client.close();
  }
}

if (isMainModule()) {
  await runProbe();
}
