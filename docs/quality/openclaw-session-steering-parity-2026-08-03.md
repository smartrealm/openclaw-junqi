# OpenClaw 会话 Steering 能力对齐

日期：2026-08-03

## 依据

本机安装的 OpenClaw 版本为 `2026.7.1-2 (0790d9f)`。官方 Gateway
`sessions.steer` 在 `server-methods` 中声明为 `operator.write`，使用与
`sessions.send` 相同的参数结构：`key`、`message`，以及可选的 `agentId`、
`thinking`、`attachments`、`timeoutMs` 和 `idempotencyKey`。官方处理器在发送前
中断当前活动运行，再把消息交给同一会话的 `chat.send` 处理。

官方文档同时区分两种行为：普通消息默认使用队列 `steer`，在模型边界注入而不
中断正在执行的工具；显式 `sessions.steer` 是 interrupt-and-steer，用于当前
输入必须立即替换活动运行的场景。

## JunQi 原行为

JunQi 的普通发送在会话忙时进入可见消息队列，停止按钮只调用 `chat.abort`。
因此用户无法在保留新指令的同时，以 OpenClaw 的官方 interrupt-and-steer 语义
重新启动同一会话。

## 修复行为

- `src/services/gateway/sessionSteering.ts` 严格构造官方参数，拒绝空会话、空消息
  和非法超时，不添加 OpenClaw 未声明的字段。
- `src/services/gateway/index.ts` 增加 `gateway.steerMessage`，沿用现有的
  idempotency、发送不确定性和运行状态对账路径，RPC 只调用 `sessions.steer`。
- Chat 输入在当前会话有活动运行且草稿非空时显示独立 steering 图标。普通发送
  继续排队；steering 只在用户明确点击该图标时中断并发送，不改变默认行为。
- 维护操作进行期间 steering 不绕过会话 mutation gate。

## 验证

- 参数构造测试覆盖字段、空值、超时和 idempotency key。
- ChatSendCoordinator 回归测试确认活动会话 steering 不进入本地队列，并调用
  interrupt-and-steer 端口。
- Composer 结构测试确认 steering 图标、可访问名称和三种 locale 文案存在。

真实 Gateway 上的活动工具中断、不同 Agent runtime 对 steering 的接受边界仍需在
隔离 Gateway 上验收；自动化测试不把 mock 响应当作真实运行时证据。
