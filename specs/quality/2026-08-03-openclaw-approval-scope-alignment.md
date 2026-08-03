# OpenClaw 审批最小权限对齐规格

日期：2026-08-03

## 目标

将 JunQi 对 OpenClaw 审批协议的 transient 访问从泛化管理员权限收窄为官方
`operator.approvals` scope，同时保留管理操作所需的 admin requester 和现有失败关闭行为。

## 约束

1. 日常 Gateway 连接始终只请求 `operator.read`、`operator.write`。
2. `approval.*`、`exec.approval.*`、`plugin.approval.*` 只使用单独的 transient
   `operator.approvals` requester；不得以 admin fallback、localStorage snapshot 或空队列
   掩盖 scope 或授权失败。
3. 其他管理操作仍通过原有 admin requester，不得因本修复被降权或改变其序列化、配对、
   timeout、source fence 和 transient credential 不持久化语义。
4. requester 接受的 scope 集合必须是 `GatewayOperatorScope` 的只读值；空集合不得静默
   转换成开放或 admin 权限。
5. Approval UI 只使用 Gateway 结果。scope 拒绝、device identity 缺失、连接切换、响应
   畸形或 RPC 失败必须传播原始错误语义。
6. approval event 的接入以
   [`2026-08-04 审批界面与事件收敛规格`](2026-08-04-openclaw-approval-surface-convergence.md)
   为准：只使用 approvals-only observer 作 ID 失效刷新，不修改 `voicewake`、session、Talk、
   policy 或 Gateway pairing 协议。

## 验收条件

- 普通管理 requester 的 transient `connect` 仍携带 `['operator.admin']`。
- 审批 requester 的 transient `connect` 只携带 `['operator.approvals']`。
- 两类 requester 都在完成或失败后断开，且不持久化 transient device token。
- approval client 仍使用精确官方 RPC 名与已验证 payload；scope/RPC 错误不变成空成功。
- 相关回归、类型、边界、构建、官方文档链接和文档索引检查通过；真实 Gateway 与平台边界
  被保留为未验证。
