# OpenClaw 原生任务账本对齐规格

## 目标

让 JunQi 活动中心以 OpenClaw Gateway 当前官方 `tasks.list`、`tasks.get` 和
`tasks.cancel` 协议查看、检查和取消后台任务，同时保持 JunQi 仅是客户端。

## 约束

- 只以当前 OpenClaw 官方 protocol、schema、handler 和 scope 文档为准；安装版本仅用于复现。
- `tasks.list`、`tasks.get` 必须使用日常 `operator.read` 连接；`tasks.cancel` 必须使用日常
  `operator.write` 连接，不得提升为 `operator.admin`。
- `TaskSummary` 必须完整投影官方已知字段：身份、状态、可选归属、时间、工具统计、摘要、错误和
  lookup-only prompt。未知扩展字段不得进入 JunQi 领域模型。
- 字符串、时间、计数、状态、分页和取消结果按官方 schema 解码；不得 trim、截断或补造字段。
- `hello-ok.features.methods` 的遗漏不阻止 task RPC；method-not-found 显示 unavailable，其他错误
  不得被伪装为 empty 或 success。
- task ledger 与 JunQi 本地 Task checkpoint、协作 workflow graph、Chat transcript 独立展示和存储。
- UI 只在 Gateway 已返回 `queued` 或 `running` 时提供取消；取消后必须等 `found` 与 `cancelled`
  明确为 true 才刷新。

## 验收条件

1. 活动中心能加载官方 task list，并区分 loading、offline、unavailable、empty、error 和分页。
2. 列表显示 Gateway 返回的 title、状态、agent、session、运行时、时间和官方摘要，不从本地任务补值。
3. 用户展开一项时仅调用 `tasks.get`，并展示 Gateway 返回的 detail/prompt；不自动批量读取 prompt。
4. 仅 queued/running 项有取消操作；Gateway 未确认取消时不显示已取消。
5. 正常取消不创建管理员临时连接，日常 Gateway scopes 保持 read/write。
6. 任务 decoder 覆盖官方 tool 统计与 prompt，拒绝非法状态、负数/小数 timestamp、负数 tool count 和
   malformed result。
7. 断开连接、请求重叠和延迟结果不能覆盖当前 Gateway 状态。
8. 三种 locale 完整，文档、spec 和 plan 同步，并明确没有接入 task event stream。

## 不在范围内

- 创建、调度、恢复、重试、批量操作、Cron status/runs 和自定义 task graph。
- 对 tool 副作用或 task lifecycle 的本地推断、自动补偿和伪造终态。
- 真实 Gateway 和各目标桌面平台的手工验收。
