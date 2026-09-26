# codex-wechat-channel

`codex-wechat-channel` 将微信 ClawBot 收到的消息转给 Codex，并把回复发回微信。每个私聊或群聊对应一个 Codex 会话。程序通过微信 ilink API 收发消息，并通过 Codex app-server 管理会话。

## 功能

- 支持微信扫码登录、长轮询收消息和发送文本回复。
- 图片会下载并作为图片输入交给 Codex。
- 语音消息使用微信提供的转写文本。没有转写文本时只会提示收到语音。
- 文件和视频消息目前只把文件名或时长等信息交给 Codex，不会下载附件。
- 按聊天保存 Codex 会话、模型、推理强度和工作目录，重启后继续使用。
- 支持在聊天中切换模型、管理会话、查看 Git 工作区状态和发起代码审查。
- 支持后台运行。Linux 上还可安装 systemd 服务，并监视 Codex 配置变化。

## 运行要求

- Node.js 22 或更新版本
- 已安装并登录 Codex CLI
- 可使用微信 iOS ClawBot

如果没有设置 `OPENAI_API_KEY`，内置 app-server 会尝试从 `~/.codex/auth.json` 读取密钥。使用已有 app-server 时由该服务负责鉴权。

## 安装与启动

使用本 fork 的代码：

```bash
git clone https://github.com/runchengxie/codex-wechat-channel.git
cd codex-wechat-channel
npm ci
npm run build
node dist/cli.js setup
node dist/cli.js start
```

需要全局命令时，可在稳定的源码目录运行 `npm link`，之后使用下文的 `codex-wechat-channel` 命令。源码更新后重新构建。常驻服务应指向稳定的安装目录，不要使用开发任务的临时 worktree。

