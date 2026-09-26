# 开发约定

## 分支与交付

- 默认向用户维护的 `runchengxie/codex-wechat-channel` 提交 PR，目标为 `main`。本地对应远端名为 `fork`，操作前先核对实际远端。只有用户明确要求时，才向原作者仓库提交 PR。
- 每个开发任务使用独立分支和 worktree，不直接修改共享 `main`。保留其他任务的未提交内容。
- 合并前完成代码审查和必需检查。合并后只清理本任务的远端分支、本地分支和 worktree。主检出干净时再以 fast-forward 同步。
- 不把临时 worktree 用作常驻服务目录。没有用户授权，不发布 npm 包或更改机器上的运行服务。

## 代码与检查

- 运行时代码和测试使用 TypeScript，采用 NodeNext 模块解析。相对导入写 `.js` 后缀，构建结果放在 `dist/`。
- 保持 Node.js 22 及以上的运行兼容性。开发检查使用最新的 Node.js 22 或 24，开发依赖的最低版本要求以安装提示为准。
- 第三方输入先按 `unknown` 接收，再校验字段。不要用 `any`、类型断言或关闭 strict 绕过检查。
- 不添加整文件 lint 豁免。当前门禁包括未使用变量、显式 `any`、被忽略的 Promise、复杂度和嵌套深度。需要调整阈值时说明依据。
- 新增运行时依赖前说明用途和替代方案。锁文件随依赖修改一起提交。
- 修改代码后按影响范围运行测试。交付前执行以下检查：

```sh
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

覆盖率必须包含全部生产文件，行、分支、函数下限分别为 70%、60%、60%。空报告或漏掉生产文件也必须失败，不得缩小统计范围来提高比例。复杂度报告的定义和局限见 `docs/maintenance-audit.md`。

## 数据与测试边界

- 聊天可通过 `/permissions` 保存沙盒模式，实际权限不得超过服务启动配置。新建、恢复、复制会话都必须应用该限制。

- 测试使用临时目录和本地替身，不读取真实账号凭证、不发送微信、不启动真实 Codex、不安装或修改 systemd 服务。
- 原始数据、登录信息、日志和测试输出保存在仓库外。不要提交 `dist/`、覆盖率产物或任何 token。
- 当前微信 iOS ClawBot 接入方式只支持私聊，不维护发送者白名单配置。
- 文档以中文为主，保留必要的命令和代码引用，说明已验证的行为和仍需真实环境验证的内容。历史发布记录不能充当当前版本的验收结果。
