import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { object } from "../src/protocol.js";

export function checkCoverageScope(value: unknown, expected: string[]): void {
  const summary = object(value);
  if (expected.length === 0) throw new Error("Production source list is empty");
  for (const file of expected) {
    const entry = summary[path.resolve(file)];
    if (!entry) throw new Error(`Coverage report is missing ${file}`);
    const lines = object(object(entry).lines);
    if (typeof lines.total !== "number" || lines.total <= 0) throw new Error(`Empty coverage entry: ${file}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sources = ["cli.ts", ...["src", "scripts"].flatMap((directory) =>
    fs.readdirSync(directory, { recursive: true }).filter((file) => String(file).endsWith(".ts"))
      .map((file) => path.join(directory, String(file))))];
  checkCoverageScope(JSON.parse(fs.readFileSync("coverage/coverage-summary.json", "utf8")), sources);
  console.log(`Coverage scope verified: ${sources.length} production files`);
}
