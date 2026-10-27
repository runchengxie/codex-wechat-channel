# Feature status

[简体中文](plan-and-progress.zh-CN.md)

The bridge connects WeChat ClawBot private messages to separate Codex sessions.

## Message flow

```text
WeChat ClawBot
  -> WeChat ilink API
  -> codex-wechat-channel
  -> Codex app-server
  -> a Codex session for each chat
  -> WeChat text reply
```

The bridge starts or connects to Codex app-server directly. Messages do not pass through the Codex CLI terminal command parser, so the bridge implements chat commands such as `/model`, `/new`, and `/review` itself.

## Module responsibilities

- `src/wechat-api.ts`: QR login, polling, text messages, media download and decryption, and content extraction.
- `src/attachments.ts`: text, PDF and DOCX extraction, video duration checks, frames and audio extraction.
- `src/codex-app-server.ts`: app-server connections, sessions, turns and model requests.
- `src/start.ts`: polling, chat-to-session mapping, per-chat queues and replies.
- `src/commands.ts`: chat command parsing and execution.
- `src/protocol.ts`, `src/wechat-types.ts`, `src/thread-store.ts`: boundary validation and session-state types.
- `src/update-batch.ts`: cursor persistence after a completed batch.
- `src/setup.ts`: interactive QR login and credential persistence.
- `scripts/bridgectl.ts`: background process start, stop and status.
- `scripts/servicectl.ts`, `scripts/watch-codex-config.sh`: Linux systemd installation and configuration monitoring.

## Supported behavior

- QR login, long polling and text replies.
- Downloading and decrypting images for Codex.
- Text extraction from txt, md, csv, json, pdf and docx attachments. Each download is limited to 25 MiB and extracted content to 100,000 characters. PDF extraction reads at most 100 pages without OCR. DOCX extraction produces plain text.
- Video download and decryption, duration checks through system `ffprobe`, and extraction of up to six frames and available audio through `ffmpeg`. Videos are limited to 25 MiB and 180 seconds; frames fit within 768 × 768. Audio becomes mono 16 kHz, 32 kbps MP3 with an 8 MiB limit. Video and derived media are temporary and removed after the turn.
- Using voice transcripts supplied by WeChat. The bridge does not transcribe audio when no transcript is supplied.
- Per-chat sessions, model, reasoning effort and working directory, with recent session history.
- Private chats through the current WeChat iOS ClawBot integration. The bridge handles inbound messages delivered to the account and has no sender allowlist setting.
- Background operation, health probes, Linux systemd installation and automatic restart after configuration changes.

## Build and verification

Runtime and tests use TypeScript, compiled by `tsc` into ESM JavaScript under `dist/`. WeChat messages, Codex responses and local JSON pass field validation. PDF and DOCX extraction use `pdfjs-dist` and `mammoth`. Video processing calls system `ffmpeg` and `ffprobe`; missing tools or unsupported formats leave Codex with the video message information and an extraction failure description.

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

Compiled tests run from `dist/test/`. They cover commands, batch cursors, app-server notifications and reconnection, WeChat requests, decryption, document extraction, video arguments, credential saving, lifecycle and service control. Network, media commands and system processes use substitutes. Systemd tests check generated text and command arguments without installing a service.

Coverage includes the CLI, every `src/` module and Node service scripts. Line, branch and function floors are 70%, 60% and 60%; the report must include every production file. GitHub Actions runs checks on Node.js 22 and 24. Package checks install the actual tarball and execute its CLI; installation requires npm registry access.

The complexity report distinguishes resolved and unresolved calls and cannot alone justify code deletion. See [maintenance metrics](maintenance-audit.md). Historical records under `docs/releases/` do not establish that the current version passed real WeChat or systemd acceptance checks.

## Unsupported features

- Group chats in the current WeChat iOS ClawBot integration.
- OCR for scanned PDFs.
- Legacy `.doc`, `.xlsx`, `.pptx` and other Office format extraction.
- WeChat speech recognition beyond the transcript already present in a message.

## Chat permissions

`/permissions` shows the chat sandbox mode and service ceiling. Supplying `read-only`, `workspace-write` or `danger-full-access` saves a mode for the next session use. The setting is isolated per chat, preserves context and carries into `/new`. Restarting the service with a lower ceiling constrains the effective permissions.
