# Maintenance and TypeScript Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the bridge to compiled TypeScript and add measured, repeatable quality checks without changing runtime behavior.

**Architecture:** TypeScript is the source of truth and `tsc` emits ESM JavaScript into `dist/`. Tests run against that build. ESLint, strict type checking, targeted local-boundary tests, coverage, audit output, and npm package inspection form the maintenance gates.

**Tech Stack:** Node.js 22+, TypeScript, ESLint with typescript-eslint, Node `node:test`, TypeScript Compiler API, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-26-maintainability-typescript-design.md`

## Global Constraints

- Keep `engines.node` at `>=22`.
- Publish ESM JavaScript in `dist/`; consumers do not need TypeScript.
- Add no runtime npm dependencies.
- Keep the Bash watcher as Bash and test it with `bash -n`.
- Run tests against compiled output and never use real WeChat credentials, network services, or systemd mutations in CI.
- Do not commit generated `dist/`, coverage output, or local audit scratch files.

## Review Focus

- Import path rewrites must resolve from source and compiled package on NodeNext.
- The global CLI executable must retain executable behavior after `bin` points into `dist/`.
- Production npm tarball must contain every runtime file but omit tests, source maps if not intended, and development-only internal notes.
- Type declarations must not trust WeChat JSON, WebSocket frames, child-process data, or file contents before validation.
- CI coverage and audit commands must fail for their intended thresholds without silently excluding untested production modules.

---

### Task 1: Reproducible TypeScript build and package layout

**Files:**
- Create: `tsconfig.json`
- Create: `package-lock.json`
- Create: `tools/clean-build.mjs`
- Modify: `package.json`, `.gitignore`, `.github/workflows/ci.yml`
- Test: add a package smoke test for the built CLI.

**Interfaces:**
- `npm run check` runs the TypeScript compiler in no-emit mode. Strict checking is enabled when Task 2 finishes the source migration.
- `npm run build` writes ESM output under `dist/`.
- `npm test` cleans, builds and runs tests from compiled output.
- The published binary is `dist/cli.mjs` during the JavaScript build step, then `dist/cli.js` after Task 2 migrates the CLI.

- [x] Add a smoke test that runs the package entry with `help` and checks expected output.
- [x] Run the test and confirm it fails because the compiled entry does not exist yet.
- [x] Add the TypeScript toolchain as development dependencies and create a NodeNext config with `allowJs` for the migration period.
- [x] Add clean, build, check, test, and prepack scripts. Ignore generated output.
- [x] Verify `npm run check`, `npm run build`, and the smoke test. Re-run build after deleting `dist/` and confirm stale files cannot survive.
- [x] Run `npm pack --dry-run --json`; assert the bin target and runtime files are present and tests are absent.
- [x] Commit as `build: add compiled TypeScript package pipeline`.

### Task 2: Migrate CLI and runtime modules

**Files:**
- Rename: `cli.mjs`, `src/*.mjs`, `scripts/*.mjs` to `.ts`.
- Modify: imports in all runtime modules.
- Add types: WeChat payloads, bridge options, message inputs, stored records, Codex app-server requests and notifications.

**Interfaces:**
- Keep exported behavior and command arguments unchanged.
- Import local modules with `.js` suffixes under NodeNext.
- Parse untrusted boundary values from `unknown` before using them.

- [x] Convert one pure module and update its test to import the built `.js` module.
- [x] Run type checking and its targeted test to verify the converted module compiles and behaves the same.
- [x] Convert remaining runtime modules in groups by responsibility, enable strict checking, and resolve types at API and process boundaries.
- [x] Update the npm binary and package allowlist to the `.js` CLI and selected `dist/` runtime directories.
- [x] Run targeted tests after each group and the complete test suite after the conversion.
- [x] Verify all app files in `cli.ts`, `src/`, and Node scripts have no `.mjs` source remaining.
- [x] Commit as `refactor: migrate bridge runtime to TypeScript`.

### Task 3: Migrate tests and cover critical external boundaries

**Files:**
- Rename: `test/*.test.mjs` to `.test.ts`.
- Create: focused tests for WeChat API request/payload handling, startup sender filtering and failure behavior, service unit rendering, and CLI/package execution.
- Modify: test scripts and injectable boundaries where needed.

**Interfaces:**
- Tests execute compiled modules from `dist/`.
- Network and system operations use injected local fakes; production APIs remain unchanged.

- [x] Move existing tests to TypeScript and verify the baseline 19 behaviors remain covered.
- [x] Add failing tests for WeChat message normalization and API error responses using a local fetch fake.
- [x] Add startup-level tests proving an unlisted sender does not start Codex or send a reply, and failures only advance the cursor after a delivered failure notice.
- [x] Add service rendering tests without invoking `systemctl`, `apt-get`, `sudo`, or file writes outside the test temp directory.
- [x] Run targeted and full tests from `dist/test/`.
- [x] Commit as `test: cover bridge integration boundaries`.

### Task 4: Reproducible architecture and dependency audit

**Files:**
- Create: `tools/maintenance-report.ts` and `docs/maintenance-audit.md`.
- Modify: `package.json`.

**Interfaces:**
- `npm run audit:code` reports physical LOC, decision-based cyclomatic complexity, a documented cognitive-complexity approximation, import graph cycles/fan-in/fan-out, and direct statically resolvable call edges.
- `npm audit` checks the locked dependency tree.
- The report explicitly labels dynamic calls and data lineage that static syntax analysis cannot prove.

- [x] Test the report against small source fixtures with known LOC, decisions, imports, call edges, and cycles.
- [x] Implement the AST-based report using the TypeScript Compiler API.
- [x] Generate and review the current report. Keep data lineage and npm artifact lineage as documented flows, not guessed call-graph edges.
- [x] Record the exact commands, environment, metric definitions, and known limitations in `docs/maintenance-audit.md`.
- [x] Commit as `docs: add reproducible codebase audit`.

### Task 5: Lint rules and code-smell cleanup

**Files:**
- Create: `eslint.config.mjs`.
- Modify: TypeScript modules found to exceed measured complexity or responsibility limits.
- Modify: `package.json`.

**Interfaces:**
- `npm run lint` checks all application TypeScript and tests.
- Rules reject unused code, explicit `any`, unsafe suppressions, and complexity/depth beyond thresholds recorded by Task 4.

- [ ] Add lint configuration and verify the command parses all intended source and test files.
- [ ] Run lint and record existing violations by category against the Task 4 report.
- [ ] Add tests before each behavior-preserving extraction from a high-complexity hotspot.
- [ ] Refactor only findings that exceed recorded thresholds, with no broad formatting-only rewrite.
- [ ] Run lint and all tests; ensure no blanket file or rule disables were added.
- [ ] Commit as `chore: enforce TypeScript quality rules`.

### Task 6: CI, coverage, and contributor documentation

**Files:**
- Modify: `.github/workflows/ci.yml`, `README.md`, `docs/plan-and-progress.md`, `.npmignore` or package `files`.
- Create: repository `AGENTS.md`.

**Interfaces:**
- CI runs `npm ci`, type check, lint, build, tests with coverage, `npm audit --audit-level=high`, Bash syntax check, and npm package inspection on Node.js 22 and 24.
- Docs describe the source/build split, checks, coverage scope, architecture and development boundaries accurately.

- [ ] Add the CI matrix and coverage gate for all compiled production files, including untested files at zero: at least 70% lines, 60% branches, and 60% functions.
- [ ] Run all CI commands locally and inspect package contents.
- [ ] Update README, plan-and-progress and repository `AGENTS.md` in clear Chinese.
- [ ] Confirm the documentation does not describe untested deployment behavior as covered.
- [ ] Commit as `ci: enforce typed build and maintenance checks`.

## Completion

- [ ] Run clean install, type check, lint, build, tests with coverage, npm audit, Bash syntax check, and package inspection.
- [ ] Review the full branch against `fork/main`, resolve Important findings, and verify the task worktree is clean.
- [ ] Push the branch and create a PR targeting the user's fork `main`.
- [ ] Merge only after required checks pass, then remove this branch and worktree.
