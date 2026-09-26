import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { runSetup } from "../src/setup.js";
import { PATHS } from "../src/constants.js";
import { temporaryData } from "./helpers.js";

await test("QR setup saves credentials and later noninteractive setup preserves them", async (t) => {
  temporaryData(t);
  const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  t.after(() => {
    if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
    else Reflect.deleteProperty(process.stdin, "isTTY");
  });
  const fetch = t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    return String(input).includes("get_bot_qrcode")
      ? Response.json({ qrcode: "qr", qrcode_img_content: "https://wechat.invalid/qr" })
      : Response.json({ status: "confirmed", ilink_bot_id: "bot", bot_token: "fake-token", ilink_user_id: "user" });
  });
  const account = await runSetup({ baseUrl: "https://wechat.invalid", force: true });
  assert.equal(account.token, "fake-token");
  assert.equal(account.accountId, "bot");
  assert.equal(fs.statSync(PATHS.account).mode & 0o777, 0o600);
  const requests = fetch.mock.callCount();
  assert.deepEqual(await runSetup(), account);
  assert.equal(fetch.mock.callCount(), requests);
});
