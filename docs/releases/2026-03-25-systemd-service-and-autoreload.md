# 2026-03-25 Linux systemd 自启与配置自动重载

本文记录发布当时的变更和验证结果，不代表当前版本已重新执行这些检查。

## 摘要

这次补齐了 Linux 服务器部署链路里最缺的一环：

- 把 bridge 做成正式 `systemd` 服务，支持开机自启与异常退出自动拉起
- 把 `~/.codex/config.toml`、`~/.codex/AGENTS.md`、`~/.codex/skills/`、`~/.codex/prompts/` 的变更接进递归 watcher，修改后自动重启 bridge

## 变更内容

### 1. 新增 service CLI

- 新增 `scripts/servicectl.mjs`
- 对外暴露：
  - `codex-wechat-channel service install`
  - `codex-wechat-channel service status`
  - `codex-wechat-channel service uninstall`

### 2. 新增递归 watcher

- 新增 `scripts/watch-codex-config.sh`
- 基于 `inotifywait` 监听 `~/.codex` 根目录中的 `config.toml` / `AGENTS.md`
- 基于 `inotifywait -r` 递归监听 `~/.codex/skills/` 与 `~/.codex/prompts/`
- 变更触发后调用 `systemctl restart codex-wechat-channel.service`
- 内置简单防抖，避免单次文件写入触发多次重启

### 3. 安装行为

- `service install` 会写入：
  - `/etc/systemd/system/codex-wechat-channel.service`
  - `/etc/systemd/system/codex-wechat-channel-watch.service`
- 通过 `sudo` 执行时，会优先使用 `SUDO_USER` 对应的用户与 home 目录生成 `User=`、`Environment=HOME=` 与 `PIDFile=`
- 重复执行 `service install` 会 `daemon-reload` 并强制 `restart` 已在运行的 bridge / watcher，确保新 unit 立即生效
- 会自动安装 `inotify-tools`（Ubuntu / Debian 下通过 `apt-get`）
- 会停用旧的 `codex-wechat-channel-restart.path` 方案

## 验证结果

本次发布前已实际验证：

- `npm run check`：通过
- `node cli.mjs help`：通过
- `npm pack`：通过
- 远端 Ubuntu 24.04：
  - `codex-wechat-channel service install --cwd /home/ubuntu`：通过
  - 主服务已被 `systemd` 接管：通过
  - 修改深层 skill 文件后 bridge 自动重启：通过
  - 修改 `~/.codex/config.toml` 后 bridge 自动重启：通过
  - `service install` 重复执行后，运行中的 bridge / watcher 会立即切换到新 unit：通过

## 使用方式

```bash
sudo codex-wechat-channel service install --cwd /home/ubuntu
codex-wechat-channel service status
sudo codex-wechat-channel service uninstall
```

如需显式覆盖部署用户：

```bash
sudo codex-wechat-channel service install --cwd /srv/repo --user ubuntu --home /home/ubuntu
```

## 已知限制

- 当前只支持 Linux + `systemd`
- 递归 watcher 依赖 `inotify-tools`
- 自动重启覆盖的是后台 bridge 服务，不包括你手工打开的交互式 `codex` TUI 会话
