# OpenClaw 原生会话转向核验对齐

日期：2026-08-03

## 结论

JunQi 的 Jarvis 语音抢话继续使用 OpenClaw 原生 `sessions.steer`。该 RPC 在
Gateway 的 admission 阶段先尝试中断当前 Run、清理 Gateway followup 队列，再把
新消息交给原生 `chat.send`。因此，一次失败的 RPC 响应不能证明中断尚未发生，也
不能证明中断已经完成。

JunQi 现在会在 steer 发生异常后立即启动现有的单飞 `sessions.describe` +
`chat.history` 核验。只有官方 history 明确把旧 `runId` 列为活动 Run 时，持久
Task checkpoint 才把旧 Run 从 `cancel_requested` 恢复为 `running`；没有该证据时
保持原有的取消请求或核验状态。新 Run 仍按发送失败路径结算，不伪造 transcript、
Tool Result 或工具副作用结论。

## 权威依据

- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [OpenClaw sessions schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts)
- [OpenClaw sessions messaging handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/sessions-messaging.ts)
- [OpenClaw chat send handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/chat-send-handler.ts)
- [OpenClaw chat history protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)

当前官方 handler 为 `sessions.steer` 复用 `chat.send` admission，并只在实际中断
活动 Run 时把 `interruptedActiveRun: true` 附加到成功响应。其后续 `chat.send`
也可能在 admission 后失败。故 JunQi 不能根据 RPC 异常恢复旧 Run，也不能根据
`cancel_requested` 本地意图把它当作远端终态；必须读取官方 session/history。

项目锁定的 OpenClaw 安装版本仅用于当前环境复现记录，不作为此适配的能力门禁。

## 当前行为

1. Jarvis 在 steer 前持久化旧 Run 的取消意图和新 Run 的发送意图。
2. 成功响应仅在 `interruptedActiveRun: true` 时结算旧 Run 为 aborted。
3. steer 异常触发当前连接身份围栏下的单飞 history 核验，不等待或冒充远端结果。
4. history 明确包含旧 Run 为活动时，状态机恢复该 Run 的 `running` 与模型执行节点；
   未结工具节点保持原状态。这只修正本地投影，不重发消息或重新执行工具。
5. history 未确认、连接轮换、响应字段不完整或核验失败时，checkpoint 保持失败关闭；
   有未结工具的 Run 仍由既有规则进入 `verification_required`。

## 验证

- 状态机回归覆盖 `cancel_requested` Run 仅在官方 history 精确列为活动时恢复。
- 既有核验器回归覆盖单飞、连接围栏、观测围栏以及 official
  `sessions.describe`/`chat.history` 查询顺序。
- `pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs`、
  `pnpm test:rust`、`pnpm collab:test`、`pnpm collab:validate` 和
  `git diff --check` 于 2026-08-03 通过。Rust 测试执行 701 项；其一条既有未使用
  变量警告未由本次改动引入。

## 未验证边界

- 尚未在真实 Gateway 重放 admission 后 `chat.send` 失败和已中断工具调用的完整现场。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机验证后台语音抢话、断连和重连后的
  history 时序。
- OpenClaw 未来若调整 `sessions.steer` 的 admission 或响应字段，必须重新核对官方
  schema、handler 与协议后再更新 JunQi。
