# OpenClaw 会话变更快照对齐

日期：2026-08-04

## 审计结论

JunQi 的通用 Git 工作区不能证明它与当前 OpenClaw 会话的 checkout、基线或 session identity 一致。
官方 `sessions.diff` 已提供该只读投影，应以它作为唯一事实源。

## 来源

- `packages/gateway-protocol/src/schema/sessions.ts`
- `src/gateway/server-methods/sessions-diff.ts`
- `ui/src/pages/chat/components/session-diff-panel.ts`

## 边界

该功能只读取 Gateway 的会话变更快照，不写入文件、不打开任意宿主路径，也不将本地 Git 差异伪装为
OpenClaw session diff。

## 实现

- `OpenClawSessionDiffClient` 通过已认证的 Gateway 连接调用 `sessions.diff`，请求和响应均绑定同一
  sessionKey；连接切换、断线、未知方法和畸形协议响应均失败关闭。
- 会话上下文栏提供只读变更面板，展示官方返回的基线、分支、汇总统计、文件状态、补丁及
  `unknown_session`、`not_git`、二进制和截断语义。
- 面板不访问本地 Git 或文件系统；关闭、按 Escape 或点击面板外部不会保留悬浮窗口，过期读取结果
  不会覆盖较新的读取请求。

## 验证

2026-08-04 已通过以下自动化验证：

- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm verify:openclaw-docs`
- 本地 JSON 解析、改动文件 Emoji 扫描和 `git diff --check`

该项没有 macOS、Windows 或 Linux 特有实现；实际 Gateway 返回依赖目标运行时的 OpenClaw 版本和会话
checkout 状态，仍需在目标平台连接对应 Gateway 后验收。
