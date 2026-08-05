# OpenClaw 原生会话中止对齐计划

日期：2026-08-03

## 实施顺序

1. 核对官方 `sessions.abort` schema、handler、方法权限和 `clearQueued` 语义。
2. 新增严格的 `OpenClawSessionAbortClient` 和 native response classifier。
3. 将 `gateway.abortChat` 与 `ChatHandler` 切换到 `sessions.abort`，保留精确 Run
   结算和未知状态 reconciliation。
4. 补充请求、响应、队列保留、Run 错配和工具核验回归测试，更新审计、规格和索引。
5. 执行 TypeScript、定向测试、lint、官方链接、构建和差异检查，并提交中文 commit。

## 文件范围

- `src/services/gateway/OpenClawSessionAbortClient.ts`
- `src/services/gateway/OpenClawSessionAbortClient.test.ts`
- `src/services/gateway/OpenClawChatRunProjection.ts`
- `src/services/gateway/OpenClawChatRunProjection.test.ts`
- `src/services/gateway/ChatHandler.ts`
- `src/services/gateway/ChatHandler.test.ts`
- `src/services/gateway/index.ts`
- 对应 `docs/`、`specs/`、`plans/` 索引和 ReAct 审计记录

## 不做的事情

- 不在 JunQi 侧重实现 OpenClaw 的 abort lifecycle、队列、transcript 或工具回滚。
- 不默认清空 Gateway 队列，不把本地 Stop 变成会话删除、重置或新 session。
- 不把网络超时、空响应或 UI 事件当作远端中止确认。
