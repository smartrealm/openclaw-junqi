# OpenClaw Stop 跨入口请求状态围栏计划

日期：2026-08-04

## 执行顺序

- [x] 对照官方 `sessions.abort` 契约，核对 Quick Chat、会话生命周期与发送协调器。
- [x] 证实三个次级 Stop 入口只检查流式状态，遗漏发送中请求。
- [x] 复用 Chat Store 活动请求选择器修复 Quick Chat Stop、窗口销毁和原生 mutation 前置 Stop。
- [x] 补充发送中状态的行为回归，并验证无活动状态不会发出 Stop。
- [x] 执行全量验证、Emoji 与无引用扫描，更新记录并使用中文提交。

## 文件范围

- `src/pages/QuickChatPage.tsx`
- `src/pages/QuickChatRoot.tsx`
- `src/pages/quickChatStop.ts`
- `src/pages/quickChatStop.test.ts`
- `src/services/collaboration/sessionLifecycle.ts`
- `src/services/collaboration/sessionLifecycle.test.ts`
- 本规格、计划、审计记录及三层索引

## 非目标

- 不修改 OpenClaw Gateway 协议、Tauri command、Rust 后端、Task checkpoint 格式或持久化内容。