本仓库是 [原项目](https://github.com/renqingfei/codex-wechat-channel) 的 fork。上述修改通过本 fork 分发，尚未发布为 npm 新版本。

`setup` 会显示微信扫码登录所需的二维码地址，登录信息保存在 `~/.codex/channels/wechat/account.json`。启动后默认在当前目录处理 Codex 请求。可指定工作目录和模型：

```bash
codex-wechat-channel start --cwd /path/to/repository --model MODEL
```

源码使用 TypeScript，先执行 `npm run build`，再运行 `node dist/cli.js <command>`。`npm run start` 和 `npm run setup` 会先构建再启动。

## 微信命令

| 命令 | 功能 |
| --- | --- |
| `/help` | 查看可用命令 |
| `/model [名称]`、`/models` | 查看或切换当前聊天使用的模型。`luna`、`sol`、`terra`、`astra` 是快捷名称 |
| `/effort [级别]` | 设置当前聊天的推理强度 |
| `/status`、`/config` | 查看模型、推理强度、沙盒权限、工作目录和会话 |
| `/cwd [路径]` | 在启动时指定的目录内切换 Git 工作树 |
| `/new` | 为当前聊天新建会话，并保留聊天设置 |
| `/threads`、`/resume <id>` | 查看或切换当前聊天保存的会话 |
| `/compact` | 压缩当前会话 的上下文 |
| `/fork` | 复制当前会话，并切换到副本 |
| `/rename <名称>` | 重命名当前会话 |
| `/review` | 审查当前工作目录中的未提交变更 |
| `/diff` | 查看当前工作目录的 Git 状态和差异统计 |
| `/permissions [mode]` | 查看或修改当前聊天的沙盒权限 |

`/cwd` 只能选择桥接启动目录下的 Git 工作树。`/review` 和 `/diff` 需要当前目录是 Git 工作树。`/permissions read-only`、`/permissions workspace-write` 和 `/permissions danger-full-access` 可切换当前聊天的权限，上限由服务启动配置决定。设置会保存，下一次使用会话时生效，已有上下文保留，`/new` 也会保留该设置。服务以更低权限重启后，聊天权限自动受新上限约束。其他以 `/` 开头的输入会被视为不支持的命令。若要发送普通的斜杠开头文本，在开头再加一个 `/`，例如 `//plan`。

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

systemd 服务不会继承安装命令所在 shell 的环境变量。要为后台服务设置微信发送者白名单，可运行 `sudo systemctl edit codex-wechat-channel.service`，添加以下内容，然后重新加载并重启服务：

```ini
[Service]
Environment=CODEX_WECHAT_ALLOWED_USERS=wxid1,wxid2
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart codex-wechat-channel.service
```

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
| `CODEX_WECHAT_ALLOWED_USERS` | 允许使用桥接的微信发送者 ID，多个 ID 用逗号分隔 | 未设置时允许所有用户，并在启动时警告 |
| `CODEX_WECHAT_SANDBOX` | 默认沙盒权限及聊天权限上限：`read-only`、`workspace-write` 或 `danger-full-access` | `danger-full-access` |
| `CODEX_WECHAT_APPROVAL_POLICY` | 审批策略 | `never` |
| `CODEX_WECHAT_APP_SERVER_URL` | 连接已有 app-server 的 WebSocket 地址 | 自动启动内置 app-server |
| `CODEX_WECHAT_BASE_URL` | 微信 ilink API 地址 | `https://ilinkai.weixin.qq.com` |
| `CODEX_WECHAT_DEVELOPER_INSTRUCTIONS` | 追加到会话 的指令 | 无 |
| `OPENAI_API_KEY` | app-server 使用的 API 密钥 | 尝试读取 Codex 登录文件 |

默认权限允许 Codex 在沙盒策略范围内执行操作。若需限制访问，可设置 `CODEX_WECHAT_SANDBOX=workspace-write` 或 `read-only`。`approvalPolicy=never` 不会等待人工审批，部署前应按自己的使用场景选择权限。

未设置 `CODEX_WECHAT_ALLOWED_USERS` 时，桥接会接受所有用户消息并在启动时警告。设置后，只有列表中的发送者可以使用桥接，私聊和群聊都按发送者 ID 判断。建议配置可信用户 ID，避免其他人触发具有上述沙盒权限的 Codex 操作。被拒绝的消息不会触发 Codex。

## 本地开发与检查

运行时没有第三方 npm 依赖。开发依赖包括 TypeScript、ESLint、SonarJS 和 c8，由锁文件固定版本。开发与 CI 使用最新的 Node.js 22 或 24，发布产物仍可在 Node.js 22 及以上运行。

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

`npm test` 构建源码后，使用 Node.js 内置测试运行器执行编译后的测试。`test:coverage` 统计全部生产文件，包括未被测试加载的模块，行、分支、函数覆盖率下限分别为 70%、60%、60%。额外的文件范围检查会拒绝空报告或遗漏生产文件的报告。

公开仓库的 PR 和 `main` 推送会在 Node.js 22、24 上运行上述检查。测试用本地替身验证微信请求、消息处理、连接恢复、登录保存和服务控制，不访问真实微信或安装系统服务。包检查会生成 tarball，在临时目录离线安装，并运行实际安装后的 CLI。

`audit:code` 输出代码行数、函数复杂度、模块依赖和静态调用关系。指标定义、已知局限和数据流见[代码维护检查](docs/maintenance-audit.md)。编译输出和覆盖率产物不提交到 Git，发布的源映射包含对应 TypeScript 源码，便于定位问题。

## 本地数据

运行数据保存在 `~/.codex/channels/wechat/`：

- `account.json`：微信登录信息
- `bridge.pid`、`bridge.stdout.log`、`bridge.stderr.log`：后台进程状态和日志
- `context_tokens.json`：微信回复上下文
- `threads.json`：聊天与 Codex 会话的对应关系
- `sync_buf.txt`：微信长轮询游标
- `media/`：下载的图片

## 文档

- [代码维护检查](docs/maintenance-audit.md)
- [方案与功能现状](docs/plan-and-progress.md)
- [默认权限与远端部署](docs/releases/2026-03-25-default-danger-full-access.md)
- [systemd 服务与配置监视](docs/releases/2026-03-25-systemd-service-and-autoreload.md)
- [npm 包、鉴权回退与后台控制](docs/releases/2026-03-25-auth-fallback-and-bridgectl.md)
