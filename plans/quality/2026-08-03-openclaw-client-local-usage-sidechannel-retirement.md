# OpenClaw 客户端本机用量旁路退役计划

日期：2026-08-03

## 实施顺序

1. 完成：核对 OpenClaw `usage.status` 的权限、协议、handler 和默认 Agent 作用域。
2. 完成：审计前端 Hook、AgentRunView、Tauri command、OAuth 模块、注册表、平台开关和调用方。
3. 完成：删除非 Gateway 本机用量链路及其 UI 投射，保留 Provider 页面原生 Gateway 展示。
4. 完成：补充退役回归、文档、规格和计划索引。
5. 完成：运行 TypeScript、Rust、完整验证、差异检查和 Emoji 扫描后中文提交。

## 文件范围

- `src/pages/AgentRunView.tsx`
- `src/pages/AgentRunView.test.ts`
- `src/components/Terminal/{platform.ts,terminalTypes.ts,terminalShared.ts}`
- `src/hooks/useUsageSnapshot.{ts,test.ts}`
- `src-tauri/src/{lib.rs,commands/mod.rs,commands/usage.rs,commands/oauth.rs}`
- `docs/quality/`、`specs/quality/`、`plans/quality/` 及索引

## 验证

- AgentRunView 定向回归
- `pnpm lint`
- `pnpm test`
- `pnpm test:rust`
- `pnpm verify:openclaw-docs`
- `pnpm collab:test`
- `pnpm collab:validate`
- `pnpm build`
- `git diff --check`、完整修改文件 Emoji 扫描
