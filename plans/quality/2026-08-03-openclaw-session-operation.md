# OpenClaw 会话操作事件对齐计划

日期：2026-08-03

## 实施顺序

1. 对照 OpenClaw 当前官方 protocol、session schema、compact handler 和广播实现，确认事件字段与订阅来源。
2. 在 Gateway ChatHandler 边界新增严格 decoder 和 typed callback。
3. 在主窗口与 Quick Chat 将合法事件投影为本地 session event，不修改 transcript。
4. 补充解码器、事件路由和未报告终态的回归测试，更新三种语言文案。
5. 更新历史分析、规格、验证边界和索引，执行 TypeScript、测试、构建与差异检查。

## 文件范围

- `src/services/gateway/sessionOperation.ts`
- `src/services/gateway/sessionOperation.test.ts`
- `src/services/gateway/ChatHandler.ts`
- `src/services/gateway/ChatHandler.test.ts`
- `src/services/gateway/Connection.ts`
- `src/App.tsx`
- `src/pages/QuickChatRoot.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 对应 docs/specs 索引和历史审计说明

## 不做的事情

- 不新增 `sessions.compact` 触发入口。
- 不把本地 session event 写成 OpenClaw transcript 消息。
- 不在日常连接中增加 `operator.approvals`，也不实现没有官方授权依据的审批状态。
