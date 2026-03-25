import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PACKAGE_NAME = "codex-wechat-channel";
export const PACKAGE_VERSION = "0.1.2";
export const DEFAULT_WECHAT_BASE_URL =
  process.env.CODEX_WECHAT_BASE_URL || "https://ilinkai.weixin.qq.com";
export const DEFAULT_SANDBOX =
  process.env.CODEX_WECHAT_SANDBOX || "danger-full-access";
export const DEFAULT_APPROVAL_POLICY =
  process.env.CODEX_WECHAT_APPROVAL_POLICY || "never";
export const DEFAULT_CODEX_BIN = process.env.CODEX_BIN || "codex";
export const DEFAULT_DATA_DIR = path.join(
  os.homedir(),
  ".codex",
  "channels",
  "wechat",
);

export const PATHS = {
  dataDir: DEFAULT_DATA_DIR,
  account: path.join(DEFAULT_DATA_DIR, "account.json"),
  bridgePid: path.join(DEFAULT_DATA_DIR, "bridge.pid"),
  bridgeStderr: path.join(DEFAULT_DATA_DIR, "bridge.stderr.log"),
  bridgeStdout: path.join(DEFAULT_DATA_DIR, "bridge.stdout.log"),
  contextTokens: path.join(DEFAULT_DATA_DIR, "context_tokens.json"),
  threads: path.join(DEFAULT_DATA_DIR, "threads.json"),
  syncBuf: path.join(DEFAULT_DATA_DIR, "sync_buf.txt"),
  mediaDir: path.join(DEFAULT_DATA_DIR, "media"),
};

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function saveJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function loadText(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

export function saveText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, "utf8");
}

export function nowIso() {
  return new Date().toISOString();
}

export function shortId(value) {
  return String(value || "unknown").split("@")[0] || String(value || "unknown");
}
