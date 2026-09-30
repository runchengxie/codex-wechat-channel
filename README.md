# codex-wechat-channel

Message Codex through private chats with the WeChat iOS ClawBot and receive replies in WeChat. Sessions can be resumed after a restart.

[中文 README](README.zh-CN.md)

The channel supports text, images, voice transcripts supplied by WeChat, and `txt`, `md`, `csv`, `json`, `pdf`, and `docx` attachments. For video, it extracts frames and any available audio track for Codex to analyze. Video processing requires `ffmpeg` and `ffprobe`. If a WeChat voice message has no transcript, Codex receives only a notice that a voice message was sent.

## Quick start

You need Node.js 22 or newer, the Codex CLI, an `OPENAI_API_KEY`, and an account that can use the WeChat iOS ClawBot. The built-in app-server can also read the key from the top-level `OPENAI_API_KEY` field in `~/.codex/auth.json`; see [configuration and permissions](docs/configuration.md).

Before starting, review the configured permissions: the default sandbox mode is `danger-full-access` and the approval policy is `never`. Read [permission settings](docs/configuration.md) and choose settings for your use case.

```bash
git clone https://github.com/runchengxie/codex-wechat-channel.git
cd codex-wechat-channel
npm ci
npm run build
node dist/cli.js setup
node dist/cli.js start
```

After `setup`, scan the address shown in the terminal to sign in. Once the service starts, message the ClawBot. By default, code tasks run in the directory where the command was started; use `--cwd` to select another directory. Press `Ctrl+C` to stop a foreground process.

This repository is a fork of the [original project](https://github.com/renqingfei/codex-wechat-channel). These changes have not been published as a new npm version. Install from source using the commands above.

## Use it in WeChat

- `/help`: show the available chat commands.
- `/new`: start a new session.
- `/model`: view or change the model.
- `/permissions`: view the current sandbox permissions; include a mode name to change the current chat's setting.
- `/status`: show the current model, working directory, and session.

Chat permissions cannot exceed the limits set when the bridge service starts. See the [user guide](docs/usage.md) for all commands.

## More documentation

- [User guide](docs/usage.md): chat commands, background operation, and local data.
- [Configuration and permissions](docs/configuration.md): sandbox modes, models, and app-server.
- [Development and checks](docs/development.md): TypeScript build, tests, CI, and package release.
- [Feature status](docs/plan-and-progress.md): feature boundaries and module responsibilities.
- [Maintenance audit](docs/maintenance-audit.md): complexity, dependencies, and metric definitions.
