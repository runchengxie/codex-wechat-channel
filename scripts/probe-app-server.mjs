import { CodexAppServerClient } from "../src/codex-app-server.mjs";

const client = new CodexAppServerClient({
  cwd: process.cwd(),
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
  const deadline = 30_000;
  process.stderr.write("[probe] connect\n");
  await Promise.race([
    client.connect(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("connect timeout")), deadline),
    ),
  ]);
  process.stderr.write("[probe] connected\n");
  const thread = await Promise.race([
    client.createThread({ name: "probe" }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("thread start timeout")), deadline),
    ),
  ]);
  process.stderr.write(`[probe] thread ${thread.id}\n`);
  const result = await Promise.race([
    client.sendTurn(thread.id, [
      {
        type: "text",
        text: "Reply with exactly: PONG",
        text_elements: [],
      },
    ]),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("turn timeout")), deadline),
    ),
  ]);
  process.stderr.write("[probe] turn completed\n");
  console.log(result.text);
} finally {
  await client.close();
}
