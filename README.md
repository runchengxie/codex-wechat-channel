# codex-wechat-channel

`codex-wechat-channel` 将微信 ClawBot 收到的消息转给 Codex，并把回复发回微信。每个私聊或群聊对应一个 Codex thread。程序通过微信 ilink API 收发消息，并通过 Codex app-server 管理会话。

## 功能

- 支持微信扫码登录、长轮询收消息和发送文本回复。
- 图片会下载并作为图片输入交给 Codex。
- 语音消息使用微信提供的转写文本。没有转写文本时只会提示收到语音。
- 文件和视频消息目前只把文件名或时长等信息交给 Codex，不会下载附件。
- 按聊天保存 Codex thread、模型、推理强度和工作目录，重启后继续使用。
- 支持在聊天中切换模型、管理 thread、查看 Git 工作区状态和发起代码审查。
- 支持后台运行。Linux 上还可安装 systemd 服务，并监视 Codex 配置变化。

## 运行要求

- Node.js 22 或更新版本
- 已安装并登录 Codex CLI
- 可使用微信 iOS ClawBot

如果没有设置 `OPENAI_API_KEY`，内置 app-server 会尝试从 `~/.codex/auth.json` 读取密钥。使用已有 app-server 时由该服务负责鉴权。

## 安装与启动

临时使用：

```bash
npx codex-wechat-channel help
```

长期使用：

```bash
npm install -g codex-wechat-channel
codex-wechat-channel setup
codex-wechat-channel start
```

`setup` 会显示微信扫码登录所需的二维码地址，登录信息保存在 `~/.codex/channels/wechat/account.json`。启动后默认在当前目录处理 Codex 请求。可指定工作目录和模型：

```bash
codex-wechat-channel start --cwd /path/to/repository --model MODEL
```

本地开发时可在仓库目录运行 `node cli.mjs <command>` 或对应的 `npm run` 命令。

## 微信命令

| 命令 | 功能 |
| --- | --- |
| `/help` | 查看可用命令 |
| `/model [名称]`、`/models` | 查看或切换当前聊天使用的模型。`luna`、`sol`、`terra`、`astra` 是快捷名称 |
| `/effort [级别]` | 设置当前聊天的推理强度 |
| `/status`、`/config` | 查看模型、推理强度、沙盒权限、工作目录和 thread |
| `/cwd [路径]` | 在启动时指定的目录内切换 Git 工作树 |
| `/new` | 为当前聊天新建 thread，并保留聊天设置 |
| `/threads`、`/resume <id>` | 查看或切换当前聊天保存的 thread |
| `/compact` | 压缩当前 thread 的上下文 |
| `/fork` | 复制当前 thread，并切换到副本 |
| `/rename <名称>` | 重命名当前 thread |
| `/review` | 审查当前工作目录中的未提交变更 |
| `/diff` | 查看当前工作目录的 Git 状态和差异统计 |
| `/permissions` | 查看桥接进程的沙盒权限 |

`/cwd` 只能选择桥接启动目录下的 Git 工作树。`/review` 和 `/diff` 需要当前目录是 Git 工作树。聊天命令不能提高服务启动时设置的沙盒权限。其他以 `/` 开头的输入会被视为不支持的命令。若要发送普通的斜杠开头文本，在开头再加一个 `/`，例如 `//plan`。

## 后台运行

```bash
codex-wechat-channel bridge start
codex-wechat-channel bridge status
codex-wechat-channel bridge stop
codex-wechat-channel probe
```

Linux 且使用 systemd 的机器可安装开机启动服务：

```bash
sudo codex-wechat-channel service install --cwd /path/to/repository
codex-wechat-channel service status
sudo codex-wechat-channel service uninstall
```

安装命令会创建 bridge 和配置监视服务。配置监视依赖 `inotify-tools`，安装器会在 Debian 或 Ubuntu 上尝试通过 `apt-get` 安装。监视器会在 `~/.codex/config.toml`、`AGENTS.md`、`skills/` 或 `prompts/` 内容变化后重启 bridge。需要自定义用户或 home 目录时，可传入 `--user` 和 `--home`。

后台命令支持透传启动参数：

```bash
codex-wechat-channel bridge start --cwd /path/to/repository --model MODEL
```

## 配置

| 环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `CODEX_BIN` | Codex CLI 可执行文件 | `codex` |
| `CODEX_WECHAT_CWD` | Codex 工作目录 | 当前目录 |
| `CODEX_WECHAT_MODEL` | 默认模型 | Codex 默认值 |
| `CODEX_WECHAT_SANDBOX` | 沙盒权限：`read-only`、`workspace-write` 或 `danger-full-access` | `danger-full-access` |
| `CODEX_WECHAT_APPROVAL_POLICY` | 审批策略 | `never` |
| `CODEX_WECHAT_APP_SERVER_URL` | 连接已有 app-server 的 WebSocket 地址 | 自动启动内置 app-server |
| `CODEX_WECHAT_BASE_URL` | 微信 ilink API 地址 | `https://ilinkai.weixin.qq.com` |
| `CODEX_WECHAT_DEVELOPER_INSTRUCTIONS` | 追加到 thread 的指令 | 无 |
| `OPENAI_API_KEY` | app-server 使用的 API 密钥 | 尝试读取 Codex 登录文件 |

默认权限允许 Codex 在沙盒策略范围内执行操作。若需限制访问，可设置 `CODEX_WECHAT_SANDBOX=workspace-write` 或 `read-only`。`approvalPolicy=never` 不会等待人工审批，部署前应按自己的使用场景选择权限。

桥接程序目前没有微信用户白名单，只检查收到的消息是否来自用户。请只在微信侧能限制为可信用户和会话的环境中运行。否则，收到的消息可能触发具有上述沙盒权限的 Codex 操作。

## 本地开发与检查

项目使用 Node.js 内置测试运行器，目前不依赖第三方 npm 包。

```bash
npm run check
npm test
```

## 本地数据

运行数据保存在 `~/.codex/channels/wechat/`：

- `account.json`：微信登录信息
- `bridge.pid`、`bridge.stdout.log`、`bridge.stderr.log`：后台进程状态和日志
- `context_tokens.json`：微信回复上下文
- `threads.json`：聊天与 Codex thread 的对应关系
- `sync_buf.txt`：微信长轮询游标
- `media/`：下载的图片

## 文档

- [方案与功能现状](docs/plan-and-progress.md)
- [默认权限与远端部署](docs/releases/2026-03-25-default-danger-full-access.md)
- [systemd 服务与配置监视](docs/releases/2026-03-25-systemd-service-and-autoreload.md)
- [npm 包、鉴权回退与后台控制](docs/releases/2026-03-25-auth-fallback-and-bridgectl.md)
