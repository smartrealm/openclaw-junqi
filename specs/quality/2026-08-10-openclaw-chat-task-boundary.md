# OpenClaw 聊天任务边界收敛

## 上游依据

- 最新 OpenClaw `packages/gateway-protocol/src/schema/tasks.ts` 将 Task Ledger 定义为 Gateway 暴露的长运行 SDK 或 Agent 操作，状态、详情、取消和完成投递均由 `tasks.*` 协议负责。
- `src/gateway/server-methods/tasks.ts` 只从上游任务注册表读取和控制该类记录；普通 `chat.send` 不会因此取得一个 Ledger Task。
- 普通会话中断的官方控制面为 `sessions.abort`。JunQi 已有严格的 `OpenClawSessionAbortClient`，只解析官方 `aborted` 或 `no-active-run` 回执。

## 当前问题

`src/task-execution/` 曾为每次普通聊天发送、steer 与工具流创建并持久化 JunQi 自有的 Task、Run、Node、Edge、终态和恢复语义，并通过恢复横幅展示。这一模型不属于 OpenClaw Task Ledger，且包含历史迁移路径，越过了客户端边界。

## 目标行为

- 普通聊天发送、steer、Stop、工具流和历史重连只投影 OpenClaw 已返回的发送回执、会话流事件、转录和 `sessions.abort` 回执。
- 普通聊天不得创建、持久化、迁移或展示 JunQi 自有任务图、Run、工具恢复状态或合成终态。
- 活动页的原生 Task Ledger 保持独立，只呈现和操作 OpenClaw `tasks.*` 返回的记录；不将普通聊天发送伪装为 Task Ledger 条目。
- Stop 只请求官方 `sessions.abort`，不清空会话、转录或官方队列，也不由本地状态断言远端工具已取消或已完成。

## 验收条件

- 全仓库生产代码不存在 `src/task-execution/`、`TaskExecutionCoordinator`、`TaskExecutionRecoveryBanner` 或本地任务图持久化入口。
- `ChatSendCoordinator` 的首发、失败、未知投递、原生队列和 steer 仍通过 Gateway 回执保持真实状态。
- `gateway.abortChat` 仍先校验会话目标，随后只请求官方 `sessions.abort` 并解析其结构化回执。
- 工具卡仍只由 Gateway 流事件驱动；历史或 Stop 后未知工具状态不得被 JunQi 合成为 Tool Result、完成或回滚。
- 原生 Task Ledger 客户端与面板的既有测试继续通过。
