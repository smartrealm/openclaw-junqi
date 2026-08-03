# OpenClaw 原生审批规格

## 问题

JunQi 需要在桌面活动中心处理 OpenClaw Gateway 已经创建的 exec/plugin pending approval，
同时保持 JunQi 只是 OpenClaw 客户端，不自行产生审批或执行未经 Gateway 确认的动作。

## 约束

- 以 OpenClaw 当前官方 protocol、schema、scope 文档和 handler 为准；安装版本只用于复现。
- pending 兼容路径只能调用 `exec.approval.list`、`exec.approval.resolve`、
  `plugin.approval.list` 和 `plugin.approval.resolve`；当前统一路径调用官方
  `approval.history`、`approval.get` 或 `approval.resolve`，不得猜测 request、policy、wait
  或 event 字段。
- 审批 transient 连接只使用 `operator.approvals`；不得把 `operator.approvals` 或
  `operator.admin` 加入日常连接，也不得以 admin fallback 绕过审批 visibility。
- list 返回的 envelope、时间戳、请求字段和 `allowedDecisions` 必须严格校验。发现列表遗漏时仍真实
  尝试；仅 Gateway 实际未知方法归类为不可用，其他错误不能转成空队列或成功。
- resolve 的 decision 必须由 Gateway 返回的 `allowedDecisions` 明确允许，且只在
  `ok: true` 后刷新队列。
- UI 只展示 Gateway 返回的命令、插件描述、目标和时间；不展示命令环境值，不执行本地命令，
  不写本地审批账本。
- 统一 history 只展示官方脱敏 `ApprovalSnapshot.presentation` 和 terminal 元数据；
  `system-agent` 只能使用 Gateway 返回的 `allow-once`、`deny` 决策。
- Chat transcript decision block 与 OpenClaw formal approval 是两个协议，不能互相改名。

## 验收条件

1. 已连接 Gateway 时，活动中心能通过 approvals-only 临时通道读取当前身份可见的 exec 与
   plugin pending list。
2. `hello-ok.features.methods` 的遗漏不阻止某一 family 的真实 RPC；method-not-found 才只标记该
   family unavailable。
3. malformed list envelope、非法时间戳、非法决策值或非对象 request 导致明确错误，不显示伪造
   的审批。
4. resolve 使用对应 family 的官方方法和 `{ id, decision }` 参数；Gateway 未返回 `ok: true`
   时不显示成功。
5. UI 有断线、加载、错误、协议不可用、空队列、过期和按 Gateway 实际允许决策呈现的按钮状态。
6. 轮询只作为桌面 list 快照刷新，不声称已经接入 OpenClaw approval event stream。
7. 活动中心能严格呈现官方 terminal history，并按官方 `nextCursor` 分页；Gateway 实际返回未知方法时显示 unavailable。
8. 客户端只接受官方单条 `ApprovalSnapshot`；Gateway 实际返回未知方法时返回 unavailable，不把旧 pending envelope 当作统一 snapshot。
9. 请求使用 `{ id, kind, decision }`，且只有官方 `applied` 与 terminal snapshot 才能更新状态；Gateway 实际返回未知方法时才走旧 family resolve。
10. 日常 Gateway scope、Chat transcript review 语义、现有 Gateway 错误和权限边界保持不变。

## 不在范围内

- `exec.approval.request/get/waitDecision` 和 `plugin.approval.request/waitDecision`。
- `exec.approvals.get/set` 或任何本地策略文件修改。
- approval event 长连接路由（包括 `sessions.messages.subscribe({ includeApprovals: true })`）、
  跨窗口共享审批 store、插件自定义 command action。
- JunQi 本地审批、自动审批、命令执行、超时重实现或平台专属安全策略。
