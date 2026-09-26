# 维护改进与 TypeScript 迁移计划

白名单相关的历史验收项已随当前 ClawBot 仅支持私聊的结论废弃。现行行为见 `docs/plan-and-progress.md`。

按 `superpowers:executing-plans` 逐项执行。设计依据为 `docs/superpowers/specs/2026-09-26-maintainability-typescript-design.md`。

目标是将桥接程序迁移到编译后的 TypeScript，并建立可重复的类型、代码规范、测试、覆盖率、依赖和发布检查。

## 全局约束

- 保持 Node.js 22 及以上的运行要求，不新增运行时 npm 依赖。
- `tsc` 输出 ESM JavaScript 到 `dist/`，使用者无需安装 TypeScript。
- 保留 Bash 配置监视脚本，并执行 `bash -n`。
- 测试针对编译输出，使用本地替身，不访问真实微信、账号凭证或系统服务。
- 不提交 `dist/`、覆盖率输出或本地审计临时文件。

## 审查重点

- NodeNext 下的 `.js` 相对导入同时适用于源码编译和发布包。
- npm `bin` 指向 `dist/cli.js` 后仍可作为命令执行。
- tarball 包含所有运行时文件和预期的源映射，不包含测试或内部计划。
- 微信 JSON、WebSocket 消息、进程数据和本地文件经过字段校验后再使用。
- 覆盖率包含未加载的生产模块，统计范围或阈值不满足时检查必须失败。

## 任务 1：构建和发布目录

涉及 `tsconfig.json`、`package-lock.json`、`tools/clean-build.mjs`、`package.json`、`.gitignore`、CI 及包入口测试。

- [x] 添加编译后 CLI 的帮助命令测试，确认未构建时失败。
- [x] 安装 TypeScript 开发工具，以 `allowJs` 支持迁移过渡。
- [x] 添加 clean、build、check、test、prepack 命令，忽略生成目录。
- [x] 验证构建、类型检查和入口测试，确认重新构建会删除旧输出。
- [x] 检查 npm 文件列表，确认包含入口和运行时文件、排除测试。
- [x] 提交构建基础。过渡入口为 `dist/cli.mjs`，任务 2 完成后改为 `dist/cli.js`。

## 任务 2：运行时代码迁移

将 `cli.mjs`、`src/*.mjs` 和 `scripts/*.mjs` 改为 `.ts`。为微信消息、桥接配置、Codex 请求与通知、用户输入和持久化记录建立类型。

- [x] 先转换一个纯函数模块，验证类型检查和编译后测试。
- [x] 按职责转换剩余模块，启用 strict，在外部边界解析 `unknown`。
- [x] 相对导入使用 `.js`，更新 npm 入口和发布文件范围。
- [x] 运行相关测试和完整测试，检查命令参数及原有行为。
- [x] 确认 CLI、运行时模块和 Node 服务脚本已无 `.mjs` 源码。
- [x] 提交运行时 TypeScript 迁移。

## 任务 3：测试迁移与边界行为

将 `test/*.test.mjs` 改为 `.test.ts`，测试从 `dist/test/` 运行。网络和系统操作使用本地替身，保留生产接口。

- [x] 迁移原有测试，保留基线的 19 项行为检查。
- [x] 检查微信请求格式、消息提取、错误响应和字段校验。
- [x] 直接测试消息入口，证明未允许的发送者不会启动 Codex 或收到回复。
- [x] 证明失败提示发送成功后可以保存游标，发送失败时保持旧游标。
- [x] 检查服务文本生成，避免执行真实 `systemctl`、`apt-get`、`sudo` 或写入系统目录。
- [x] 运行相关测试和完整测试，提交边界测试。

## 任务 4：可复现的结构和依赖报告

新增 `tools/maintenance-report.ts`、`docs/maintenance-audit.md` 和 `npm run audit:code`。

报告使用 TypeScript Compiler API，输出物理行数、决策式圈复杂度、认知复杂度近似值、导入关系、循环、入度、出度和静态可解析调用。动态调用及数据流的限制必须说明，不能把近似关系当作运行时事实。

- [x] 使用小型源码样例验证行数、分支、导入、调用和循环。
- [x] 实现 AST 报告并生成基线，记录复杂函数和较大模块。
- [x] 人工说明消息、持久化文件和 npm 构建产物的流向。
- [x] 记录复现命令、环境、指标定义和局限。依赖版本以锁文件为准，漏洞用在线 `npm audit` 核对。
- [x] 提交报告与说明文档。

## 任务 5：lint 与代码异味处理

新增 `eslint.config.mjs`，扫描应用代码、测试和开发工具。禁止未使用代码、显式 `any` 和绕过类型检查的注释，限制复杂度与嵌套深度。

- [x] 配置 ESLint、TypeScript ESLint 和 SonarJS，记录首次违规类型。
- [x] 根据任务 4 的测量确定门槛，拆分高复杂度职责，保留回归测试。
- [x] 验证 lint 和完整测试，不添加整文件或规则豁免。
- [x] 提交质量门禁。圈复杂度和 SonarJS 认知复杂度上限为 20，嵌套深度上限为 4。

补测发现 `probe` 成功后仍保留超时计时器，现已增加失败回归测试并修复清理行为。

## 任务 6：CI、覆盖率与开发说明

更新 `.github/workflows/ci.yml`、README、功能现状和发布文件范围，新增仓库 `AGENTS.md`。

- [x] 加入全部生产文件的覆盖率统计，下限为行 70%、分支 60%、函数 60%。未加载模块计为零覆盖，空报告或漏文件也必须失败。
- [x] CI 配置 Node.js 22、24 矩阵，执行 `npm ci`、类型检查、lint、构建、测试覆盖率、代码报告、`npm audit --audit-level=high`、Bash 语法和 npm 包检查。
- [x] 验证实际 tarball 可离线安装并执行已安装的 CLI，确认文件范围和源映射。
- [x] 从干净安装执行所有本地 CI 命令。远端矩阵结果在最终交付时核对。
- [x] 更新并复核全部说明文档，说明 TypeScript 源码、构建目录、权限和开发流程。文档不得将本地替身测试描述成真实部署验收。
- [x] 提交 CI 和文档改进。

## 最终交付

- [x] 完成干净安装、类型检查、lint、构建、全部测试及覆盖率、代码报告、依赖审计、Bash 语法和发布包验证。
- [x] 对照 `fork/main` 审查整个分支，处理重要问题并确认工作树干净。
- [x] 推送到用户 fork，创建目标为 `main` 的 [PR #3](https://github.com/runchengxie/codex-wechat-channel/pull/3)。
- [x] 必需检查和审查通过后合并，合并提交为 `2afeef17fcdce511d7a1ec9af47ee65c4185d141`。
- [x] 确认没有唯一未保存内容，再删除本任务的分支和 worktree。共享主检出已 fast-forward 同步。

## 追加需求：按聊天切换沙盒权限

用户在维护过程中要求支持修改权限。`/permissions [mode]` 保存当前聊天的选择，以服务启动配置为上限。切换后恢复已有会话应用设置，保留上下文，服务降低权限后限制历史选择。补充模式组合、持久化校验和 Codex 请求参数测试。真实 Codex 与微信联调仍需部署后验证。
