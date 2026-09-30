# User guide

[中文页面](usage.zh-CN.md)

## Sign in and start

Review [sandbox permissions](configuration.md) before starting. The default sandbox mode is `danger-full-access`, and the approval policy is `never`.

Install dependencies and build from the repository root, then run:

```bash
node dist/cli.js setup
node dist/cli.js start --cwd /path/to/repository
```

`setup` prints a sign-in URL. Account data is saved in `~/.codex/channels/wechat/account.json`. To sign in again, run `node dist/cli.js setup --force`. Without `--cwd`, Codex uses the directory from which the start command was run. Use `--model MODEL` to choose the default model or `--app-server-url WS_URL` to connect to an existing Codex app-server. The bundled app-server needs `OPENAI_API_KEY` or the top-level `OPENAI_API_KEY` field in `~/.codex/auth.json`.

## WeChat commands

| Command | Purpose |
| --- | --- |
| `/help` | Show available commands |
| `/model [name]`, `/models` | View or change the chat model; shortcuts include `luna`, `sol`, `terra`, and `astra` |
| `/effort [level]` | Set reasoning effort for the chat |
| `/status`, `/config` | Show model, reasoning effort, permissions, working directory, and session |
| `/cwd [path]` | Choose a Git worktree inside the startup directory |
| `/new` | Start a session while keeping chat settings |
| `/threads`, `/resume <id>` | List or resume saved sessions for the chat |
| `/compact` | Compact the current session context |
| `/fork` | Copy the current session and switch to the copy |
| `/rename <name>` | Rename the current session |
| `/review` | Review uncommitted changes in the current Git worktree |
| `/diff` | Show status and diff statistics for the current Git worktree |
| `/permissions [mode]` | View or change the chat sandbox mode |

`/cwd` accepts only Git worktrees inside the bridge startup directory. `/review` and `/diff` require the current directory to be a Git worktree. Other messages beginning with `/` are treated as unsupported commands. Prefix an ordinary slash-leading message with another slash, for example `//plan`.

`/permissions` accepts `read-only`, `workspace-write`, and `danger-full-access`. New settings apply the next time the session is used; existing context is retained, and `/new` preserves the setting. The service permission limit always applies.

## Run in the background

Build from a stable source directory, then run:

```bash
node dist/cli.js bridge start --cwd /path/to/repository
node dist/cli.js bridge status
node dist/cli.js bridge stop
node dist/cli.js probe
```

Run `npm link` from the stable source directory to use the global `codex-wechat-channel` command. Rebuild after source updates. A long-running service should point to a stable installation directory, not a temporary development worktree.

On Linux, install or manage a systemd service with:

```bash
sudo codex-wechat-channel service install --cwd /path/to/repository
codex-wechat-channel service status
sudo codex-wechat-channel service uninstall
```

The installer creates bridge and Codex configuration watcher services. The watcher requires `inotify-tools`; on Debian or Ubuntu the installer attempts to install it with `apt-get`. Changes to `~/.codex/config.toml`, `AGENTS.md`, `skills/`, or `prompts/` restart the bridge. Use `--user` and `--home` for a custom runtime user and home directory.

## Attachments and video

The bridge downloads and decrypts `txt`, `md`, `csv`, `json`, `pdf`, and `docx` attachments and extracts their text for Codex. Each attachment is limited to 25 MiB, extracted text to 100,000 characters, and PDFs to the first 100 pages. Scanned, encrypted, or textless PDFs are not OCR processed. DOCX files are read as plain text. Legacy `.doc`, `.xlsx`, `.pptx`, and other formats are not parsed; the message's existing metadata, such as a filename, is passed along.

Video processing requires `ffmpeg` and `ffprobe` on the service `PATH`. Videos are limited to 25 MiB and 180 seconds, and at most six frames are extracted. If there is an audio track, the bridge also creates mono, 16 kHz, 32 kbps MP3 audio, limited to 8 MiB, and sends it with the frames. Media is kept in a local temporary directory during processing and deleted after the Codex turn. If audio extraction fails, frames are still sent. Actual audio recognition depends on the Codex service and model; local tests do not verify it against a real account. If tools are unavailable, limits are exceeded, or decoding fails, the bridge tells Codex and lets Codex respond.

## Local data

Runtime data is stored under `~/.codex/channels/wechat/`:

| Path | Contents |
| --- | --- |
| `account.json` | WeChat sign-in data |
| `threads.json` | Chat-to-Codex session mapping and chat settings |
| `context_tokens.json` | WeChat reply context |
| `sync_buf.txt` | WeChat long-poll cursor |
| `bridge.pid`, `bridge.stdout.log`, `bridge.stderr.log` | Background process state and logs |
| `media/` | Downloaded images and temporary video files |

Keep sign-in credentials and runtime data outside the repository; do not commit them to Git.
