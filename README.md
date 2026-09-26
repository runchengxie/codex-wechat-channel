# codex-wechat-channel

用微信 ClawBot 私聊给 Codex 发消息，再从微信收到回复。会话在重启后仍可继续使用。

目前支持文字、图片、微信已有的语音转写，以及 txt、md、csv、json 附件。视频会抽取最多 6 帧交给 Codex 分析。视频处理需要系统已安装 `ffmpeg` 和 `ffprobe`。语音没有转写时，Codex 只会收到一条语音消息提示。

## 快速开始

先准备 Node.js 22 或更新版本、已安装的 Codex CLI、可用的 `OPENAI_API_KEY`，以及可使用微信 iOS ClawBot 的账号。内置 app-server 也能从 `~/.codex/auth.json` 顶层的 `OPENAI_API_KEY` 字段读取密钥，详见[配置与权限](docs/configuration.md)。

启动前请留意：沙盒模式是 `danger-full-access`，审批策略是 `never`。请先按使用场景阅读[权限设置](docs/configuration.md)。

```bash
git clone https://github.com/runchengxie/codex-wechat-channel.git
cd codex-wechat-channel
npm ci
npm run build
node dist/cli.js setup
node dist/cli.js start
```

运行 `setup` 后，按终端显示的地址扫码登录。启动成功后，直接给 ClawBot 发消息即可。程序默认在启动命令所在目录处理代码任务，也可以用 `--cwd` 指定目录。停止前台程序可按 `Ctrl+C`。

本仓库是[原项目](https://github.com/renqingfei/codex-wechat-channel)的 fork，这些修改还没有发布为 npm 新版本。请使用上面的源码安装方式。

## 在微信里使用

- `/help`：查看全部聊天命令。
- `/new`：开始新会话。
- `/model`：查看或切换模型。
- `/permissions`：查看当前沙盒权限，带上模式名称可修改当前聊天的设置。
- `/status`：查看当前模型、工作目录和会话。

聊天权限不会超过桥接服务启动时设置的上限。完整命令说明见[使用指南](docs/usage.md)。

## 更多说明

- [使用指南](docs/usage.md)：聊天命令、后台运行和本地数据。
- [配置与权限](docs/configuration.md)：沙盒模式、模型和 app-server。
- [开发与检查](docs/development.md)：TypeScript 构建、测试、CI 和发布包。
- [功能现状](docs/plan-and-progress.md)：功能边界和模块职责。
- [代码维护检查](docs/maintenance-audit.md)：复杂度、依赖关系和指标定义。
