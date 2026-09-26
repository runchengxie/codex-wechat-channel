import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { PATHS } from "../src/constants.js";

/** Each test process owns these paths and restores them before the next test. */
export function temporaryData(t: TestContext): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-test-"));
  const saved = { ...PATHS };
  for (const key of Object.keys(PATHS) as (keyof typeof PATHS)[]) {
    PATHS[key] = key === "dataDir" ? root : path.join(root, path.basename(saved[key]));
  }
  t.after(() => {
    Object.assign(PATHS, saved);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
