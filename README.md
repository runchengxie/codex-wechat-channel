# codex-wechat-channel

把微信 ClawBot 消息桥接进 Codex，会话底层走 `codex app-server`，而不是 Claude Code 的 development channels。

## 设计取舍

参考 `claude-code-wechat-channel` 的整体链路，但 Codex 当前公开可用的是 `app-server` / `mcp`，没有 Claude 那套 channel 扩展加载入口。因此这个项目采用的是：

```text
WeChat (ClawBot)
  -> ilink API
  -> codex-wechat-channel
  -> embedded Codex app-server
  -> per-chat Codex thread
  -> plain-text reply back to WeChat
```

这意味着：

- 它会自己拉起一个 `codex app-server`
- 每个私聊 / 群聊维护一个独立 Codex thread
- 回复默认走纯文本，适合 WeChat 聊天窗口
- 图片消息会尽量下载并作为 `localImage` 输入传给 Codex

## 前置要求

- Node.js `>= 22`
- 已安装 `codex` CLI，且已登录可用
- 微信 iOS ClawBot 可用

如果当前 shell 没有导出 `OPENAI_API_KEY`，桥接会优先复用 `codex login` 写入的 `~/.codex/auth.json`。两者都缺失时，启动会在连接 app-server 前直接报错。

## 快速开始

### 1. 微信扫码登录

```bash
node cli.mjs setup
```

凭据会保存在：

```text
~/.codex/channels/wechat/account.json
```

### 2. 启动桥接

```bash
node cli.mjs start
```

如果需要指定工作目录或模型：

```bash
node cli.mjs start --cwd D:\workspace\myrepo --model gpt-5.4
```

### 3. 探活 Codex app-server

```bash
node scripts/probe-app-server.mjs
```

预期输出：

```text
PONG
```

## 常用环境变量

```bash
CODEX_BIN=codex
CODEX_WECHAT_CWD=D:\workspace\repo
CODEX_WECHAT_MODEL=gpt-5.4
CODEX_WECHAT_SANDBOX=workspace-write
CODEX_WECHAT_APPROVAL_POLICY=never
CODEX_WECHAT_APP_SERVER_URL=ws://127.0.0.1:4501
CODEX_WECHAT_BASE_URL=https://ilinkai.weixin.qq.com
CODEX_WECHAT_DEVELOPER_INSTRUCTIONS=Always answer as a senior engineer.
OPENAI_API_KEY=sk-...
```

## 持久化状态

项目会在 `~/.codex/channels/wechat/` 下维护：

- `account.json`：微信 bot token
- `context_tokens.json`：WeChat reply context
- `threads.json`：conversation -> Codex thread 映射
- `sync_buf.txt`：微信 long polling 游标
- `media/`：下载下来的图片附件

## 注意事项

- 默认 `approvalPolicy=never`，因为这是一个无人值守桥。如果你改成需要审批，桥接会卡住。
- 默认 `sandbox=workspace-write`。若需要更强权限，用 `CODEX_WECHAT_SANDBOX=danger-full-access`。
- 若未显式设置 `OPENAI_API_KEY`，embedded app-server 会尝试读取 `~/.codex/auth.json` 中由 `codex login` 保存的 key。
- WeChat 端仍是纯文本最佳，尽量不要让 Codex 输出 Markdown 表格或长代码块。
