import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { PATHS, ensureDir, loadText, saveText } from "../src/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CLI_PATH = path.join(PROJECT_ROOT, "cli.js");

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function log(message: string) {
  process.stderr.write(`[bridgectl] ${message}\n`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProcessExit(pid: number, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await sleep(250);
  }

  return !isProcessRunning(pid);
}

function removeFile(filePath: string) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore missing files
  }
}

function readBridgePid() {
  const raw = loadText(PATHS.bridgePid, "").trim();
  if (!raw) {
    return null;
  }

  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isProcessRunning(pid: number | null | undefined) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killProcessTree(pid: number) {
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

function tailLog(filePath: string, lines = 20) {
  const text = loadText(filePath, "").trim();
  if (!text) {
    return "";
  }

  return text.split(/\r?\n/).slice(-lines).join("\n");
}

function clearBridgePid() {
  removeFile(PATHS.bridgePid);
}

function printUsage() {
  console.log(`Usage:
  codex-wechat-channel bridge start [--cwd DIR] [--model MODEL]
  codex-wechat-channel bridge stop
  codex-wechat-channel bridge status

Examples:
  codex-wechat-channel bridge start
  codex-wechat-channel bridge start --cwd D:\\workspace\\repo --model gpt-5.4
  codex-wechat-channel bridge stop`);
}

async function startBridge(extraArgs: string[]) {
  ensureDir(PATHS.dataDir);

  const existingPid = readBridgePid();
  if (existingPid && isProcessRunning(existingPid)) {
    log(`bridge already running pid=${existingPid}`);
    log(`stdout log: ${PATHS.bridgeStdout}`);
    log(`stderr log: ${PATHS.bridgeStderr}`);
    return;
  }

  if (existingPid) {
    clearBridgePid();
  }

  const stdoutFd = fs.openSync(PATHS.bridgeStdout, "w");
  const stderrFd = fs.openSync(PATHS.bridgeStderr, "w");
  const child = spawn(process.execPath, [CLI_PATH, "start", ...extraArgs], {
    cwd: PROJECT_ROOT,
    detached: true,
    env: process.env,
    stdio: ["ignore", stdoutFd, stderrFd],
    windowsHide: true,
  });

  fs.closeSync(stdoutFd);
  fs.closeSync(stderrFd);
  child.unref();
  saveText(PATHS.bridgePid, `${child.pid}\n`);

  await sleep(1500);
  if (!isProcessRunning(child.pid)) {
    clearBridgePid();
    const lastError = tailLog(PATHS.bridgeStderr);
    throw new Error(
      lastError
        ? `bridge failed to stay alive after launch.\n${lastError}`
        : "bridge failed to stay alive after launch.",
    );
  }

  log(`bridge started pid=${child.pid}`);
  log(`stdout log: ${PATHS.bridgeStdout}`);
  log(`stderr log: ${PATHS.bridgeStderr}`);
}

async function stopBridge() {
  const pid = readBridgePid();
  if (!pid) {
    log("bridge is not running");
    return;
  }

  if (!isProcessRunning(pid)) {
    clearBridgePid();
    log(`stale pid file removed: ${pid}`);
    return;
  }

  await killProcessTree(pid);
  const stopped = await waitForProcessExit(pid);
  if (!stopped) {
    throw new Error(`bridge process still running after stop attempt: ${pid}`);
  }
  clearBridgePid();
  log(`bridge stopped pid=${pid}`);
}

function printStatus() {
  const pid = readBridgePid();
  if (pid && isProcessRunning(pid)) {
    console.log(`running pid=${pid}`);
  } else {
    if (pid) {
      clearBridgePid();
    }
    console.log("stopped");
  }

  console.log(`pid file: ${PATHS.bridgePid}`);
  console.log(`stdout log: ${PATHS.bridgeStdout}`);
  console.log(`stderr log: ${PATHS.bridgeStderr}`);
}

export async function runBridgeCtl(argv = process.argv.slice(2)) {
  const command = argv[0] ?? "status";
  const separatorIndex = argv.indexOf("--");
  const extraArgs =
    separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : argv.slice(1);

  switch (command) {
    case "start":
      await startBridge(extraArgs);
      return;
    case "stop":
      await stopBridge();
      return;
    case "status":
      printStatus();
      return;
    case "help":
    case "--help":
    case "-h":
      printUsage();
      return;
    default:
      printUsage();
      process.exit(1);
  }
}

if (isMainModule()) {
  await runBridgeCtl();
}
