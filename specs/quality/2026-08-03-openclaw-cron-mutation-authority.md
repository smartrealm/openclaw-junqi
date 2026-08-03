# OpenClaw Cron 写操作授权与日历一致性规格

日期：2026-08-03

## BUG-CRON-MUTATION-01

### 当前行为

CronMonitor 和 Calendar 通过日常 Gateway 连接调用 `cron.add`、`cron.update`、`cron.remove`。该连接默认请求 `operator.read` 与 `operator.write`，与官方 Cron mutation 的 `operator.admin` 要求不一致。

### 目标行为

1. 新增 Cron management client，输入限制为 JunQi 当前使用的 agent-turn 创建参数与 `enabled`、`agentId` 更新 patch。
2. 所有 JunQi Cron mutation 调用都经由现有一次性 `operator.admin` requester。
3. client 使用官方 canonical `id` 参数，不依赖 legacy `jobId` 写入别名。
4. `cron.add` 仅在直返 job 或 declaration-key 收敛结果都包含非空 job id 时返回成功；`cron.update` 仅在返回非空 job id 时成功；`cron.remove` 仅在 `{ ok: true, removed: true }` 时成功。
5. 能力广告明确不存在或 authoritative method-not-found 映射为 unsupported；权限、校验和传输错误不得改写为成功或不支持。

### 验收条件

- [ ] 创建、启停、Agent 路由、日历创建和日历删除均不再调用普通 `gateway.call('cron.*')`。
- [ ] 管理 client 的行为测试断言 canonical 方法、参数、成功响应、无效响应、能力缺失与 method-not-found。
- [ ] 调用方可以接收真实授权或 Gateway 错误；CronMonitor 启停失败有可见状态。
- [ ] CronMonitor 可以在明确确认后删除任务；远端成功而列表读回失败时不伪装为未删除或可安全重试。

## BUG-CRON-MUTATION-02

### 当前行为

日历更新或删除本地事件时，即使旧 Cron job 没有被 Gateway 确认删除，仍会覆盖或删除本地记录。

### 目标行为

1. Calendar 只在远端删除被 management client 确认后才移除已存储的 reminder job id。
2. 更新一个已计划提醒时，先删除并确认旧任务，再持久化本地事件变化；删除失败保留原事件、原关联和错误状态。
3. 成功删除旧任务后，若新任务创建失败，更新后的本地事件标记为 `pending`，而不是 `scheduled`。
4. 删除事件时，远端删除失败不清除本地事件。
5. recurrence、全天、结束时间、地点、备注和投递频道变化与标题、日期、时间、提醒间隔一样触发 reminder 替换。
6. 全天或没有开始时间的事件不创建 Cron reminder，状态必须是 `none`。

### 验收条件

- [ ] 远端删除失败时，事件和原 `reminderCronJobId` 都保留。
- [ ] 提醒更新不会在旧任务仍未确认删除时创建替代任务。
- [ ] 成功删除后新建失败时，事件记录为 `pending` 且不保留已删除 job id。
- [ ] 全天或无开始时间事件不会显示为无法完成的 `pending`。
- [ ] 相关回归测试可在旧的吞错删除语义下失败。

## 边界

- 官方权限、方法与成功响应必须以官方源码和文档为准；本地安装版本用于确认当前打包兼容性。
- Windows、macOS、CentOS 和 Ubuntu 的真实 Gateway 授权与 Cron 持久化仍须在对应桌面环境验收。
