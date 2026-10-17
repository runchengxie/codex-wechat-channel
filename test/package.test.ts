import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { singlePackage } from "../tools/package-result.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const compiledOutputDirectory = path.basename(path.dirname(testDirectory)) === "dist";
const cliPath = compiledOutputDirectory
  ? path.resolve(testDirectory, "..", "cli.js")
  : path.resolve(testDirectory, "..", "dist", "cli.js");

await test("npm pack array output resolves to one named package", () => {
  const pack = { name: "codex-wechat-channel", filename: "codex-wechat-channel-0.1.2.tgz" };
  assert.deepEqual(singlePackage([pack], "codex-wechat-channel"), pack);
});

await test("npm pack package-keyed output resolves to one named package", () => {
  const pack = { name: "codex-wechat-channel", filename: "codex-wechat-channel-0.1.2.tgz" };
  assert.deepEqual(singlePackage({ "codex-wechat-channel": pack }, "codex-wechat-channel"), pack);
});

await test("npm pack rejects errors and multiple package results", () => {
  assert.throws(() => singlePackage({ error: { code: "EROFS" } }, "codex-wechat-channel"));
  assert.throws(() => singlePackage([], "codex-wechat-channel"));
  assert.throws(() => singlePackage([{ name: "other-package" }], "codex-wechat-channel"));
});

await test("the compiled CLI package entry prints help", () => {
  const output = execFileSync(
    process.execPath,
    [cliPath, "help"],
    { encoding: "utf8" },
  );

  assert.match(output, /Usage:/);
  assert.match(output, /start .*--cwd DIR.*--model MODEL.*--app-server-url WS_URL/);
  assert.match(output, /--base-url URL.*--sandbox MODE.*--approval-policy POLICY/);
  assert.match(output, /--service-name NAME/);
  assert.match(output, /--watch-service-name NAME/);
});
