import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  DEFAULT_WECHAT_BASE_URL,
  PATHS,
  ensureDir,
  loadJson,
  saveJson,
} from "./constants.js";
import { loginWithQr } from "./wechat-api.js";

import { accountFromJson, type Account } from "./wechat-types.js";

function log(message: string): void {
  process.stderr.write(`[setup] ${message}\n`);
}

async function shouldRelogin(): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question("Existing account found. Re-login? [y/N] ");
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

export async function runSetup(
  options: { force?: boolean; baseUrl?: string } = {},
): Promise<Account> {
  ensureDir(PATHS.dataDir);

  const saved = loadJson(PATHS.account, null);
  const existing = saved === null ? null : accountFromJson(saved);
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
    onQr(qr: { qrcode_img_content: string }) {
      log("scan this QR URL in WeChat or open it in a browser:");
      log(qr.qrcode_img_content);
    },
  });

  saveJson(PATHS.account, account);
  log(`saved credentials to ${PATHS.account}`);
  return account;
}
