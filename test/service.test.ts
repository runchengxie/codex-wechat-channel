import assert from "node:assert/strict";
import test from "node:test";
import { renderBridgeService, renderWatchService } from "../scripts/servicectl.js";

test("systemd units reference compiled CLI and packaged watcher", () => {
  const bridge = renderBridgeService({ user: "tester", cwd: "/tmp/work space", homeDir: "/home/tester" });
  assert.match(bridge, /User=tester/);
  assert.match(bridge, /PIDFile=\/home\/tester\/\.codex\/channels\/wechat\/bridge.pid/);
  assert.match(bridge, /dist\/cli\.js" bridge start --cwd "\/tmp\/work space"/);
  assert.doesNotMatch(bridge, /cli\.mjs/);
  const watcher = renderWatchService({ homeDir: "/home/tester", serviceName: "test.service" });
  assert.match(watcher, /dist\/scripts\/watch-codex-config\.sh/);
  assert.match(watcher, /"\/home\/tester" "test.service"/);
});
