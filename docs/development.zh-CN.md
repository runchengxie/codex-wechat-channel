# 开发与检查

[English page](development.md)

本 fork 的运行时、CLI、Node 脚本和测试使用 TypeScript。`tsc` 将可运行的 ESM JavaScript 编译到 `dist/`。使用者运行编译后的文件，不需要单独安装 TypeScript。运行要求为 Node.js 22 或更新版本；开发与 CI 使用最新的 Node.js 22 或 24。

项目使用 `pdfjs-dist` 和 `mammoth` 提取 PDF、DOCX 文本。TypeScript、ESLint、SonarJS 和 c8 等开发工具由 `package-lock.json` 锁定。本 fork 的修改尚未发布为 npm 新版本，开发和安装都从源码开始。

## 依赖安全

此前审计通过 `mammoth -> argparse -> sprintf-js` 报告了 [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) 对应的 3 个中危节点。项目保留锁定的 Mammoth 1.12.3，仅将它的 CLI parser 覆盖为不依赖 `sprintf-js` 的 `argparse@2.0.1`，移除这条依赖链，不忽略漏洞，也不降级 Mammoth。`argparse` 3 不接受 Mammoth 的旧 API，因此未采用。

兼容测试执行 Mammoth 的实际 CLI，检查帮助、段落与 Unicode、HTML/Markdown、位置输出路径、输出目录、样式映射和互斥参数。版本 2 保留旧 API，但会输出弃用警告，测试不隐藏这些警告。附件仍调用 `mammoth.extractRawText({ buffer })`，原有 DOCX 测试的文本预期和库路径依赖检查保持不变。

源码安装由 `package-lock.json` 锁定。[npm overrides](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides) 仅在安装根项目生效，单独覆盖依赖不能保护 tarball 消费者。因此该 CLI 包[随包携带 Mammoth 及其依赖](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#bundledependencies)，包括已验证 parser 和上游许可证。`check:package` 除检查安装后的应用 CLI，还确认实际 parser 版本及 `sprintf-js` 缺失。修改依赖后，须先干净执行 `npm ci`，再重新打包。已有安装和此前 registry 版本不会自动改变，需另行更新。

打包时仅将 Mammoth 的 `argparse` 依赖声明临时同步为实际已验证版本，库代码与许可证不变。`postpack` 根据源码锁文件恢复上游声明，`check:package` 也在清理阶段恢复。安装后的依赖树必须通过 `npm ls --all`，无告警审计不能代替依赖树有效性检查。

依赖修改后，应对源码锁文件和干净 tarball 安装分别执行 `npm audit`。仅通过 `npm audit --audit-level=high` 不表示零漏洞；审计无告警也不证明所有输入文件安全。

## 本地检查

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

`npm test` 先构建，再执行编译后的测试。`test:coverage` 统计 CLI、全部 `src/` 模块和 Node 服务脚本，包括没有被测试加载的生产文件。行、分支和函数覆盖率门槛分别为 70%、60% 和 60%；空报告或遗漏生产文件也会失败。

公开仓库的 PR 和 `main` 推送会在 Node.js 22、24 上执行主要检查。测试通过本地替身验证微信请求、消息处理、连接恢复、登录保存和服务控制，不会访问真实微信或安装系统服务。`check:package` 会生成 npm 包，在临时目录安装并运行实际安装后的 CLI。安装过程需要访问 npm registry。

`audit:code` 报告代码行数、函数复杂度、模块依赖和静态调用关系。指标定义、局限和数据流见[代码维护检查](maintenance-audit.md)。发布的源映射包含对应 TypeScript 源码，便于定位问题。生成的 `dist/`、覆盖率结果和运行数据不提交到 Git。

模块职责和当前功能边界见[功能现状](plan-and-progress.md)。发布记录保存在 `releases/`，其中的部署结果仅对应当时版本。
