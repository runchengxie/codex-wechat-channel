import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSources } from "../tools/maintenance-report.js";

test("the AST report measures branches, excludes nested function decisions, and resolves imports and calls", () => {
  const report = analyzeSources({
    "a.ts": 'import { b } from "./b.js";\nexport function a(value: boolean) {\n  if (value) { while (value) { b(); break; } }\n  return () => value ? 1 : 0;\n}\n',
    "b.ts": 'import { a } from "./a.js";\nexport function b() { return a(false); }\n',
  });
  assert.equal(report.totalLoc, 7);
  const a = report.functions.find((entry) => entry.id.endsWith(":a"));
  assert.ok(a);
  assert.equal(a.cyclomatic, 3);
  assert.equal(a.cognitiveApproximation, 3);
  assert.deepEqual(report.cycles, [["a.ts", "b.ts"]]);
  assert.equal(report.files[0].fanIn, 1);
  assert.equal(report.files[0].fanOut, 1);
  assert.ok(report.calls.some((edge) => edge.from.endsWith(":a") && edge.to.endsWith(":b")));
  assert.ok(report.calls.some((edge) => edge.from.endsWith(":b") && edge.to.endsWith(":a")));
});

test("logical decisions, switch cases, empty files, and type-only imports have documented counts", () => {
  const report = analyzeSources({
    "empty.ts": "",
    "types.ts": "export interface Shape { value: number }\n",
    "use.ts": 'import type { Shape } from "./types.js";\nexport function f(x: Shape) { switch(x.value) { case 1: return x.value || 2; default: return 0; } }\n',
  });
  assert.equal(report.files.find((file) => file.file === "empty.ts")?.loc, 0);
  assert.equal(report.functions[0].cyclomatic, 3);
  assert.equal(report.functions[0].cognitiveApproximation, 2);
  assert.equal(report.imports[0].typeOnly, true);
  assert.deepEqual(report.cycles, []);
});
