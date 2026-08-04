# OpenClaw 任务账本唯一链路收敛

## 依据

- 官方 [Task ledger RPC](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md) 定义 `tasks.list`、`tasks.get` 和 `tasks.cancel` 的权限、参数和结果。
- 官方 [Task schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/tasks.ts) 定义稳定 `TaskSummary` 字段及禁止额外摘要字段。
- 官方 [Gateway task handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/tasks.ts) 证明 `tasks.get` 在稳定摘要外额外返回 lookup-only `prompt`。

## 目标行为

1. 活动中心只渲染一个 OpenClaw 原生任务账本面板。
2. `tasks.list` 和 `tasks.cancel` 仅接受稳定 `TaskSummary` 字段；未知字段和已废弃工具统计字段必须拒绝。
3. 仅 `tasks.get` 可投影 handler 已证实的 `prompt`；该字段不得出现在列表或取消快照中。
4. 所有读取、分页、详情、取消和 unavailable 状态只经 `OpenClawTaskLedgerClient`、Gateway facade 与 `openclawTaskLedgerStore`。
5. JunQi 本地 Task checkpoint、工作区任务和协作图不与 Gateway task ledger 合并。

## 未验证边界

真实 Gateway 的 handler 与稳定 protocol schema 对 `prompt` 的差异，以及 macOS、Windows、CentOS、Ubuntu 的任务列表、取消和视觉验收仍待执行。
