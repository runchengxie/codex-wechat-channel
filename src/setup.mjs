import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  DEFAULT_WECHAT_BASE_URL,
  PATHS,
  ensureDir,
  loadJson,
  saveJson,
} from "./constants.mjs";
import { loginWithQr } from "./wechat-api.mjs";

function log(message) {
  process.stderr.write(`[setup] ${message}\n`);
}

async function shouldRelogin() {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question("Existing account found. Re-login? [y/N] ");
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

export async function runSetup(options = {}) {
  ensureDir(PATHS.dataDir);

  const existing = loadJson(PATHS.account, null);
  if (existing && !options.force) {
    log(`existing account: ${existing.accountId} (${existing.savedAt})`);
    if (process.stdin.isTTY) {
      const confirmed = await shouldRelogin();
      if (!confirmed) {
        log("keeping existing credentials");
        return existing;
      }
    } else {
      log("use --force to overwrite existing credentials");
      return existing;
    }
  }

  const account = await loginWithQr({
    baseUrl: options.baseUrl || DEFAULT_WECHAT_BASE_URL,
    onQr(qr) {
      log("scan this QR URL in WeChat or open it in a browser:");
      log(qr.qrcode_img_content);
    },
  });

  saveJson(PATHS.account, account);
  log(`saved credentials to ${PATHS.account}`);
  return account;
}
