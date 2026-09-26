import assert from "node:assert/strict";
import test from "node:test";

import { isSenderAllowed, parseAllowedUsers } from "../src/access-control.js";

await test("an empty allowlist preserves the current allow-all behavior", () => {
  assert.deepEqual([...parseAllowedUsers(undefined)], []);
  assert.deepEqual([...parseAllowedUsers(" ,  ,")], []);
  assert.equal(isSenderAllowed("user-1", parseAllowedUsers("")), true);
});

await test("allowlist entries are trimmed, empty entries removed, and duplicates collapsed", () => {
  assert.deepEqual(
    [...parseAllowedUsers(" user-1, ,user-2,user-1 ")],
    ["user-1", "user-2"],
  );
});

await test("configured allowlists require an exact sender ID match", () => {
  const allowedUsers = parseAllowedUsers("User-1");

  assert.equal(isSenderAllowed("User-1", allowedUsers), true);
  assert.equal(isSenderAllowed("user-1", allowedUsers), false);
  assert.equal(isSenderAllowed("user-2", allowedUsers), false);
  assert.equal(isSenderAllowed(null, allowedUsers), false);
});
