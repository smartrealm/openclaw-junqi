# OpenClaw 会话操作事件对齐计划

日期：2026-08-03

## 实施顺序

1. 对照 OpenClaw 当前官方 protocol、session schema、compact handler 和广播实现，确认事件字段与订阅来源。
2. 在 Gateway ChatHandler 边界新增严格 decoder 和临时状态投影。
3. 将合法事件投影为按会话隔离的临时运行态，不修改 transcript 或创建本地聊天消息。
4. 补充解码器、事件路由和未报告终态的回归测试。
5. 更新历史分析、规格、验证边界和索引，执行 TypeScript、测试、构建与差异检查。

## 复审补充

对完全相同的官方 `session.operation` 重放在 ChatHandler 边界做有界去重，覆盖临时
状态和分隔线投影；不得按 operationId 单独去重，以免抑制同一操作的
合法 start/end 阶段。

## 文件范围

- `src/services/gateway/sessionOperation.ts`
- `src/services/gateway/sessionOperation.test.ts`
- `src/services/gateway/ChatHandler.ts`
- `src/services/gateway/ChatHandler.test.ts`
- 对应 docs/specs 索引和历史审计说明

## 不做的事情

- 不新增 `sessions.compact` 触发入口。
- 不把 session operation 写成 OpenClaw transcript 或本地聊天消息。
- 不在日常连接中增加 `operator.approvals`，也不实现没有官方授权依据的审批状态。
