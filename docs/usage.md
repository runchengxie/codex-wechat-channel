# 使用指南

## 登录与启动

启动前先检查[微信发送者白名单和沙盒权限](configuration.md)。未配置白名单时所有发送者都能使用桥接，默认沙盒模式为 `danger-full-access`。

在仓库根目录安装依赖并构建后，运行：

```bash
node dist/cli.js setup
node dist/cli.js start --cwd /path/to/repository
```

`setup` 会显示扫码登录地址，登录信息保存在 `~/.codex/channels/wechat/account.json`。再次登录可使用 `node dist/cli.js setup --force`。未指定 `--cwd` 时，Codex 使用启动命令所在目录。

可以使用 `--model MODEL` 选择默认模型，也可以通过 `--app-server-url WS_URL` 连接已有的 Codex app-server。内置 app-server 需要环境变量 `OPENAI_API_KEY`，或 `~/.codex/auth.json` 顶层的 `OPENAI_API_KEY` 字段。其他形式的 Codex 登录记录不能满足当前桥接程序的读取要求。其他选项见[配置与权限](configuration.md)。

## 微信聊天命令

| 命令 | 用途 |
| --- | --- |
| `/help` | 查看可用命令 |
| `/model [名称]`、`/models` | 查看或切换当前聊天的模型，支持 `luna`、`sol`、`terra`、`astra` 等快捷名称 |
| `/effort [级别]` | 设置当前聊天的推理强度 |
| `/status`、`/config` | 查看模型、推理强度、权限、工作目录和会话 |
| `/cwd [路径]` | 在启动目录下选择 Git 工作树 |
| `/new` | 开始新会话，保留聊天设置 |
| `/threads`、`/resume <id>` | 查看或恢复当前聊天保存的会话 |
| `/compact` | 压缩当前会话上下文 |
| `/fork` | 复制当前会话并切换到副本 |
| `/rename <名称>` | 给当前会话命名 |
| `/review` | 审查当前 Git 工作树中的未提交变更 |
| `/diff` | 查看当前 Git 工作树的状态和差异统计 |
| `/permissions [模式]` | 查看或修改当前聊天的沙盒权限 |

`/cwd` 只接受桥接启动目录内的 Git 工作树。`/review` 和 `/diff` 要求当前目录是 Git 工作树。其他以 `/` 开头的消息会被当作不支持的命令。要发送普通的斜杠开头文本，在前面再加一个 `/`，例如 `//plan`。

`/permissions` 支持 `read-only`、`workspace-write` 和 `danger-full-access`。新设置在下一次使用会话时生效，已有上下文保留，`/new` 也会保留该设置。服务以更低权限重启后，实际权限受新的上限限制。

## 后台运行

在稳定的源码目录构建后，可以执行：

```bash
node dist/cli.js bridge start --cwd /path/to/repository
node dist/cli.js bridge status
node dist/cli.js bridge stop
node dist/cli.js probe
```

需要全局命令时，可在稳定的源码目录运行 `npm link`，然后使用 `codex-wechat-channel`。源码更新后要重新构建。常驻服务应指向稳定安装目录，不要指向开发任务的临时 worktree。

Linux 上还可以安装 systemd 服务：

```bash
sudo codex-wechat-channel service install --cwd /path/to/repository
codex-wechat-channel service status
sudo codex-wechat-channel service uninstall
```

安装命令会创建桥接和 Codex 配置监视服务。配置监视依赖 `inotify-tools`，在 Debian 或 Ubuntu 上安装器会尝试通过 `apt-get` 安装。修改 `~/.codex/config.toml`、`AGENTS.md`、`skills/` 或 `prompts/` 后，监视服务会重启桥接。自定义运行用户和主目录可使用 `--user`、`--home`。

## 本地数据

运行数据保存在 `~/.codex/channels/wechat/`：

| 文件 | 内容 |
| --- | --- |
| `account.json` | 微信登录信息 |
| `threads.json` | 聊天与 Codex 会话的对应关系、聊天设置 |
| `context_tokens.json` | 微信回复上下文 |
| `sync_buf.txt` | 微信长轮询游标 |
| `bridge.pid`、`bridge.stdout.log`、`bridge.stderr.log` | 后台进程状态和日志 |
| `media/` | 下载的图片 |

请把登录信息和运行数据留在仓库外，不要提交到 Git。
