# OpenClaw 原生会话队列对齐

日期：2026-08-03

## 结论

JunQi 的普通 Chat 和 Quick Chat 发送现在把活动 Run 期间的队列语义交给
OpenClaw Gateway。JunQi 不在渲染层默认拦截普通消息，也不把普通消息伪装成
`sessions.steer`。只有两类情况保留 JunQi 本地可见队列：用户明确选择本地等待，
以及会话删除、重置、归档等破坏性会话操作正在占用本地 mutation gate。

Task checkpoint 同样遵守一个 Task/Session 一个活动 Run：已有本地活动 Run 时，
普通 `chat.send` 只复用该 Run 的关联，不创建第二个 Run；界面观察到 Gateway
活动但没有可验证的本地 Run 时，不猜测 Run identity。显式 Jarvis 打断仍使用
OpenClaw 原生 `sessions.steer`，因为它是另一种明确的中断并转向操作。

## 权威依据

- [OpenClaw queue steering](https://github.com/openclaw/openclaw/blob/main/docs/concepts/queue-steering.md)
- [OpenClaw queue modes](https://github.com/openclaw/openclaw/blob/main/docs/concepts/queue.md)
- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [OpenClaw chat.send handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/chat-send-handler.ts)

官方文档规定 Gateway-backed 客户端在活动 Run 期间转发普通消息，由 Gateway
按会话或默认 queue mode 决定 `steer`、`followup`、`collect` 或 `interrupt`。
`chat.send` 的一次性 `queueMode` 覆盖字段只有在客户端确实提供该官方字段时才可
使用；JunQi 当前没有自己的 queue mode 选择器，因此不生成或推断该字段。

## 当前行为

1. `ChatSendCoordinator` 默认直接调用 Gateway `chat.send`。活动 Run 不再自动
   变成渲染器队列，输入框的发送动作也不再显示为本地 Queue。
2. `queueIfBusy: true` 或既有的 `delivery: 'queue'` 是 JunQi 本地队列的显式选择，
   仅用于需要可见等待队列的客户端入口；它不是 OpenClaw queue mode 的替代品。
3. 会话 mutation gate 仍优先阻止发送，避免在重置、删除或其他破坏性操作期间把
   新输入交给 Gateway。
4. `prepareTaskRunSend` 在已有活动 Task Run 时返回该 Run，不调用会抛出第二个活动
   Run 的状态机分支。活动 Gateway 没有已验证 Task binding 时保持无本地 Run。
5. 发送失败只结算本次新建且尚未被 Gateway 接受的本地 Run，不把活动旧 Run 或
   Gateway 已接管的排队输入误标记为失败。
6. Jarvis 语音路径继续走明确的 `sessions.steer`，Stop 继续走原生 abort，二者
   不被普通文本发送逻辑替换。

## 验证

- `node --import ./test-setup.ts --import tsx --test src/services/chat/sendTransaction.test.ts`
  通过，7 项。
- `node --import ./test-setup.ts --import tsx --test src/task-execution/stateMachine.test.ts`
  通过，17 项。
- `node --import ./test-setup.ts --import tsx --test src/components/Chat/MessageInput.composer.test.ts`
  通过，5 项。
- `pnpm exec tsc --noEmit` 通过。
- `git diff --check` 通过。

## 未验证边界

- 尚未在真实 Gateway 上逐一验证用户配置的 `steer`、`followup`、`collect` 和
  `interrupt` queue mode；JunQi 不把本地测试替代为真实 Gateway 证据。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机执行 Tauri 窗口中的活动 Run、断连
  恢复和语音打断验收。
- OpenClaw 官方 queue 文档、协议 schema 或 handler 变化时，必须重新核对官方
  源码后更新适配器和本记录。
