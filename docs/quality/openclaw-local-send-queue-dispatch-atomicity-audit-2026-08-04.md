# OpenClaw 本地发送队列交付原子性审计

日期：2026-08-04

## 结论

JunQi 是 OpenClaw 的桌面客户端。Gateway 已接收的 turn 由 OpenClaw 的
`chat.send`、per-session lane 和 followup/collect queue 管理；JunQi 不得把本地
待发队列伪装成 Gateway 队列，也不得以本地清空操作影响已经交给 Gateway 的 turn。

`chat.send` 是 OpenClaw 对既有会话的执行入口。JunQi 发送路径必须使用调用方已经选定的
会话键，不能在缺少活动会话时以 `agent:main:main` 代替用户选择；否则快捷指令可能把消息、
中断和本地任务状态投射到无关会话。

本轮审计发现 JunQi 本地队列的首项在 `drainQueue` 发起异步交付期间仍保留在
`messageQueue` 中。用户的清空操作可先删除该项并将消息写为 `cancelled`，而先前的
drain 仍会继续调用 `chat.send`，随后回写为 `sent`。这使本地队列的“清空”承诺与实际
交付不一致，并可能把用户已取消的未提交输入发送到 Gateway。

## 权威依据

- [OpenClaw command queue](https://docs.openclaw.ai/queue)
- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol)
- [OpenClaw chat handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/chat.ts)
- [OpenClaw queued turn registry](https://github.com/openclaw/openclaw/blob/main/src/gateway/chat-queued-turns.ts)

安装版 OpenClaw `2026.7.1-2` 的 `chat.send` handler 在开始实际 dispatch 前以
`idempotencyKey` 预留并在 admitted turn 上维护 abort identity；其 `started` ack 仅说明
Gateway 已接收该 run，不是 renderer 本地队列的可编辑状态。Gateway 的 queued-turn
registry 也只管理已 admitted 的 followup/collect turn。

当前官方 Gateway protocol 说明会话执行继续使用 `chat.history`、`chat.send`、`chat.abort`
和 `chat.inject`，并要求副作用方法带幂等键。JunQi 已有的 `clientMessageId` 是该发送路径的
幂等键来源；会话键则必须由当前 UI 选择或队列归属明确提供，不能由客户端猜测。

## 发现

### LQ-01 - 严重 - 清空本地队列可与首项交付并发，导致取消后仍发送

位置：`src/stores/chatStore.ts:1927`

原实现先从 `messageQueue[sessionKey][0]` 读取首项，随后执行 Task checkpoint 与异步
`gateway.sendMessage`，成功后才从数组中移除该首项。其间 `clearQueue` 可以清空同一个
数组并把对应本地消息标记为 `cancelled`。drain 持有的对象引用不受该数组变更影响，仍会
发送给 Gateway；成功回调又会把同一消息改为 `sent`。

影响：

- 用户点击本地队列的清空后，已取消的输入仍可能交付给 OpenClaw。
- 消息状态会在 `cancelled` 与 `sent` 间反转，无法真实反映交付边界。
- 在运行中的会话重置、删除或本地清理期间，首项仍可能跨越预期的本地所有权边界。

修复：在任何异步工作开始前，同步从 renderer-owned queue 中认领并移除首项。此后该项是
正在提交的消息，不再属于可编辑、可清空的本地待发队列；成功不会再次移除，失败时仅在
会话仍有效时将原项以失败状态放回队首，保持 FIFO 与显式重试语义。

### LQ-02 - 严重 - 快捷指令与发送外观会回落到主会话

位置：`src/components/Chat/ChatView.tsx`、`src/services/gateway/index.ts`

原实现中 Dashboard/命令面板快捷指令在没有活动会话时使用 `agent:main:main`，Gateway
`sendMessage` 外观也为同一键提供默认值。缺少会话上下文的操作因而仍会启动语音中断、创建
乐观消息或进入发送流程，无法证明该写操作属于用户当前任务。

修复：新增共享会话目标校验，发送协调器在读取本地状态、写入乐观消息、创建 Task checkpoint
或调用 Gateway 前拒绝空目标；Gateway 外观也在创建 pending-send 状态前执行相同校验。快捷
指令不再回落到主会话，而是向用户显示本地化的“选择会话”错误。合法目标会去除首尾空白，
使本地状态、Task checkpoint、Gateway dispatch 与回执跟踪使用同一会话键。

## 非问题

- 不为 Gateway followup/collect queue 新增本地位置、容量、状态或取消协议。OpenClaw
  的 ack、流事件、历史和 `chat.abort` 仍是远端权威。
- 不改变 OpenClaw `messages.queue` 配置、`/queue` 命令、drop policy 或跨客户端所有权。
- 不将已经发送中的本地消息错误标为可清空；这类请求已经跨过 renderer 所有权边界。
- 不新增会话、`chat.send` 参数、远端队列状态或回退会话。OpenClaw 仍是 session 创建、选择、
  运行、取消和回执的唯一权威。

## 验证目标

- 首项被本地 queue pump 认领后，清空只影响尚未认领的后续项，不能取消或重复发送首项。
- 发送失败时，首项仅在 Session 未删除时回到本地队首并保持可重试；Session 已删除时不
  恢复本地待发数据。
- 正常 Gateway 发送继续保留调用方 idempotency key，并由 OpenClaw 决定 active-run queue
  mode 与 queued-turn 生命周期。
- 空、仅空白或未选择的会话目标不得写入 renderer 状态、创建 Task checkpoint 或触发 Gateway
  请求；快捷指令必须报告该错误，不得静默投递到主会话。

## 验证结果

- `src/stores/chatStore.test.ts` 覆盖首项认领后清空后续项，以及已删除 Session 的失败回调
  不恢复本地队列；定向测试 31 通过。
- `src/services/chat/sendTransaction.test.ts` 与
  `src/services/gateway/OpenClawSessionTarget.test.ts` 覆盖空会话目标在本地状态、Task
  checkpoint、Gateway 连接和 pending-send 状态前失败，以及合法键的空白规范化；定向测试
  13 通过。
- 本次 LQ-02 修改执行 `pnpm lint`、`pnpm test`、`pnpm build` 与
  `pnpm verify:openclaw-docs`，均通过。
- `pnpm lint`、`pnpm test`、`pnpm test:rust`、`pnpm build`、
  `pnpm verify:openclaw-docs`、`pnpm collab:test`、`pnpm collab:validate` 通过。
- Rust 额外执行 `cargo fmt -- --check` 与 `cargo check --lib` 通过；`pnpm test:rust` 为
  703 通过、3 个既有忽略。
- `git diff --check` 与本次修改文件的 Emoji 扫描通过。

## 未验证边界

- 未在真实 Gateway 上逐一验收 followup、collect、steer、interrupt 及跨客户端 abort 的
  精确时间线。
- 未在 macOS、Windows、CentOS 或 Ubuntu 真机验证断网、系统睡眠与窗口关闭交叉发生时的
  最终队列可见性。
