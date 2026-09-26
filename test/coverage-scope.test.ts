import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { checkCoverageScope } from "../tools/check-coverage.js";

await test("an empty report or missing production module cannot pass the coverage gate", () => {
  assert.throws(() => checkCoverageScope({ total: {} }, ["cli.ts"]), /missing cli.ts/);
  assert.throws(() => checkCoverageScope({ [path.resolve("cli.ts")]: { lines: { total: 0 } } }, ["cli.ts"]), /Empty coverage/);
  assert.doesNotThrow(() => checkCoverageScope({ [path.resolve("cli.ts")]: { lines: { total: 1 } } }, ["cli.ts"]));
});
