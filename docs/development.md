# Development and checks

[中文页面](development.zh-CN.md)

This fork uses TypeScript for its runtime, CLI, Node scripts, and tests. `tsc` compiles ESM JavaScript into `dist/`; users run the compiled files without installing TypeScript. Node.js 22 or newer is required. Development and CI use Node.js 22 or 24.

The project uses `pdfjs-dist` and `mammoth` to extract PDF and DOCX text. Development tools including TypeScript, ESLint, SonarJS, and c8 are locked by `package-lock.json`. This fork has not been released as a new npm version; build and install from source.

## Dependency security

The earlier audit reported three moderate nodes through `mammoth -> argparse -> sprintf-js` under [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). The project keeps Mammoth at the locked 1.12.3 release and overrides only its CLI parser to `argparse@2.0.1`, which does not depend on `sprintf-js`. This removes that chain rather than ignoring the advisory or downgrading Mammoth. `argparse` 3 rejects Mammoth's legacy API and is not used.

Compatibility tests exercise Mammoth's actual CLI help, paragraph/Unicode conversion, HTML/Markdown output, positional output paths, output directories, style maps and mutually exclusive arguments. Version 2 retains the old API with deprecation warnings; those warnings are not suppressed. Attachments still call `mammoth.extractRawText({ buffer })`, and their existing DOCX test retains the original text expectation and library-path dependency check.

The source installation is locked by `package-lock.json`. [npm overrides](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides) apply only at the installation root, so an override alone does not protect tarball consumers. The CLI package [bundles Mammoth and its dependencies](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#bundledependencies), including the validated parser and upstream licenses. `check:package` checks the parser version and absence of `sprintf-js` after installing the tarball, as well as the installed application CLI. Rebuild the bundle from a clean `npm ci` after dependency changes. Existing installations and earlier registry releases are unchanged until separately updated.

Packaging temporarily changes only Mammoth's bundled `argparse` dependency declaration to the actual validated version. The library code and licenses are unchanged. `postpack` restores the upstream declaration from the source lock, and `check:package` also restores it in its cleanup path. The installed dependency tree must pass `npm ls --all`; a clean audit cannot substitute for a valid dependency tree.

Rerun `npm audit` against both the source lock and a clean tarball installation after dependency changes. Passing `npm audit --audit-level=high` alone does not establish zero vulnerabilities. A clean advisory result also does not certify safety for every input file.

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
