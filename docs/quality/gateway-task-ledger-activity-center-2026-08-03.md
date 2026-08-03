# Gateway Task Ledger 与活动中心

日期：2026-08-03

## 依据

- 当前安装的 OpenClaw `2026.7.1-2` `docs/gateway/protocol.md` 与 `docs/cli/tasks.md`。
- `tasks.list` 是 Gateway 后台任务账本的只读摘要接口，要求 `operator.read`；`tasks.get` 按任务 ID 返回权威 `TaskSummary`，同样要求 `operator.read`；`tasks.cancel` 要求 `operator.write`，返回 `found`、`cancelled` 和可选任务快照。
- Task Summary 的状态来自当前协议：`queued`、`running`、`completed`、`failed`、`cancelled`、`timed_out`。JunQi 不把 CLI 文档中的 `succeeded`、`lost` 直接写入 RPC 联合类型。

## 当前行为

JunQi 活动中心只聚合聊天会话和本地 AI 工作台任务。原生 OpenClaw 的后台任务账本没有可见入口，聊天 `/tasks` 也不会返回真实任务列表。

## 目标行为

- 活动中心单独展示 Gateway task ledger 摘要，与本地工作台任务保持不同数据源和状态模型。
- 只读读取最多 100 条任务摘要，按 Gateway 更新时间排序，显示 Agent、runtime、状态、进度和错误摘要。
- `queued`、`running` 任务提供取消动作；取消使用 `operator.write` 请求，并只有 Gateway 返回 `cancelled: true` 后才更新界面。
- 每条任务提供详情展开入口；详情使用 `tasks.get`，失败只影响当前任务详情区。
- malformed response、缺少权限、旧 Gateway 或断线时保留已加载摘要并显示不可用状态，不静默伪造空列表或成功取消。

## 验证结果

- `src/services/gateway/taskLedger.test.ts` 覆盖状态/时间戳解码、过滤参数、详情 envelope、取消结果和缺失 task id。
- 详情实现和验证记录见 [`Gateway Task Ledger 详情对齐`](task-ledger-details-2026-08-03.md)。

## 未验证边界

- 尚未在真实 Gateway 上执行 `tasks.list` 或 `tasks.cancel`，未验证当前用户凭据的 operator scope。
- 尚未验证 ACP、subagent、cron 和 CLI 任务的显示差异，也未接入 `tasks.audit`、`tasks.maintenance` 或 Task Flow。
- 尚未完成亮色、暗色、窄窗口和取消竞态的人工视觉验收。
