# OpenClaw 任务账本唯一链路收敛

## 依据

- 当前本地官方源码 `/Users/wei/DevTool/project/mine/gui/Openclaw/packages/gateway-protocol/src/schema/tasks.ts` 定义稳定 `TaskSummary`、`tasks.retry` 与 `tasks.dismiss` 的封闭请求和结果 schema。
- 当前本地官方源码 `/Users/wei/DevTool/project/mine/gui/Openclaw/src/gateway/methods/core-descriptors.ts` 证明 `tasks.retry` 与 `tasks.dismiss` 是 `operator.write` 的 `2026.7` 增量能力。
- 当前本地官方源码 `/Users/wei/DevTool/project/mine/gui/Openclaw/src/gateway/server-methods/tasks.ts` 与 `src/agents/subagent-completion-delivery.ts` 证明恢复操作只重投递已保留的子智能体完成结果，不重新执行子智能体任务；可能存在重复可见结果风险。

## 目标行为

1. 活动中心只渲染一个 OpenClaw 原生任务账本面板。
2. `tasks.list` 和 `tasks.cancel` 仅接受当前稳定 `TaskSummary` 字段；未知字段必须拒绝。
3. `toolUseCount`、`lastToolName`、`deliveryStatus` 与 `terminalOutcome` 按当前稳定 schema 投影；`prompt` 与 `result` 仅在 `tasks.get` 和官方恢复结果快照中允许。
4. 仅当 `deliveryStatus=failed` 且 `terminalOutcome=blocked` 时呈现完成投递重试和确认不投递入口；重试必须显示官方已声明的重复结果风险。
5. 所有读取、分页、详情、取消、恢复和 unavailable 状态只经 `OpenClawTaskLedgerClient`、Gateway facade 与 `openclawTaskLedgerStore`，并绑定经认证的 Gateway 连接身份。
6. JunQi 本地 Task checkpoint、工作区任务和协作图不与 Gateway task ledger 合并。

## 未验证边界

官方 `docs/gateway/protocol.md` 的任务账本章节尚未列出 `2026.7` 新增恢复 RPC 与全部摘要字段；本次按同一官方工作树中可复现的 schema、方法注册和 handler 为准。真实 Gateway 的任务列表、取消、恢复及 macOS、Windows、CentOS、Ubuntu 视觉验收仍待执行。
