# OpenClaw 聊天任务边界审计

## 结论

2026-08-10 对最新 OpenClaw 的 `tasks.*` schema 和 handler 复核后确认：Task Ledger 不是普通聊天发送的通用任务协议。JunQi 现有 `src/task-execution/` 为聊天发送自行创建 Task、Run、Node、Edge 和工具恢复状态，超出了 OpenClaw 客户端的职责边界。

## 证据

- `packages/gateway-protocol/src/schema/tasks.ts` 的注释和 schema 将 Ledger Task 限定为 Gateway 暴露的长运行 SDK 或 Agent 操作。
- `src/gateway/server-methods/tasks.ts` 从 `tasks/runtime-internal` 映射任务注册表；`tasks.cancel` 调用原生 detached task 取消；`tasks.retry` 与 `tasks.dismiss` 仅处理子智能体完成投递。
- JunQi 已有 `OpenClawTaskLedgerClient` 与 `OpenClawTaskLedgerPanel`，它们直接使用官方 `tasks.*`，无需任何聊天本地 Task 适配。
- 普通会话 Stop 已有 `OpenClawSessionAbortClient`，其官方回执只允许 `aborted` 和 `no-active-run`，足以保留未知或已中止的真实语义。

## 处理范围

删除已覆盖 `src/task-execution/`、聊天恢复横幅、发送协调器、队列排空、Gateway Stop 包装、工具流记录和对应专属测试、文案与当前文档索引。已有原生 Task Ledger 面板未改动。

## 未验证边界

本轮可通过协议和单元测试验证客户端不会伪造聊天 Task。真实 Gateway 与 Tauri 中的 Stop、工具流迟到事件及断线后转录收敛仍需分别进行窗口级验收。
