# OpenClaw Cron 调度器状态规格

## 目标

在 JunQi CronMonitor 中忠实呈现 OpenClaw Gateway `cron.status` 的只读调度器快照。

## 约束

- 请求必须是官方无参数 `cron.status {}`。
- 响应必须验证 `enabled` boolean、`storage: "sqlite"`、非负安全整数 `jobs`、以及 `nextWakeAtMs` 的非负安全整数或 `null`。
- `storePath` 和 `sqlitePath` 不进入 JunQi UI 模型。
- 明确广告缺失或 Gateway method-not-found 必须表现为不支持；无效结果必须表现为响应错误。
- 未验证的实时事件只可触发权威读取，不能修改快照。

## 验收条件

1. 客户端发送 exact `cron.status` 与空对象，并严格解码官方字段。
2. 页面仅在连接后及显式刷新读取状态，且过期请求不能覆盖较新的状态。
3. enabled/disabled、任务数和 next wake 在页面中可见；读取失败或不支持可见且不伪造状态。
4. 不显示或存储 SQLite 路径。
5. 回归测试覆盖正确解码、能力缺失、method-not-found 和无效响应。

## 不在范围内

- 对 Cron scheduler 的写操作、配置修改或本地替代实现。
- 真实 Gateway 和目标操作系统人工验收。
