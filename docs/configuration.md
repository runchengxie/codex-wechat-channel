# 配置与权限

当前微信 iOS ClawBot 接入方式支持私聊。桥接按微信账号收取发给 ClawBot 的消息，不提供发送者白名单设置。旧版的 `CODEX_WECHAT_ALLOWED_USERS` 配置已移除，不再生效。

## 沙盒权限

`CODEX_WECHAT_SANDBOX` 可设为 `read-only`、`workspace-write` 或 `danger-full-access`，默认是 `danger-full-access`。启动参数 `--sandbox` 也可设置模式。`CODEX_WECHAT_APPROVAL_POLICY` 默认是 `never`，桥接不会等待人工审批。请按使用场景设置服务权限。

微信中的 `/permissions` 显示当前聊天的模式和服务启动时设置的上限。`/permissions read-only` 等命令可修改当前聊天的设置，不能超过服务上限。设置按聊天保存，下一次使用会话时生效。服务降低上限后，原有聊天设置也会受到新上限约束。

例如，服务以 `--sandbox read-only` 启动时，微信聊天中不能切换到 `workspace-write` 或 `danger-full-access`。

## 环境变量

| 环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `CODEX_BIN` | Codex CLI 可执行文件 | `codex` |
| `CODEX_WECHAT_CWD` | Codex 工作目录 | 当前目录 |
| `CODEX_WECHAT_MODEL` | 默认模型 | Codex 默认值 |
| `CODEX_WECHAT_SANDBOX` | 默认沙盒模式和聊天权限上限 | `danger-full-access` |
| `CODEX_WECHAT_APPROVAL_POLICY` | 审批策略 | `never` |
| `CODEX_WECHAT_APP_SERVER_URL` | 已运行的 app-server WebSocket 地址 | 自动启动内置 app-server |
| `CODEX_WECHAT_BASE_URL` | 微信 ilink API 地址 | `https://ilinkai.weixin.qq.com` |
| `CODEX_WECHAT_DEVELOPER_INSTRUCTIONS` | 追加到会话的指令 | 无 |
| `OPENAI_API_KEY` | 内置 app-server 使用的 API 密钥 | 尝试读取 Codex 登录文件 |

没有设置 `OPENAI_API_KEY` 环境变量时，内置 app-server 只会从 `~/.codex/auth.json` 顶层的 `OPENAI_API_KEY` 字符串字段读取密钥。该字段不存在时，启动会报鉴权错误。连接已有 app-server 时，由该服务负责鉴权。
