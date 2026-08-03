# OpenClaw Cron 日历投影规格

## 目标

使 JunQi 日历忠实呈现 OpenClaw Gateway `cron.list` 已返回的下一次任务执行时间。

## 约束

- 只使用官方 `CronJobSchema` 与 `cron.list` handler 已证明的 `nextRunAtMs`、`state.nextRunAtMs` 与 `lastRunStatus` 字段。
- 禁止从 cron expression、历史运行或客户端时钟推断后续调度实例。
- 禁止把 `cron.status`、未验证事件或本地状态伪装为 Gateway 调度器结果。
- 同一任务的顶层 read-view 时间优先于嵌套 state 时间。
- 仅启用且未来的任务可出现在日历条；月视图只标记 Gateway 当前明确的下一次执行日期。

## 验收条件

1. 顶层与嵌套官方 `nextRunAtMs` 都可被读取，且顶层优先。
2. 禁用、已过期、缺失或非法下一次执行时间不会显示为即将执行。
3. 日历条按下一次执行时间升序显示有限条目，并保留 Gateway 的最近运行状态作为颜色语义。
4. 月视图使用同一投影，只对明确的下一次执行日作标记。
5. 回归测试覆盖上述字段优先级、过滤、排序和日期投影。

## 不在范围内

- `cron.status` result UI、Cron expression 解析、运行事件字段投影。
- 真实 Gateway 和目标桌面平台人工验收。
