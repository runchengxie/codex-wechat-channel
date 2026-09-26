import path from "node:path";
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectRoot, "dist", "scripts");
await mkdir(outputDir, { recursive: true });
await cp(
  path.join(projectRoot, "scripts", "watch-codex-config.sh"),
  path.join(outputDir, "watch-codex-config.sh"),
);
