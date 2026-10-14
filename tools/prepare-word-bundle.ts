import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { object, string } from "../src/protocol.js";

const action = process.argv[2];
assert.ok(action === "prepare" || action === "restore", "Specify prepare or restore");
const require = createRequire(import.meta.url);
const manifestPath = require.resolve("mammoth/package.json");
const manifest = object(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
const dependencies = object(manifest.dependencies);
const lock = object(JSON.parse(fs.readFileSync("package-lock.json", "utf8")));
const packages = object(lock.packages);
const lockedMammoth = object(packages["node_modules/mammoth"]);
const originalRange = string(object(lockedMammoth.dependencies).argparse);
const parserVersion = string(object(packages["node_modules/argparse"]).version);
assert.equal(manifest.version, lockedMammoth.version, "Word bundle must use the locked Mammoth release");
assert.equal(originalRange, "~1.0.3", "Review compatibility before changing the upstream parser range");
assert.equal(parserVersion, "2.0.1", "Word bundle must use the validated parser");
if (action === "prepare") {
  const parserPath = createRequire(manifestPath).resolve("argparse/package.json");
  const installedParser = object(JSON.parse(fs.readFileSync(parserPath, "utf8")));
  assert.equal(installedParser.version, parserVersion, "Run npm ci before packaging a stale Word parser");
}
assert.ok(dependencies.argparse === originalRange || dependencies.argparse === parserVersion);
// An installed package cannot inherit the root override. Declare its actual bundled parser.
dependencies.argparse = action === "prepare" ? parserVersion : originalRange;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
