# OpenClaw Cron 运行记录分页规格

## 上游契约

`cron.runs` 使用 `scope=all` 或 `scope=job`。任务作用域必须带 id；全局作用域不带任务 id，但两种作用域都可使用 `runId` 过滤。响应必须包含 `entries`、`total`、`offset`、`limit`、`hasMore` 和 `nextOffset`。

## JunQi 行为

1. 对 job 作用域发送 id；对 all 作用域不发送 id。两种作用域都可按官方 schema 发送 runId。
2. 仅透传已在 OpenClaw schema 中定义的分页、状态、投递、Agent、查询和排序字段。
3. `limit` 必须在 1 到 200，`offset` 必须为非负整数；非法调用本地拒绝，不能改写为其他值。
4. 响应条目数不得超过 limit；offset、total、hasMore 和 nextOffset 必须满足官方分页关系。
5. 最近运行记录请求 `scope=all`、`limit=30`、`sortDir=desc`；单任务记录请求 `scope=job`。

## 验收条件

- 全局、任务和精确 runId 三种请求生成正确官方信封。
- 非法作用域、越界分页、冲突字段和畸形分页响应均失败关闭。
- Cron 监控页不再包含按前 12 个任务或每任务 5 条记录截断的读取路径。
- 手动执行只接受同一任务、同一 runId 的终态记录。
