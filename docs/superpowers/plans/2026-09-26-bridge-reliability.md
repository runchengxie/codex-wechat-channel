# Bridge Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional sender filtering, avoid advancing the WeChat cursor before a batch finishes, bound Codex turn waits, reconnect the app-server, and run the checks in public CI.

**Architecture:** Keep the Node.js ESM runtime and existing service layout. Add small testable helpers for sender checks and update batch completion, and make the app-server client reconnect-safe with bounded turn waiters. Add a GitHub Actions workflow using Node.js 22 without adding runtime or development dependencies.

**Tech Stack:** Node.js 22, ESM, `node:test`, GitHub Actions, Bash.

**Spec:** `docs/superpowers/specs/2026-09-26-bridge-reliability-design.md`

## Global Constraints

- Preserve the Node.js 22 runtime requirement and JavaScript source format.
- Keep the empty allowlist backward compatible and emit a startup warning.
- Use exact `from_user_id` matches for sender filtering in direct and group chats.
- Commit a poll cursor only after all messages in that response batch settle successfully.
- Use at-least-once batch processing; duplicate replies are possible after a crash before cursor persistence.
- Set the Codex turn completion timeout to 180,000 milliseconds.
- Add no npm dependencies.

## Review Focus

- Empty, whitespace-only, and duplicate allowlist entries — prove empty configuration allows with a warning, and configured IDs match exactly.
- One failed task among concurrent update tasks — prove all tasks settle and the cursor remains unchanged.
- A turn that never emits `turn/completed` — prove its waiter is rejected and removed after the configured timeout.
- Simultaneous reconnect attempts after WebSocket close — prove one replacement connection is initialized and loaded thread state is cleared.
- CI on the declared minimum Node major — run on Node.js 22 and parse the Bash watcher.

---

### Task 1: Sender allowlist

**Files:**
- Create: `src/access-control.mjs`
- Create: `test/access-control.test.mjs`
- Modify: `src/start.mjs`
- Modify: `README.md`
- Modify: `docs/plan-and-progress.md`

**Interfaces:**
- Produces `parseAllowedUsers(value)` returning a `Set` of trimmed, non-empty comma-separated IDs.
- Produces `isSenderAllowed(senderId, allowedUsers)` returning `true` when the set is empty or contains the exact sender ID.
- `runStart` reads `CODEX_WECHAT_ALLOWED_USERS`, warns once if the parsed set is empty, and passes it into message processing.

- [ ] Write tests for empty configuration, whitespace, duplicate IDs, exact matches, and rejected IDs.
- [ ] Run `node --test test/access-control.test.mjs`; confirm the missing helper causes the expected failure.
- [ ] Implement the small access-control module and wire sender filtering before context-token persistence or command processing.
- [ ] Run `node --test test/access-control.test.mjs`; expect all cases to pass.
- [ ] Update README and current-state docs with configuration and group sender behavior.
- [ ] Run `npm test`; expect the whole suite to pass.
- [ ] Commit as `feat: support optional WeChat sender allowlist`.

### Task 2: Batch completion and cursor checkpoint

**Files:**
- Create: `src/update-batch.mjs`
- Create: `test/update-batch.test.mjs`
- Modify: `src/start.mjs`

**Interfaces:**
- Produces `processUpdateBatch({ response, dispatch, saveCursor })`, which waits for every dispatched message task, throws if any task rejects, and only then saves a non-empty response cursor.
- `src/start.mjs` dispatches each message through the existing per-conversation queue and does not begin the next poll until the batch settles.

- [ ] Write tests that hold a task pending and assert the cursor is not saved until it resolves, and that a rejected task prevents cursor saving after all tasks settle.
- [ ] Run `node --test test/update-batch.test.mjs`; confirm the missing helper causes the expected failure.
- [ ] Implement `processUpdateBatch` with `Promise.allSettled` and an aggregate failure after all tasks finish.
- [ ] Integrate it into the polling loop, keeping the old cursor on failure and letting the existing retry/backoff path retry the batch.
- [ ] Run `node --test test/update-batch.test.mjs` and `npm test`; expect all tests to pass.
- [ ] Commit as `fix: checkpoint WeChat updates after processing`.

### Task 3: Turn timeout and app-server reconnection

**Files:**
- Modify: `src/codex-app-server.mjs`
- Modify: `src/start.mjs`
- Modify: `test/app-server.test.mjs`

**Interfaces:**
- `CodexAppServerClient` accepts optional `turnTimeoutMs`, defaulting to 180,000.
- `CodexAppServerClient.isConnected()` reports whether its WebSocket is open.
- Concurrent `connect()` calls share one pending connection attempt.
- Socket close clears `socket` and loaded thread IDs, and rejects pending RPC/turn waiters.
- `processMessage` reconnects before running a message if the app-server is disconnected.

- [ ] Add a test with a short `turnTimeoutMs` for a turn that never completes; assert rejection and waiter removal.
- [ ] Run the targeted test and confirm it fails because `sendTurn` currently has no completion timeout.
- [ ] Implement timeout cleanup, preserving already completed turn handling.
- [ ] Add fake-WebSocket tests for close invalidation and concurrent `connect()` calls.
- [ ] Run the targeted app-server tests; confirm the new cases pass.
- [ ] Add reconnect-before-message behavior and run `npm test`; expect the whole suite to pass.
- [ ] Commit as `fix: recover app-server connections and bound turn waits`.

### Task 4: Public CI and check coverage

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/plan-and-progress.md`

**Interfaces:**
- CI runs on pushes and pull requests targeting `main` with Node.js 22.
- CI runs `npm run check`, `npm test`, and `bash -n scripts/watch-codex-config.sh`.
- `npm run check` includes syntax checks for all runtime JavaScript modules; `npm test` loads and executes each test module.

- [ ] Extend `npm run check` to include the new runtime modules. Keep test modules out of this command because the npm package intentionally omits the `test/` directory; `npm test` loads and executes them in CI.
- [ ] Run `npm run check`; expect success.
- [ ] Add the GitHub Actions workflow and ensure it uses only standard setup/checkout actions.
- [ ] Run `npm test`, `npm run check`, `bash -n scripts/watch-codex-config.sh`, and `node --test --experimental-test-coverage test/*.test.mjs`; expect all tests and syntax checks to pass.
- [ ] Update contributor-facing documentation with CI checks and current coverage scope.
- [ ] Commit as `ci: test bridge on Node.js 22`.

## Completion

- [ ] Run the complete verification set from Task 4.
- [ ] Review the complete branch against the merge base and record any deferred minor findings.
- [ ] Push the task branch and create a PR to `main`.
