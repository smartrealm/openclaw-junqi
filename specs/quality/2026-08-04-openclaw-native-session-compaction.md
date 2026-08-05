# OpenClaw 原生会话压缩对齐规格

日期：2026-08-04

## 目标

桌面端的手动上下文压缩必须调用 OpenClaw 官方 `sessions.compact`，并忠实呈现 Gateway 的完成、no-op、授权和错误结果。

## 约束

1. 请求字段、响应最小字段和权限以 OpenClaw 官方 schema、handler 和方法目录为准。
2. `sessions.compact` 使用临时 `operator.admin` 连接；不得把 admin scope 加入日常连接。
3. 本地 `AbortSignal` 或 UI 超时不能被解释为远端压缩已取消；远端状态只接受 Gateway 结果和事件。
4. `compacted: false` 不得展示为完成，也不得修改本地会话计数或伪造 transcript。
5. 客户端不把 `/compact` 文本发送路径冒充为原生会话维护 RPC。
6. 当前官方 CLI 明确标识 `result.details.pending: true` 时，`ok: true`、
   `compacted: false` 必须显示为已开始等待 Gateway 终态，不能显示为 no-op 或完成。
7. 每次维护 RPC 必须有调用方明确选择的非空 session key；客户端收到的 `key` 必须与请求目标一致，
   否则不得展示成功、no-op 或 pending 状态。

## 验收条件

- 客户端发送 `sessions.compact` 的官方字段。
- 无 transcript、活动 Run、排队冲突或 Gateway 拒绝时保留真实原因。
- 成功压缩和 no-op 在 Dashboard 与命令面板显示不同状态。
- Gateway 已接纳的异步 pending 与成功、no-op、失败显示不同状态，且不伪造完成。
- 未选择活动会话时，Dashboard 与命令面板不发送 `sessions.compact`，并显示本地化错误。
- Gateway 为另一 session 返回结果时，客户端拒绝该响应。
- 主连接仍可接收官方 `session.operation`，本地事件与 RPC 返回不重复写入 Gateway transcript。
- 自动化验证和未完成的真实 Gateway、跨平台边界均记录在对齐文档中。
