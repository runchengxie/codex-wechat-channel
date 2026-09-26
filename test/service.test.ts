import assert from "node:assert/strict";
import test from "node:test";
import { renderBridgeService, renderWatchService } from "../scripts/servicectl.js";
import { runServiceCtl } from "../scripts/servicectl.js";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import { temporaryData } from "./helpers.js";

await test("systemd units reference compiled CLI and packaged watcher", () => {
  const bridge = renderBridgeService({ user: "tester", cwd: "/tmp/work space", homeDir: "/home/tester" });
  assert.match(bridge, /User=tester/);
  assert.match(bridge, /PIDFile=\/home\/tester\/\.codex\/channels\/wechat\/bridge.pid/);
  assert.match(bridge, /dist\/cli\.js" bridge start --cwd "\/tmp\/work space"/);
  assert.doesNotMatch(bridge, /cli\.mjs/);
  const watcher = renderWatchService({ homeDir: "/home/tester", serviceName: "test.service" });
  assert.match(watcher, /dist\/scripts\/watch-codex-config\.sh/);
  assert.match(watcher, /"\/home\/tester" "test.service"/);
});

await test("service install and removal invoke the expected commands without system mutations", async (t) => {
  const root = temporaryData(t);
  const calls: string[][] = [];
  const units: string[] = [];
  const spawn = t.mock.method(childProcess, "spawnSync", (command: string, args: string[]) => {
    calls.push([command, ...args]);
    const installIndex = [command, ...args].indexOf("install");
    if (installIndex >= 0 && args.includes("0644")) {
      const source = args[args.indexOf("0644") + 1];
      units.push(fs.readFileSync(source, "utf8"));
    }
    return { pid: 123, status: 0, signal: null, output: [], stdout: "", stderr: "" };
  });
  syncBuiltinESMExports();
  t.after(() => { spawn.mock.restore(); syncBuiltinESMExports(); });
  const flags = ["--cwd", root, "--home", root, "--service-name", "test-bridge", "--watch-service-name", "test-watch"];
  await runServiceCtl(["install", ...flags]);
  assert.equal(units.length, 2);
  assert.ok(calls.some((args) => args.includes("enable") && args.includes("test-bridge.service")));
  await runServiceCtl(["status", ...flags]);
  await runServiceCtl(["uninstall", ...flags]);
  assert.ok(calls.some((args) => args.includes("disable") && args.includes("--now")));
  assert.ok(calls.some((args) => args.includes("rm") && args.includes("/etc/systemd/system/test-watch.service")));
});
