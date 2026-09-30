# Configuration and permissions

[中文页面](configuration.zh-CN.md)

The bridge supports private chats with the WeChat iOS ClawBot. It accepts messages sent to the connected WeChat account and does not provide a sender allowlist. The former `CODEX_WECHAT_ALLOWED_USERS` setting has been removed.

## Sandbox permissions

`CODEX_WECHAT_SANDBOX` accepts `read-only`, `workspace-write`, or `danger-full-access`. The default is `danger-full-access`. The `--sandbox` startup option also sets the mode. `CODEX_WECHAT_APPROVAL_POLICY` defaults to `never`, so the bridge does not wait for manual approval.

In WeChat, `/permissions` shows the current chat mode and the limit set when the service started. Commands such as `/permissions read-only` change the chat setting but cannot exceed the service limit. Settings are saved per chat and apply the next time that conversation is used. Lowering the service limit also constrains existing chat settings.

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `CODEX_BIN` | Codex CLI executable | `codex` |
| `CODEX_WECHAT_CWD` | Codex working directory | Current directory |
| `CODEX_WECHAT_MODEL` | Default model | Codex default |
| `CODEX_WECHAT_SANDBOX` | Default sandbox mode and chat permission limit | `danger-full-access` |
| `CODEX_WECHAT_APPROVAL_POLICY` | Approval policy | `never` |
| `CODEX_WECHAT_APP_SERVER_URL` | WebSocket URL of an existing app-server | Start the bundled app-server |
| `CODEX_WECHAT_BASE_URL` | WeChat ilink API base URL | `https://ilinkai.weixin.qq.com` |
| `CODEX_WECHAT_DEVELOPER_INSTRUCTIONS` | Instructions appended to sessions | None |
| `OPENAI_API_KEY` | API key for the bundled app-server | Try the Codex auth file |

If `OPENAI_API_KEY` is unset, the bundled app-server reads only a string field named `OPENAI_API_KEY` at the top level of `~/.codex/auth.json`. Startup fails with an authentication error if the field is absent. When connecting to an existing app-server, that server handles authentication.
