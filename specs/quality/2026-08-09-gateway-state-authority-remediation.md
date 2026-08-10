# Gateway 状态权威边界整改规格

日期：2026-08-09

## 目标

删除内部状态别名和子智能体运行猜测，使进程状态与会话运行状态都只来自当前明确契约。

## 状态机事件

1. `STATUS_RECEIVED` 必须包含 `processAlive`、`endpointReady`、`error` 和 `retrying`。
2. 状态机不得读取 `running` 或用进程存活代替端点就绪。
3. Rust 进程观察结果可以包含其原始 `running` 字段，但进入状态机前必须完成唯一投影。

## 子智能体活动

1. `hasActiveRun` 为当前会话是否存在活动运行的首选权威字段。
2. 仅当其缺失时，允许读取 OpenClaw 正式会话行中的 `hasActiveSubagentRun`。
3. 两者都缺失时返回非活动。
4. 不读取状态文案、布尔 `running`、开始时间、更新时间或最后活动时间来猜测运行状态。

## 验收

- 全仓 `STATUS_RECEIVED` 调用使用唯一字段组。
- 状态机测试不再构造 `running` 别名。
- 最近更新时间不能使缺少活动字段的子智能体显示为运行。
- OpenClaw 明确返回 true 或 false 时保持原值。
