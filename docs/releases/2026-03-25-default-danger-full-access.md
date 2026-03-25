# 2026-03-25 默认全权限与远端部署

## 摘要

这次发布解决了两个部署问题：

- 远端机器每次启动 bridge 都要手工补 `CODEX_WECHAT_SANDBOX=danger-full-access`
- npm 已发布 `0.1.0` 后，需要一个新版本把默认权限策略固化到包本身

## 变更内容

### 1. 默认 sandbox 调整

- `src/constants.mjs` 的默认 `sandbox` 从 `workspace-write` 改为 `danger-full-access`
- 未显式设置 `CODEX_WECHAT_SANDBOX` 时，`start` 与后台 `bridge start` 都会直接以全权限启动
- `approvalPolicy` 继续保持默认 `never`

### 2. 文档同步

- `README.md` 更新了默认环境变量示例
- `README.md` 明确说明默认是 `danger-full-access`
- 保留通过环境变量显式降权到 `workspace-write` 或 `read-only` 的方式

## 验证结果

本次发布前已实际验证：

- `npm run check`：通过
- `node --input-type=module -e "import { DEFAULT_SANDBOX, PACKAGE_VERSION } from './src/constants.mjs'; ..."`：输出 `danger-full-access` 与 `0.1.2`
- `npm pack`：通过
- `npx --yes --package .\\codex-wechat-channel-0.1.2.tgz codex-wechat-channel help`：通过
- 远端 Ubuntu 24.04：
  - 已安装 Node.js `22.22.1`
  - 已安装 `codex-cli 0.116.0`
  - 已安装 `codex-wechat-channel`
  - 已完成微信扫码登录
  - 后台 bridge 已用 `danger-full-access` 运行

## 使用方式

默认直接启动即可：

```bash
codex-wechat-channel start
codex-wechat-channel bridge start
```

如果你想显式收紧权限：

```bash
CODEX_WECHAT_SANDBOX=workspace-write codex-wechat-channel bridge start
CODEX_WECHAT_SANDBOX=read-only codex-wechat-channel start
```
