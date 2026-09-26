# 方案与功能现状

## 项目目标

把微信 ClawBot 接入 Codex，让微信私聊和群聊都能使用独立的 Codex 会话。

## 工作流程

```text
微信 ClawBot
  -> 微信 ilink API
  -> codex-wechat-channel
  -> Codex app-server
  -> 每个聊天对应的 Codex 会话
  -> 微信文本回复
```

程序直接启动或连接 Codex app-server。微信消息不会经过 Codex CLI 的终端命令解析器，因此项目在桥接端实现了 `/model`、`/new`、`/review` 等聊天命令。

## 模块职责

- `src/wechat-api.ts`：扫码登录、消息轮询、文本收发、图片下载与解密、消息内容提取。
- `src/codex-app-server.ts`：启动或连接 app-server，管理 会话、回合 和模型请求。
- `src/start.ts`：消息轮询、会话映射、同一聊天的消息排队和回复处理。
- `src/commands.ts`：解析并执行微信聊天命令。
- `src/protocol.ts`、`src/wechat-types.ts`、`src/thread-store.ts`：边界数据校验和会话状态类型。
- `src/access-control.ts`、`src/update-batch.ts`：白名单判断及批次完成后的游标保存。
- `src/setup.ts`：交互式扫码登录和凭据保存。
- `scripts/bridgectl.ts`：后台进程启停与状态查看。
- `scripts/servicectl.ts`、`scripts/watch-codex-config.sh`：Linux systemd 服务安装及配置监视。

## 当前功能

- 微信扫码登录，长轮询收取消息并发送文本回复。
- 将图片下载、解密后传给 Codex。
- 使用微信提供的语音转写文本。没有转写文本时不做语音识别。
- 文件和视频只提取消息中已有的名称或时长等信息，目前不下载附件。
- 按聊天保存 会话、模型、推理强度和工作目录，并保留最近使用的 会话。
- 可用 `CODEX_WECHAT_ALLOWED_USERS` 限制桥接的微信发送者。未配置时兼容放行所有用户，并在启动日志中警告。
- 后台运行、健康探测，以及 Linux systemd 安装和配置变化后的自动重启。

## 构建与检查

源码和测试使用 TypeScript，`tsc` 生成 `dist/` 内的 ESM JavaScript。微信消息、Codex 响应和本地 JSON 文件经过字段校验后进入程序。运行时不增加 npm 第三方依赖。

```bash
npm ci
npm run check
npm run lint
npm run test:coverage
npm run audit:code
npm audit --audit-level=high
npm run check:package
bash -n scripts/watch-codex-config.sh
```

测试从 `dist/test/` 执行，覆盖聊天命令、白名单、批次游标、app-server 通知与重连、微信请求、图片解密、登录凭证保存、启动关停及后台服务控制。涉及网络和系统进程时使用替身，systemd 安装只检查生成文本和命令参数，没有在测试中安装服务。

覆盖率包含 CLI、全部 `src/` 和 Node 服务脚本。行、分支、函数下限分别为 70%、60%、60%，报告还必须包含全部生产文件。GitHub Actions 在 Node.js 22、24 上执行同样的检查。包检查会离线安装实际 tarball 并运行 CLI。

复杂度报告区分静态可解析关系和未解析调用，不能单凭它删除代码。详细定义与复现方法见[代码维护检查](maintenance-audit.md)。`docs/releases/` 保存历史发布记录，其真实部署结果不代表当前代码已重新完成微信或 systemd 验收。

## 目前没有的功能

- 按群聊分别设置发送者白名单。现有白名单按发送者 ID 生效。
- 文件和视频附件下载、解析与输入。
- 微信语音识别。仅使用微信消息中已有的转写结果。

## 聊天权限设置

`/permissions` 查看当前聊天的沙盒模式和服务权限上限。带上 `read-only`、`workspace-write` 或 `danger-full-access` 可保存新模式，下一次使用会话时应用。设置按聊天隔离，保留已有上下文，`/new` 沿用该设置。服务以更低权限重启后，实际权限受新的上限限制。
