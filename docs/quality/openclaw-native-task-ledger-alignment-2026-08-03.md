# OpenClaw 原生任务账本审计

日期：2026-08-03

## 依据

本次以 OpenClaw 当前官方协议、schema 和 handler 为唯一功能契约。本机安装版本只用于
复现，不能作为能力开关或字段来源。

- [`gateway/protocol.md`](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
  定义 `tasks.list`、`tasks.get`、`tasks.cancel` 的 operator 权限、参数和结果语义。
- [`tasks.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/packages/gateway-protocol/src/schema/tasks.ts)
  定义完整 `TaskSummary`、分页、取消和状态枚举 schema。
- [`server-methods/tasks.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/src/gateway/server-methods/tasks.ts)
  说明 Gateway 按最近活动分页、`tasks.get` 才返回 prompt、以及取消结果由 Gateway 记录。

OpenClaw 任务账本是 Gateway 暴露的后台 SDK/Agent 操作记录。它不是 JunQi 的本地
ReAct checkpoint、协作插件的 workflow graph，也不是 Chat transcript 的替代品。

## 问题分级

### BUG-TASK-01 高：取消请求错误提升到 operator.admin

位置：`src/services/gateway/index.ts`、`src/services/gateway/OpenClawTaskLedgerClient.ts`

当前 `tasks.cancel` 经 `requestPrivileged` 发出，导致一个只具备日常 `operator.write`
权限的已连接客户端仍会新建管理员临时连接。官方协议明确规定 `tasks.cancel` 只需要
`operator.write`；`tasks.list` 和 `tasks.get` 只需要 `operator.read`。

影响：取消操作引入不必要的管理员配对、延迟和失败面，也违反最小权限边界。

修复：三个 task RPC 都使用当前已认证的日常 Gateway 连接；取消不再触发管理员临时连接。

### BUG-TASK-02 高：摘要解码偏离官方 TaskSummary schema

位置：`src/services/gateway/OpenClawTaskLedgerClient.ts`

当前 decoder 截断并 trim 官方任意字符串，遗漏 `toolUseCount`、`lastToolName` 和 lookup-only
`prompt`，并把 timestamp 宽松解析为任意有限数字。官方 schema 要求 timestamp 为字符串或
非负整数，字符串字段不包含 JunQi 私自定义的长度或 trim 契约。

影响：客户端可能丢失 Gateway 已返回的任务信息，或接受不符合官方 schema 的负数、小数时间。

修复：按当前 schema 严格解码已知字段，保留官方字符串原值，校验非负整数，并仅投影
官方公开字段。

### BUG-TASK-03 高：原生账本没有桌面产品入口

位置：`src/services/gateway/index.ts`

`listTasks`、`getTask`、`cancelTask` 已存在于 service facade，但没有 store、页面或组件使用它们。
用户只能看到 JunQi 本地工作台任务和会话活动，无法检查或取消 Gateway 已公开的后台任务。

影响：Gateway 原生能力处于不可见状态，且本地 Task 和 Gateway task 的边界无法在 UI 中表达。

修复：在活动中心增加独立的 Gateway task ledger 面板，显示官方 list summary、按任务 id 获取
官方 detail，并只对 `queued`、`running` 项提供原生取消入口。

### BUG-TASK-04 中：能力缺失被泛化成普通请求失败

位置：`src/services/gateway/OpenClawTaskLedgerClient.ts`

当前 adapter 不读取 `hello-ok.features.methods`，Gateway 明确未广告或返回 method-not-found 时，
UI 无法区分“不支持”和临时错误。

修复：使用已有 capability advertisement；明确未广告时不调用 RPC，未知时只真实尝试一次，
method-not-found 映射为 unavailable，认证、网络和响应错误保持错误。

## 目标行为

- 日常连接以 `operator.read` 查询，以 `operator.write` 取消，不扩大为 `operator.admin`。
- 任务列表、详情与取消只使用官方 `tasks.*` 协议，动态尊重 Gateway 能力广告。
- 活动中心将 Gateway task ledger 独立呈现，不并入 JunQi 本地任务、Chat transcript 或协作图。
- 详情仅展示 `tasks.get` 返回的官方 prompt 和摘要字段；不从其他数据源补全。
- 取消只在 Gateway 返回 `found: true` 且 `cancelled: true` 后刷新；任何否定结果和错误都明确呈现。
- Gateway 没有被本次官方证据证明的 task event payload，因此使用受限桌面轮询，不声称实时订阅。

## 未纳入本轮

- JunQi 自行创建、重试、恢复、编排或持久化 Gateway background task。
- 以本地 checkpoint、协作 workflow 或 Chat transcript 合成 task ledger 条目。
- 自动取消、批量取消、取消 reason 伪造或对副作用任务的自动补偿。
- 未取得当前官方字段证据的任务事件订阅或后台调度扩展。Cron run history 与 `cron.status` 已在各自的
  原生对齐审计中取得字段证据并单独实现。

## 验证边界

自动化验证覆盖 adapter 字段、权限出口、能力缺失、分页、取消确认和 store 竞态。尚未在真实
Gateway，以及 Windows、macOS、CentOS、Ubuntu 真机上验证后台任务创建、取消竞态和长时间轮询。

## 验证结果

2026-08-03 已通过以下自动化验证：

- `node --import ./test-setup.ts --import tsx --test src/services/gateway/OpenClawTaskLedgerClient.test.ts src/stores/openclawTaskLedgerStore.test.ts`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm verify:openclaw-docs`，校验 55 条官方 OpenClaw 链接和锚点
- `git diff --check`

上述结果不表示已经完成真实 Gateway、Windows、macOS、CentOS 或 Ubuntu 的手工验证。
