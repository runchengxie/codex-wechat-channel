# 配置与权限

## 微信发送者白名单

设置 `CODEX_WECHAT_ALLOWED_USERS`，填入允许使用桥接的微信发送者 ID，多个 ID 用英文逗号分隔。私聊和群聊都按发送者 ID 判断。未设置时，所有用户消息都会被接受，启动日志会给出提醒。

前台启动示例：

```bash
CODEX_WECHAT_ALLOWED_USERS=wxid1,wxid2 node dist/cli.js start --cwd /path/to/repository
```

systemd 服务不会继承安装命令所在 shell 的环境变量。使用项目安装的系统级服务时，可通过 `sudo systemctl edit codex-wechat-channel.service` 添加：

```ini
[Service]
Environment=CODEX_WECHAT_ALLOWED_USERS=wxid1,wxid2
```

然后执行 `sudo systemctl daemon-reload` 和 `sudo systemctl restart codex-wechat-channel.service`。若桥接运行在用户级 systemd 服务中，应改用 `systemctl --user edit`、`systemctl --user daemon-reload` 和 `systemctl --user restart`。

被白名单拒绝的消息不会触发 Codex。配置发送者 ID 后，建议先用获准账号发送一条消息确认设置生效。

## 沙盒权限

`CODEX_WECHAT_SANDBOX` 可设为 `read-only`、`workspace-write` 或 `danger-full-access`，默认是 `danger-full-access`。启动参数 `--sandbox` 也可设置模式。`CODEX_WECHAT_APPROVAL_POLICY` 默认是 `never`，桥接不会等待人工审批。请按使用场景设置服务权限和白名单。

微信中的 `/permissions` 显示当前聊天的模式和服务启动时设置的上限。`/permissions read-only` 等命令可修改当前聊天的设置，不能超过服务上限。设置按聊天保存，下一次使用会话时生效。服务降低上限后，原有聊天设置也会受到新上限约束。

例如，服务以 `--sandbox read-only` 启动时，微信聊天中不能切换到 `workspace-write` 或 `danger-full-access`。

## 环境变量

| 环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `CODEX_BIN` | Codex CLI 可执行文件 | `codex` |
| `CODEX_WECHAT_CWD` | Codex 工作目录 | 当前目录 |
| `CODEX_WECHAT_MODEL` | 默认模型 | Codex 默认值 |
| `CODEX_WECHAT_ALLOWED_USERS` | 允许的微信发送者 ID | 未设置时允许所有用户并给出提醒 |
| `CODEX_WECHAT_SANDBOX` | 默认沙盒模式和聊天权限上限 | `danger-full-access` |
| `CODEX_WECHAT_APPROVAL_POLICY` | 审批策略 | `never` |
| `CODEX_WECHAT_APP_SERVER_URL` | 已运行的 app-server WebSocket 地址 | 自动启动内置 app-server |
| `CODEX_WECHAT_BASE_URL` | 微信 ilink API 地址 | `https://ilinkai.weixin.qq.com` |
| `CODEX_WECHAT_DEVELOPER_INSTRUCTIONS` | 追加到会话的指令 | 无 |
| `OPENAI_API_KEY` | 内置 app-server 使用的 API 密钥 | 尝试读取 Codex 登录文件 |

没有设置 `OPENAI_API_KEY` 时，内置 app-server 会尝试从 `~/.codex/auth.json` 读取密钥。连接已有 app-server 时，由该服务负责鉴权。
