# OpenClaw 会话文件 CAS 写入对齐

日期：2026-08-04

## 依据

官方 `SessionsFilesSetParamsSchema` 要求 sessionKey、path、content 和 64 位 SHA-256 `expectedHash`。
`sessions.files.set` 仅覆盖已存在的会话工作区文件，Gateway 在写入前校验 UTF-8、NUL、大小、路径边界、
会话 mutation authorization 与 CAS 哈希。竞争写入返回 `session_file_conflict` 及当前哈希。

## 实现边界

JunQi 使用现有单次 `operator.admin` 临时连接请求写入，不从日常连接或本地权限猜测授权。写入 client
只接受 Gateway 返回的 sessionKey 与文件投影；冲突保持为可辨识状态，绝不重试或覆盖当前内容。

本轮只实现 Gateway 写入边界及回归。编辑器草稿、冲突重读和用户确认流程另行审计后接入。

## 验证

2026-08-04 已通过 `pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs`、本地
JSON 解析、改动文件 Emoji 扫描和 `git diff --check`。真实 admin 授权、设备配对和 Gateway 文件写入
仍需在目标运行时实测；本轮未接入平台专属文件 API。
