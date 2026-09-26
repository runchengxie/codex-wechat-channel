# 维护性改进与 TypeScript 迁移设计

## 目标

把仓库从仅有语法检查和少量单元测试的状态，推进到有严格类型检查、lint、可复现的静态审计结果和关键边界测试的维护状态。应用代码迁移到 TypeScript，同时保持 ESM、Node.js 22 最低版本和无运行时 npm 依赖。

## 当前基线

- 运行时代码、命令行和 Node 脚本约 2,600 行，测试 19 项。
- `codex-app-server.mjs`、`start.mjs`、`servicectl.mjs` 分别约 615、426、427 行。
- 基线测试 19/19 通过。Node 内置覆盖率为行 67.63%、分支 64.06%、函数 60.00%，该结果只统计测试实际加载的模块。
- `npm run check` 只做语法检查。项目没有 lint、类型检查、锁文件或自动依赖审计，也没有微信 API、启动流程和 systemd 管理的集成测试。
- 导入结构以 `cli` 为入口，`start` 组合微信 API、命令、Codex app-server 与状态持久化。没有 Git submodule，也没有看到需要运行时第三方 npm 包的功能。

## 方案

### 源码与发布

- 把 Node.js 应用代码、CLI、Node 服务脚本和测试迁移为 TypeScript。构建清理器和 ESLint 配置保留为少量 JavaScript 工具文件，Bash watcher 保留为 Bash。
- 使用 TypeScript 编译器输出 ESM JavaScript 到 `dist/`。包的命令入口指向 `dist/cli.js`，npm 发布内容包含编译输出、README、公开文档和 Bash watcher，不要求用户安装 TypeScript。编译目录只发布运行时子目录，不发布测试和审计工具。
- 保持 `engines.node` 为 `>=22`。不依赖 Node.js 的原生 TypeScript 类型剥离，避免把最低版本提高到 22.18，也不把未经类型检查的 TypeScript 直接作为发布运行时代码。
- TypeScript 与类型定义只作为开发依赖，继续保持零运行时依赖。
- 使用 `NodeNext`、严格类型检查和显式 `.js` 相对导入。外部 JSON 与进程数据从 `unknown` 开始，在边界校验后进入应用类型。避免 `any` 和无说明的类型忽略。

### 静态检查与结构审计

- `npm run check` 运行严格 `tsc --noEmit`。
- ESLint 使用 TypeScript ESLint 配置和规则，并用 SonarJS 检查认知复杂度。先生成复杂度基线，再定阈值，避免配置大量忽略项来掩盖现状。
- 新增一个由 TypeScript Compiler API 驱动的维护审计命令，输出文件与总 LOC、函数圈复杂度和认知复杂度近似值、模块导入图及循环、模块入度/出度和可解析的直接调用关系。近似指标需在报告中标明算法边界，不作为真实运行时调用图。
- 数据流与制品流以架构文档说明：微信消息进入过滤和排队，经 Codex thread 后形成回复；账号、上下文 token、thread、轮询游标和媒体文件分别落在哪里。npm 依赖与发布内容由 lockfile、`npm audit` 和 `npm pack --dry-run` 检查。
- 只拆分审计中确认职责混杂或复杂度超过门槛的部分。首要候选为 app-server 连接生命周期与 turn 通知处理，先以现有测试和新增回归测试保护接口。

### 测试与 CI

- 保留 Node 内置测试运行器，在迁移后从 `dist/test/` 执行，以验证发布构建。
- 为微信 API 请求构造、消息提取、启动入口和后台服务配置生成补单元或本地模拟集成测试，不访问真实微信服务、不安装系统服务。
- 输出完整覆盖率并为已纳入自动测试的核心模块设置门槛。不能用只统计已加载模块的覆盖率冒充全仓覆盖率。
- CI 在 Node.js 22 和 24 上运行干净安装、类型检查、lint、构建、测试、覆盖率、`npm audit`、Bash 语法检查和包内容检查。

### 文档

- 更新 README 与 `docs/plan-and-progress.md`，准确说明开发依赖、构建产物、最低运行版本、检查命令、覆盖率范围、架构边界和暂未覆盖的部署行为。
- 项目仓库新增 `AGENTS.md`，说明目录职责、开发命令、测试约定、权限边界和禁止提交 `dist/` 等生成物。
- `docs/maintenance-audit.md` 记录本次度量结果、使用的命令和图的局限，便于以后复跑比较。

## 验收条件

1. 应用源代码和 Node 测试使用 TypeScript，生产包仅需 Node.js 22+，入口运行的是已编译 JavaScript。
2. 干净 `npm ci` 后，严格类型检查、lint、build 和测试通过，且没有新增运行时依赖。
3. CI 在 Node.js 22 与 24 上运行上述质量门禁、覆盖率、依赖审计、Bash 检查和 npm 包内容验证。
4. 自动审计报告可从命令重现，标出高复杂度和较大模块、导入关系与循环，并明确静态调用图的局限。
5. 白名单、消息游标、app-server 连接与 turn 生命周期的现有行为保持不变。微信 API 和 systemd 测试使用本地替身，不触碰真实凭据或系统状态。
6. 文档不宣称未验证的部署功能已经集成测试。

## 不在本次范围

- 不新增 Python、Java 或 Rust 实现。
- 不增加运行时依赖，不引入运行时转译器或要求用户全局安装 TypeScript。
- 不为达到指标机械拆分文件，也不设置无法解释的大量 ESLint 忽略项。
- 不新增真实微信账号、真实系统服务或网络部署测试。
