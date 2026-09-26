import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { object, string } from "../src/protocol.js";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check through npm run check:package");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-package-"));

function npm(args: string[]): string {
  return execFileSync(process.execPath, [npmCli!, ...args], { encoding: "utf8" });
}

try {
  const packs: unknown = JSON.parse(npm(["pack", "--json", "--ignore-scripts", "--pack-destination", temporary]));
  assert.ok(Array.isArray(packs) && packs.length === 1);
  const pack = object(packs[0]);
  assert.ok(Array.isArray(pack.files));
  const files = new Set(pack.files.map((file: unknown) => string(object(file).path)));
  for (const required of ["dist/cli.js", "dist/cli.js.map", "dist/src/start.js", "dist/scripts/watch-codex-config.sh", "docs/maintenance-audit.md", "docs/usage.md", "docs/configuration.md", "docs/development.md"]) {
    assert.ok(files.has(required), `Package is missing ${required}`);
  }
  for (const file of files) {
    assert.ok(!/^(test|tools|src|scripts|dist\/test|dist\/tools|docs\/superpowers)\//.test(file), `Unexpected development file: ${file}`);
  }
  const prefix = path.join(temporary, "installed");
  npm(["install", "--prefix", prefix, path.join(temporary, string(pack.filename)), "--ignore-scripts", "--no-audit", "--no-fund"]);
  const executable = path.join(prefix, "node_modules", ".bin", "codex-wechat-channel");
  const output = process.platform === "win32"
    ? execFileSync(process.execPath, [path.join(prefix, "node_modules/codex-wechat-channel/dist/cli.js"), "help"], { encoding: "utf8" })
    : execFileSync(executable, ["help"], { encoding: "utf8" });
  assert.match(output, /Usage:/);
  console.log(`Package verified: ${files.size} files; installed executable prints help`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
