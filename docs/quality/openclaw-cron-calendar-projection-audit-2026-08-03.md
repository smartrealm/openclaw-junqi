# OpenClaw Cron 日历投影审计

日期：2026-08-03

## 依据

- OpenClaw 官方 [`cron.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/packages/gateway-protocol/src/schema/cron.ts) 定义 `CronJobSchema.state.nextRunAtMs`，以及 `cron.list` 返回任务可带的顶层 `nextRunAtMs` 和 `lastRunStatus`。
- OpenClaw 官方 [`server-methods/cron.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/src/gateway/server-methods/cron.ts) 中 `cronJobReadView` 将调度器维护的 `state.nextRunAtMs` 投影为顶层 `nextRunAtMs`；`cron.list` 的默认 full response 使用此 read view。
- OpenClaw 官方 [`cron-jobs.md`](https://docs.openclaw.ai/automation/cron-jobs) 将 Cron 定义为 Gateway 内置调度器，任务运行状态由 Gateway 持久化与维护。

本轮日历投影不使用 `cron.status`，也不以本地状态替代 Gateway 调度器状态。后续审计已从官方
Cron service source 取得其结果模型，并在独立的调度器状态对齐中处理。

## 当前行为

`CronStrip` 声称展示即将执行的 Cron，却从 `lastRun` 创建列表；`MonthView` 也把 `lastRun` 的日期标记为“Cron scheduled”。当前 Gateway full list response 提供的是 `nextRunAtMs` 与 `lastRunAtMs`，并没有这两个视图依赖的 `lastRun` 字段。

影响：真实 Gateway 数据可能完全不显示任务；即使遗留字段恰好存在，也会把已经执行过的日期当作未来计划，造成错误操作认知。

## 问题分级

### BUG-CRON-CALENDAR-01 高：即将执行视图读取上次执行字段

位置：`src/pages/Calendar/CronStrip.tsx`、`src/pages/Calendar/MonthView.tsx`。

修复：建立纯投影，按官方顶层 `nextRunAtMs` 优先、嵌套 `state.nextRunAtMs` 次之读取。日历条只显示启用且尚未到期的最近任务；月视图仅在 Gateway 已明确给出的下一次执行日期标记任务。

## 目标行为

- JunQi 仅呈现 OpenClaw 已返回的下一次执行时间，不解析 cron 表达式或自行生成未来运行。
- 顶层读模型字段优先，嵌套调度器字段作为同一官方模型的兼容投影。
- 过去时间、禁用任务和缺失或非法时间戳不得进入“即将执行”视图。
- 日历条与月视图复用同一纯投影规则并有行为回归测试。

## 未纳入本轮

- 运行中状态、事件 payload 的本地投影。
- cron 表达式的客户端解析、重复任务的多次未来实例推断。
- Cron 创建、更新、运行、取消或调度器服务开关。
- 真实 Gateway 及 Windows、macOS、CentOS、Ubuntu 桌面真机验收。
