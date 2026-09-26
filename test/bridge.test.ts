import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { runBridgeCtl } from "../scripts/bridgectl.js";
import { PATHS } from "../src/constants.js";
import { temporaryData } from "./helpers.js";

await test("bridge start, status and stop use the stored PID and compiled entry", async (t) => {
  temporaryData(t);
  const child = Object.assign(new childProcess.ChildProcess(), { pid: 123456 });
  const spawned: string[][] = [];
  const spawn = t.mock.method(childProcess, "spawn", (command: string, args: string[]) => {
    spawned.push([command, ...args]);
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { spawn.mock.restore(); syncBuiltinESMExports(); });
  let running = true;
  t.mock.method(process, "kill", (pid: number, signal: string | number) => {
    assert.equal(pid, 123456);
    if (!running) throw new Error("ESRCH");
    if (signal === "SIGTERM") running = false;
    return true;
  });
  await runBridgeCtl(["start", "--cwd", "/tmp/example"]);
  assert.equal(fs.readFileSync(PATHS.bridgePid, "utf8").trim(), "123456");
  assert.match(spawned[0][1], /dist\/cli\.js$/);
  assert.deepEqual(spawned[0].slice(2), ["start", "--cwd", "/tmp/example"]);
  await runBridgeCtl(["start"]);
  assert.equal(spawned.length, 1);
  await runBridgeCtl(["status"]);
  await runBridgeCtl(["stop"]);
  assert.equal(running, false);
  assert.equal(fs.existsSync(PATHS.bridgePid), false);
  await runBridgeCtl(["stop"]);
});
