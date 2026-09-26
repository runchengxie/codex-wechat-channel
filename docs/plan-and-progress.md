# 方案与功能现状

## 项目目标

把微信 ClawBot 接入 Codex，让微信私聊和群聊都能使用独立的 Codex thread。

## 工作流程

```text
微信 ClawBot
  -> 微信 ilink API
  -> codex-wechat-channel
  -> Codex app-server
  -> 每个聊天对应的 Codex thread
  -> 微信文本回复
```

程序直接启动或连接 Codex app-server。微信消息不会经过 Codex CLI 的终端命令解析器，因此项目在桥接端实现了 `/model`、`/new`、`/review` 等聊天命令。

## 模块职责

- `src/wechat-api.mjs`：扫码登录、消息轮询、文本收发、图片下载与解密、消息内容提取。
- `src/codex-app-server.mjs`：启动或连接 app-server，管理 thread、turn 和模型请求。
- `src/start.mjs`：消息轮询、会话映射、同一聊天的消息排队和回复处理。
- `src/commands.mjs`：解析并执行微信聊天命令。
- `src/setup.mjs`：交互式扫码登录和凭据保存。
- `scripts/bridgectl.mjs`：后台进程启停与状态查看。
- `scripts/servicectl.mjs`、`scripts/watch-codex-config.sh`：Linux systemd 服务安装及配置监视。

## 当前功能

- 微信扫码登录，长轮询收取消息并发送文本回复。
- 将图片下载、解密后传给 Codex。
- 使用微信提供的语音转写文本。没有转写文本时不做语音识别。
- 文件和视频只提取消息中已有的名称或时长等信息，目前不下载附件。
- 按聊天保存 thread、模型、推理强度和工作目录，并保留最近使用的 thread。
- 后台运行、健康探测，以及 Linux systemd 安装和配置变化后的自动重启。

## 检查方式

```bash
npm run check
npm test
```

`npm test` 使用 Node.js 内置测试运行器。现有测试覆盖聊天命令和部分 app-server 通知处理。微信网络交互、完整启动关停流程、后台进程控制和 systemd 安装目前没有自动化集成测试。`docs/releases/` 中的验证记录是对应发布时的历史结果，不代表当前版本已重新执行过这些部署步骤。

## 目前没有的功能

- 微信用户白名单或按用户、群聊限制访问。
- 文件和视频附件下载、解析与输入。
- 微信语音识别。仅使用微信消息中已有的转写结果。
- 代码库中没有 Git submodule。
