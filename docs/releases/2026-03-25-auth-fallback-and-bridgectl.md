# 2026-03-25 bin 包发布、鉴权回退与后台控制脚本

## 摘要

这次发布解决了三个实际可用性问题：

- 项目可作为 npm `bin` 包发布，并在安装态下直接运行
- embedded `Codex app-server` 在当前 shell 未导出 `OPENAI_API_KEY` 时无法跑通
- 手工测试时缺少稳定的后台 `start/stop` 控制入口

## 变更内容

### 1. npm bin 包发布

- `cli.mjs` 现在直接支持：
  - `codex-wechat-channel setup`
  - `codex-wechat-channel start`
  - `codex-wechat-channel probe`
  - `codex-wechat-channel bridge start|status|stop`
- `package.json` 补齐了 `files`、`publishConfig`、`repository`、`bugs`、`homepage`
- 安装方式支持：
  - `npx codex-wechat-channel help`
  - `npm install -g codex-wechat-channel`

### 2. 鉴权回退

- `src/codex-app-server.mjs` 现在会在启动 embedded `app-server` 前优先检查环境变量
- 若当前 shell 没有 `OPENAI_API_KEY`，会回退读取 `codex login` 保存的 `~/.codex/auth.json`
- 两者都缺失时，会在连接前直接报错，而不是拖到 `turn/start` 阶段才失败

### 3. 后台控制脚本

- 新增 `scripts/bridgectl.mjs`
- 提供 `start` / `status` / `stop` 三个控制动作
- 现在既可作为 npm scripts 使用，也可作为正式 CLI 子命令发布：
  - `codex-wechat-channel probe`
  - `codex-wechat-channel bridge start`
  - `codex-wechat-channel bridge status`
  - `codex-wechat-channel bridge stop`

### 4. 持久化文件

后台桥接控制新增以下文件：

- `~/.codex/channels/wechat/bridge.pid`
- `~/.codex/channels/wechat/bridge.stdout.log`
- `~/.codex/channels/wechat/bridge.stderr.log`

## 验证结果

本次发布后已实际验证：

- `npm run check`：通过
- `codex-wechat-channel probe`：输出 `PONG`
- 微信扫码登录：通过
- 微信消息桥接闭环：通过
- `npm pack`：通过
- `npx --yes --package .\\codex-wechat-channel-0.1.0.tgz codex-wechat-channel help`：通过
- 后台桥接控制：
  - `codex-wechat-channel bridge start`：可拉起后台桥接
  - `codex-wechat-channel bridge status`：可读取运行状态
  - `codex-wechat-channel bridge stop`：可回收后台桥接

## 使用方式

```bash
codex-wechat-channel setup
codex-wechat-channel start
codex-wechat-channel probe
codex-wechat-channel bridge start
codex-wechat-channel bridge status
codex-wechat-channel bridge stop
```

需要自定义 `cwd` 或模型时：

```bash
codex-wechat-channel bridge start --cwd D:\workspace\myrepo --model gpt-5.4
```

## 已知限制

- `bridge:start` 只负责后台拉起桥接，不会自动代替 `setup` 扫码登录
- 若微信凭据不存在，后台桥接仍会进入 `setup` 登录链路
- `bridge:probe` 验证的是 `Codex app-server` 链路，不验证微信侧登录态
