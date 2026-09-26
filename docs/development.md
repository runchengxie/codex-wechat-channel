# 开发与检查

本 fork 的运行时、CLI、Node 脚本和测试使用 TypeScript。`tsc` 将可运行的 ESM JavaScript 编译到 `dist/`。使用者运行编译后的文件，不需要单独安装 TypeScript。运行要求为 Node.js 22 或更新版本；开发与 CI 使用最新的 Node.js 22 或 24。

项目没有第三方 npm 运行时依赖。TypeScript、ESLint、SonarJS 和 c8 等开发工具由 `package-lock.json` 锁定。本 fork 的修改尚未发布为 npm 新版本，开发和安装都从源码开始。

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

公开仓库的 PR 和 `main` 推送会在 Node.js 22、24 上执行主要检查。测试通过本地替身验证微信请求、消息处理、连接恢复、登录保存和服务控制，不会访问真实微信或安装系统服务。`check:package` 会生成 npm 包，在临时目录离线安装，并运行实际安装后的 CLI。

`audit:code` 报告代码行数、函数复杂度、模块依赖和静态调用关系。指标定义、局限和数据流见[代码维护检查](maintenance-audit.md)。生成的 `dist/`、覆盖率结果和运行数据不提交到 Git。

模块职责和当前功能边界见[功能现状](plan-and-progress.md)。发布记录保存在 `releases/`，其中的部署结果仅对应当时版本。
