# OpenClaw Cron 运行记录分页审计

## 审计范围

本次审计覆盖 Cron 运行记录从 Gateway `cron.runs` 到 JunQi Gateway 客户端和监控页的读取链路。

## 官方依据

- 最新 OpenClaw `CronRunsParamsSchema` 支持 `scope`、`id`、`runId`、`limit`、`offset`、运行状态、投递状态、查询文本和排序方向；`runId` 是全局或单任务读取都可使用的筛选条件。
- `cron.runs` handler 在 `scope=all` 时一次从 Gateway 任务记录读取全局历史，并按请求的 `agentId` 过滤；在 `scope=job` 时读取指定任务历史。
- 运行记录响应是分页对象，包含 `entries`、`total`、`offset`、`limit`、`hasMore` 和 `nextOffset`。读取服务会把偏移限制到合法范围，并令 `nextOffset` 等于当前偏移加本页条目数。

## 发现的问题

- JunQi 原先只允许 job 作用域，请求层丢弃了全局运行记录、筛选条件、分页偏移和响应分页元数据。
- 监控页原先逐任务请求，最多读取前 12 个任务且每个任务最多保留 5 条记录。该本地截断不等价于官方全局最近运行记录。
- 原有响应解析仅校验字段类型，没有校验 `total`、`offset`、条目数、`hasMore` 与 `nextOffset` 的相互关系。

## 目标行为

1. Gateway 客户端完整表达已使用的官方 `cron.runs` 请求参数，拒绝无效作用域、越界分页和不合法筛选值。
2. 分页响应保留并校验所有官方元数据；不一致响应失败关闭。
3. 监控页的最近运行记录使用一次 `scope=all` 官方读取，按界面容量请求最近 30 条，不再按本地任务数切片。
4. 单任务详情继续使用 `scope=job` 与任务 id；手动执行轮询按精确 `runId` 读取一条记录。

## 未验证边界

- 尚未在真实 Gateway 上验证超过 30 条全局运行记录、按 Agent 过滤和各类状态筛选的桌面视觉表现。
- 本次不增加 OpenClaw 未定义的运行记录缓存、重放或终态推断；超时仍保留待核验语义。
