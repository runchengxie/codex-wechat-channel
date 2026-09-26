# codex-wechat-channel

用微信 ClawBot 给 Codex 发消息，再从微信收到回复。私聊和群聊各自保留会话，重启后可以继续使用。

目前支持文字、图片和微信已有的语音转写。文件和视频只会把文件名、时长等消息信息交给 Codex，暂不下载附件。

## 快速开始

先准备 Node.js 22 或更新版本、已安装并登录的 Codex CLI，以及可使用微信 iOS ClawBot 的账号。

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

## 开始使用前的配置

未设置微信发送者白名单时，能联系这个 ClawBot 的用户都可以触发 Codex，程序会在启动时提醒。默认沙盒模式为 `danger-full-access`。准备在群聊中使用，或希望限制代码访问范围时，请先阅读[配置与权限](docs/configuration.md)。

## 更多说明

- [使用指南](docs/usage.md)：聊天命令、后台运行和本地数据。
- [配置与权限](docs/configuration.md)：白名单、沙盒模式、模型和 app-server。
- [开发与检查](docs/development.md)：TypeScript 构建、测试、CI 和发布包。
- [功能现状](docs/plan-and-progress.md)：功能边界和模块职责。
- [代码维护检查](docs/maintenance-audit.md)：复杂度、依赖关系和指标定义。
