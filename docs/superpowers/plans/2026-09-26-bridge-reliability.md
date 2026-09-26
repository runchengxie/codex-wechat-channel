# 微信桥接可靠性实施计划

本文保存此前可靠性改动的原始实施范围。路径和命令以当时的 JavaScript 版本为准，当前方式见 `docs/plan-and-progress.md`。此处不追补历史执行勾选状态。

白名单功能后来曾实现，现已移除，因为当前微信 iOS ClawBot 接入方式只支持私聊。此计划只保留历史记录。

当时要求按 `superpowers:executing-plans` 逐项执行，设计依据为 `docs/superpowers/specs/2026-09-26-bridge-reliability-design.md`。

## 目标与约束

保持 Node.js 22、ESM 和当时的 JavaScript 源码格式，不增加 npm 运行或开发依赖。增加可选发送者白名单、批次完成后的游标保存、Codex 回合超时、断线恢复及公开 CI。

空白名单继续允许使用并输出配置提醒。私聊与群聊都按 `from_user_id` 精确匹配。同一批消息全部完成后才保存游标，处理失败时保留旧游标。进程在回复成功、保存游标之前退出可能导致重复回复。普通回合超时为 180000 毫秒。

## 任务 1：发送者白名单

新增 `src/access-control.mjs` 和对应测试，修改 `src/start.mjs`、README 和功能现状文档。

`parseAllowedUsers(value)` 返回去除空白和空项后的 ID 集合。`isSenderAllowed(senderId, allowedUsers)` 在集合为空或精确匹配时返回允许。`runStart` 读取 `CODEX_WECHAT_ALLOWED_USERS`，空配置时提醒，并在保存上下文或处理命令前检查发送者。

- [ ] 覆盖空配置、空白、重复 ID、精确匹配和拒绝情况。
- [ ] 先运行 `node --test test/access-control.test.mjs`，确认缺少实现时失败。
- [ ] 实现并接入判断，再运行相关测试与 `npm test`。
- [ ] 文档说明配置方式和群聊同样按发送者判断。
- [ ] 提交白名单功能。

## 任务 2：批次处理与游标

新增 `src/update-batch.mjs` 和对应测试，修改 `src/start.mjs`。

`processUpdateBatch({ response, dispatch, saveCursor })` 使用 `Promise.allSettled` 等待所有任务，汇总失败后报错，只有全部成功才保存非空游标。同一会话继续串行处理，当前批次结束前不开始下一次轮询，失败沿用重试等待逻辑。

- [ ] 测试未完成任务阻止保存游标，任一失败也阻止保存，但仍等待其他任务结束。
- [ ] 先确认 `node --test test/update-batch.test.mjs` 因缺少实现失败，再实现并验证。
- [ ] 接入轮询流程，运行相关测试和 `npm test`。
- [ ] 提交批次保存改动。

## 任务 3：回合超时与断线恢复

修改 `src/codex-app-server.mjs`、`src/start.mjs` 和 app-server 测试。

客户端接受 `turnTimeoutMs`，默认为 180000。`isConnected()` 反映连接与初始化状态，并发 `connect()` 共享一次连接尝试。关闭连接时清除套接字和已加载会话，拒绝未完成请求及回合等待。后续消息开始时按需重连。

- [ ] 用短超时测试没有结束通知的回合，先确认旧实现失败，再实现超时拒绝与等待记录清理。
- [ ] 保留先收到结束通知、后收到请求响应的处理方式，限制迟到通知缓存。
- [ ] 用 WebSocket 替身检查关闭后状态失效、并发连接只建立一次。
- [ ] 接入消息前重连，运行相关测试及 `npm test`。
- [ ] 提交超时与重连改动。

## 任务 4：公开 CI

新增 `.github/workflows/ci.yml`，更新 `package.json`、README 和功能现状文档。

当时的 CI 在目标为 `main` 的 PR 和推送中运行 Node.js 22。`npm run check` 检查所有运行时 JavaScript，测试由 `npm test` 加载，npm 发布包不包含测试目录。

- [ ] 将新增模块纳入语法检查，并确认 `npm run check` 通过。
- [ ] 添加 checkout 和 Node.js 配置步骤。
- [ ] 执行 `npm test`、`npm run check`、`bash -n scripts/watch-codex-config.sh` 和 `node --test --experimental-test-coverage test/*.test.mjs`。
- [ ] 文档说明当时覆盖率仅统计已加载模块。
- [ ] 提交 CI 配置。

## 当时的交付要求

- [ ] 完成任务 4 的全部验证。
- [ ] 审查整个分支，记录延期的小问题。
- [ ] 推送任务分支并创建目标为 `main` 的 PR。
