# 方案与进度

## 目标

参考 `claude-code-wechat-channel`，做一个可运行的 `codex-wechat-channel`，把微信 ClawBot 消息桥接到 Codex。

## 约束判断

- Codex 当前公开能力是 `app-server` / `mcp`
- 没有 Claude Code 那种 development channel 加载接口
- 所以不能机械照搬 `.mcp.json + channel plugin` 模式

## 最终方案

采用独立 bridge 架构：

```text
WeChat ilink API
  -> codex-wechat-channel
  -> embedded Codex app-server
  -> per-conversation Codex thread
  -> WeChat plain-text reply
```

### 核心模块

1. `src/wechat-api.mjs`
   负责 QR 登录、long polling、reply、typing indicator、图片下载解密。
2. `src/codex-app-server.mjs`
   负责拉起 / 连接 Codex app-server，创建 thread、恢复 thread、发送 turn。
3. `src/start.mjs`
   负责会话映射、上下文缓存、消息串行化和主循环。
4. `src/setup.mjs`
   负责扫码登录和凭据持久化。

## 当前进度

### 已完成

- [x] 验证 Codex app-server websocket 协议可用
- [x] 验证 `thread/start -> turn/start -> final_answer` 闭环
- [x] 实现微信 QR 登录
- [x] 实现微信消息 long polling
- [x] 实现 conversation -> Codex thread 持久化
- [x] 实现文本回复回写微信
- [x] 实现图片消息下载并转为 `localImage` 输入
- [x] 加入 `scripts/probe-app-server.mjs` 自检脚本
- [x] 修复 Windows 下 embedded app-server 子进程回收问题
- [x] 缺失 `OPENAI_API_KEY` 时回退读取 `~/.codex/auth.json`
- [x] 实现后台桥接控制：`bridge start/status/stop`
- [x] 把 `probe` 与 `bridge` 收敛为正式 CLI 子命令
- [x] 补齐 npm 包发布元数据，可作为 `bin` 包发布
- [x] 默认 `sandbox` 调整为 `danger-full-access`，便于远端无人值守部署
- [x] 集成 Linux `systemd` 安装命令，支持 bridge 开机自启与递归配置自动重载

### 当前验证结果

- `npm run check`：通过
- `codex-wechat-channel probe`：输出 `PONG`
- 微信扫码登录：通过
- 微信消息桥接闭环：通过
- `npm pack`：通过
- `npx --yes --package .\\codex-wechat-channel-0.1.2.tgz codex-wechat-channel help`：通过
- 远端 Ubuntu 部署：已完成 Node 22、Codex CLI、`codex-wechat-channel` 安装与后台 bridge 启动
- 远端 Ubuntu `service install`：可安装 `systemd` 服务与 watcher，并在 `config.toml` 与深层 skill 变更后自动重启；重复安装也会强制重载现有 unit

## 后续可扩展项

- 文件 / 视频消息下载后转结构化输入
- 群聊角色识别增强
- 更细粒度的 thread metadata
- 可配置的回复模板、system prompt、模型路由
