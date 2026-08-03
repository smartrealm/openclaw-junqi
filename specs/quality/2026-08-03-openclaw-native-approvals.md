# OpenClaw 原生审批规格

## 问题

JunQi 需要在桌面活动中心处理 OpenClaw Gateway 已经创建的 exec/plugin pending approval，
同时保持 JunQi 只是 OpenClaw 客户端，不自行产生审批或执行未经 Gateway 确认的动作。

## 约束

- 以 OpenClaw 当前官方 protocol、schema、scope 文档和 handler 为准；安装版本只用于复现。
- 只能调用 `exec.approval.list`、`exec.approval.resolve`、`plugin.approval.list` 和
  `plugin.approval.resolve`；不得猜测 request、policy、wait 或 event 字段。
- 管理员临时连接使用既有 `operator.admin` 出口；不得把 `operator.approvals` 加入日常连接。
- list 返回的 envelope、时间戳、请求字段和 `allowedDecisions` 必须严格校验。未知能力只能
  真实尝试，明确缺失的方法不能调用；错误不能转成空队列或成功。
- resolve 的 decision 必须由 Gateway 返回的 `allowedDecisions` 明确允许，且只在
  `ok: true` 后刷新队列。
- UI 只展示 Gateway 返回的命令、插件描述、目标和时间；不展示命令环境值，不执行本地命令，
  不写本地审批账本。
- Chat transcript decision block 与 OpenClaw formal approval 是两个协议，不能互相改名。

## 验收条件

1. 已连接 Gateway 时，活动中心能通过管理员临时通道读取 exec 与 plugin pending list。
2. `hello-ok.features.methods` 明确缺少某一 family 时，该 family 标记 unavailable 且不发 RPC；
   方法列表未知时发起真实 RPC；method-not-found 只标记该 family unavailable。
3. malformed list envelope、非法时间戳、非法决策值或非对象 request 导致明确错误，不显示伪造
   的审批。
4. resolve 使用对应 family 的官方方法和 `{ id, decision }` 参数；Gateway 未返回 `ok: true`
   时不显示成功。
5. UI 有断线、加载、错误、协议不可用、空队列、过期和按 Gateway 实际允许决策呈现的按钮状态。
6. 轮询只作为桌面 list 快照刷新，不声称已经接入 OpenClaw approval event stream。
7. 日常 Gateway scope、Chat transcript review 语义、现有 Gateway 错误和权限边界保持不变。

## 不在范围内

- `exec.approval.request/get/waitDecision` 和 `plugin.approval.request/waitDecision`。
- `exec.approvals.get/set` 或任何本地策略文件修改。
- approval event 长连接路由、跨窗口共享审批 store、插件自定义 command action。
- JunQi 本地审批、自动审批、命令执行、超时重实现或平台专属安全策略。
