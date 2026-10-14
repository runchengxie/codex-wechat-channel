import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { object, string } from "../src/protocol.js";
import { temporaryData } from "./helpers.js";

const require = createRequire(import.meta.url);
const mammothManifest = require.resolve("mammoth/package.json");
const parserRequire = createRequire(mammothManifest);
const cli = path.join(path.dirname(mammothManifest), "bin", "mammoth");
const fixture = path.resolve("test/fixtures/attachment.docx");
const html = "<p>DOCX attachment text</p><p>第二段内容</p>";

function convert(args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 10_000 });
  assert.ifError(result.error);
  return result;
}

await test("Word CLI parser uses the validated version without sprintf-js", () => {
  const manifest = object(JSON.parse(fs.readFileSync(parserRequire.resolve("argparse/package.json"), "utf8")));
  assert.equal(string(manifest.version), "2.0.1");
  assert.throws(() => parserRequire.resolve("sprintf-js"), { code: "MODULE_NOT_FOUND" });
});

await test("Mammoth CLI keeps help, Unicode, formats and output options compatible", (t) => {
  const root = temporaryData(t);
  const help = convert(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--output-format/);
  const standard = convert([fixture]);
  assert.equal(standard.status, 0, standard.stderr);
  assert.equal(standard.stdout, html);
  const markdown = convert([fixture, "--output-format", "markdown"]);
  assert.equal(markdown.status, 0, markdown.stderr);
  assert.equal(markdown.stdout, "DOCX attachment text\n\n第二段内容\n\n");
  const output = path.join(root, "converted.html");
  assert.equal(convert([fixture, output]).status, 0);
  assert.equal(fs.readFileSync(output, "utf8"), html);
  const directory = path.join(root, "output");
  fs.mkdirSync(directory);
  assert.equal(convert([fixture, "--output-dir", directory]).status, 0);
  assert.equal(fs.readFileSync(path.join(directory, "attachment.html"), "utf8"), html);
  const styleMap = path.join(root, "style-map.txt");
  fs.writeFileSync(styleMap, "p => h2:fresh");
  const styled = convert([fixture, "--style-map", styleMap]);
  assert.equal(styled.status, 0, styled.stderr);
  assert.equal(styled.stdout, "<h2>DOCX attachment text</h2><h2>第二段内容</h2>");
  const invalid = convert([fixture, output, "--output-dir", directory]);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /not allowed with argument/i);
});
