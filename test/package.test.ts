import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const compiledOutputDirectory = path.basename(path.dirname(testDirectory)) === "dist";
const cliPath = compiledOutputDirectory
  ? path.resolve(testDirectory, "..", "cli.js")
  : path.resolve(testDirectory, "..", "dist", "cli.js");

await test("the compiled CLI package entry prints help", () => {
  const output = execFileSync(
    process.execPath,
    [cliPath, "help"],
    { encoding: "utf8" },
  );

  assert.match(output, /Usage:/);
});
