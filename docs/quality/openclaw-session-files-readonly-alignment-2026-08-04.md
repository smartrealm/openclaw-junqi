# OpenClaw 会话文件只读投影对齐

日期：2026-08-04

## 审计结论

JunQi 现有的终端与文件工作区由本机 Tauri 文件能力和用户选择的目录构成，不能证明其等同于当前
OpenClaw 会话的 Gateway checkout。官方 `sessions.files.list` 与 `sessions.files.get` 以 sessionKey
解析会话根目录并执行路径边界检查，适合作为会话文件查看的唯一事实源。

## 官方依据

- `packages/gateway-protocol/src/schema/sessions.ts`
- `src/gateway/server-methods/sessions-files.ts`
- `ui/src/pages/chat/components/chat-session-workspace.ts`

## 范围

本轮仅呈现 Gateway 返回的已触及文件、目录浏览条目和支持的内联预览，不读取本地路径，不使用 Tauri
文件系统替代 Gateway，也不调用 `sessions.files.set` 或 `sessions.files.reveal`。

`sessions.files.set` 是带 `expectedHash` 的 CAS 写入，并依赖 Gateway 的 operator-admin 授权；在完整
审计其权限、冲突恢复和编辑器生命周期前，JunQi 不显示本地伪编辑能力。

## 实现

- `OpenClawSessionFilesClient` 通过 identity-fenced Gateway 请求读取列表和单文件内容；响应必须匹配
  请求 sessionKey，协议字段或连接身份变化无效时失败关闭。
- 会话上下文栏显示已触及文件和 Gateway 返回的 session-rooted 浏览器条目。目录导航只将官方返回的
  相对路径回传给 `sessions.files.list`。
- 文本预览仅接受 `text`、`utf8` 与字符串内容的组合。图片预览额外限制为官方 Control UI 使用的
  AVIF、GIF、JPEG、PNG 与 WebP MIME 类型以及 base64 内容。

## 验证

2026-08-04 已通过以下自动化验证：

- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm verify:openclaw-docs`
- 本地 JSON 解析、改动文件 Emoji 扫描和 `git diff --check`

真实 Gateway 文件、远程执行节点和各目标操作系统的实际响应仍需在对应运行时实测；本实现不依赖
平台专属文件 API。
