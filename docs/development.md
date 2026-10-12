# Development and checks

[中文页面](development.zh-CN.md)

This fork uses TypeScript for its runtime, CLI, Node scripts, and tests. `tsc` compiles ESM JavaScript into `dist/`; users run the compiled files without installing TypeScript. Node.js 22 or newer is required. Development and CI use Node.js 22 or 24.

The project uses `pdfjs-dist` and `mammoth` to extract PDF and DOCX text. Development tools including TypeScript, ESLint, SonarJS, and c8 are locked by `package-lock.json`. This fork has not been released as a new npm version; build and install from source.

## Dependency security

The 2026-10-12 registry audit reports the moderate [sprintf-js precision-specifier advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) through `mammoth -> argparse -> sprintf-js`. No patched `sprintf-js` release is published. The suggested `mammoth@0.3.29` downgrade is incompatible with the current dependency contract and is not a remediation used by this project.

DOCX extraction calls `mammoth.extractRawText({ buffer })` in `src/attachments.ts`. Mammoth imports `argparse` in its standalone CLI, which this application does not invoke. The advisory requires attacker-controlled format strings; no such path was identified in the current extraction flow. This assessment does not remove the installed vulnerable dependency or establish safety for other Mammoth entry points. Keep the finding visible, rerun the full audit, and review a compatible upstream fix when one is published. `npm audit --audit-level=high` passing still allows moderate findings.

## Local checks

```bash
npm ci
npm run check
npm run lint
npm run test:coverage
npm run audit:code
npm audit --audit-level=high
npm run check:package
bash -n scripts/watch-codex-config.sh
git diff --check
```

`npm test` builds the project and runs compiled tests. `test:coverage` measures the CLI, all `src/` modules, and Node service scripts, including production files that tests do not load. Line, branch, and function thresholds are 70%, 60%, and 60%; an empty report or omitted production file also fails.

Pull requests and pushes to `main` in the public repository run the main checks on Node.js 22 and 24. Tests use local substitutes for WeChat requests, message handling, connection recovery, account saving, and service control. They do not access a real WeChat account or install a system service. `check:package` creates an npm package in a temporary directory, installs it, and runs the installed CLI. Installation requires npm registry access.

`audit:code` reports lines of code, function complexity, module dependencies, and static call relationships. See [maintenance audit](maintenance-audit.md) for metric definitions, limits, and data flow. Published source maps include corresponding TypeScript source for debugging. Generated `dist/`, coverage output, and runtime data are not committed to Git.

See [feature status](plan-and-progress.md) for module responsibilities and current feature boundaries. Release records are in `releases/`; deployment results describe only the version recorded at the time.
