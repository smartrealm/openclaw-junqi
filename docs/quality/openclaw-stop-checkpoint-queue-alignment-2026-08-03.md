# OpenClaw Stop 检查点与队列对齐

日期：2026-08-03

## 结论

JunQi 是 OpenClaw Gateway 的桌面客户端。普通 Chat、Quick Chat 和 Jarvis 的 Stop
只能中断当前 OpenClaw Run；它不能删除同一 Session 的已持久对话、不能清除由 Gateway
拥有的 followup/lane queue，也不能丢弃 JunQi 显式选择的本地待发送队列。

本轮审计确认两个高风险偏差：`gateway.abortChat` 在 Task checkpoint 写入失败后仍会发送
远端 `sessions.abort`；三个 UI Stop 入口会在调用该 RPC 前清空本地队列。这两个行为都与
“Stop 停本次输出，不清空 Task 记忆”的客户端职责不符。

## 权威依据

- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol)
- [OpenClaw command queue](https://docs.openclaw.ai/queue)
- [OpenClaw SessionsAbortParamsSchema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts)
- [OpenClaw chat abort handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/chat-abort-handler.ts)

当前官方协议规定：`sessions.abort` 带 `runId` 时只取消该 Run；`clearQueued: true` 只允许
在 key-only、非 global 请求中显式清空 Gateway 的 followup/lane queue。省略
`clearQueued` 必须保留这些队列。当前官方 queue 文档还规定，指定 `runId` 的取消可以取消
该 Run 自己处于排队状态的 turn，不能由客户端把整个 Session 的多归属队列当作 Stop 对象。

## 审计范围

- `src/services/gateway/index.ts`
- `src/services/gateway/OpenClawSessionAbortClient.ts`
- `src/task-execution/TaskExecutionCoordinator.ts`
- `src/components/Chat/message-input/useComposerInterruption.ts`
- `src/components/Chat/message-input/useComposerVoice.ts`
- `src/pages/QuickChatPage.tsx`
- `src/services/chat/sendTransaction.ts`
- `src/stores/chatStore.ts`

## 发现

### STCQ-01 - 严重 - checkpoint 持久化失败仍会中止远端 Run

位置：`src/services/gateway/index.ts:933`

`abortChat` 使用 `catch` 吞掉 `taskExecutionCoordinator.requestStop` 的写入失败，随后无条件
调用 `sessions.abort`。当原子 workbench session 写入、generation CAS 或磁盘写入失败时，
Gateway Run 会被中断，但对应 Task 缺少持久 Stop intent。重启后无法可靠地区分普通断线与
已请求 Stop 的半截工具调用，破坏了恢复链路。

修复要求：已有可解析 Task binding 的 Stop intent 必须成功写入后才允许发起远端 Abort。写入
抛错时向调用方传递失败，不得将其记录后继续执行。未找到 checkpoint 或未验证 runtime
identity 时 `requestStop` 仍按既有 no-op 语义返回，不能凭空阻塞 OpenClaw 原生 Stop。

### STCQ-02 - 高 - UI Stop 错误清空 JunQi 本地待发送队列

位置：`useComposerInterruption.ts:29`、`useComposerVoice.ts:209`、
`QuickChatPage.tsx:242`

`clearQueue` 会把本地可见队列中的用户消息标记为 cancelled 并删除 retry payload。该队列
只在用户明确选择 local queue 或会话 mutation 保护时存在，属于尚未交给 Gateway 的用户任务。
三个 Stop 入口在 run-scoped native abort 之前无条件清空它，造成无确认的数据丢失；同时，
Gateway RPC 本身已经正确省略 `clearQueued`。

修复要求：用户选择的 Stop 只停止本地语音输出和当前 Run；本地队列保留，并在 Run 的权威
终态/既有 drain gate 满足时继续由原队列策略发送。显式“清空队列”、Session reset/delete 与
Quick Chat 窗口销毁继续使用各自已存在的清理语义，不能与 Stop 混淆。

## 验证

- Stop transaction 回归覆盖 checkpoint 写入失败时不发送 native abort，以及成功时严格先
  checkpoint 后 abort。
- OpenClaw session abort 回归继续断言默认请求不包含 `clearQueued`，并保留显式 queue
  clearing 的独立契约。
- 2026-08-03 已通过定向 Stop/abort/queue/voice 测试、`pnpm lint`、`pnpm test`、
  `pnpm build`、`pnpm verify:openclaw-docs`、`pnpm test:rust`、`pnpm collab:test`、
  `pnpm collab:validate` 与 `git diff --check`。
- Rust 测试仍输出 `src/commands/system.rs` 的既有未使用变量告警；本轮未修改该文件，告警不
  影响命令成功。

## 未验证边界

- 尚未在真实 Gateway 上分别验收 active run、queued turn、followup/collect queue 和 lane
  queue 的终态时间线。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机验证底层存储写失败时 Stop 错误的呈现与
  本地语音输出时延。
- 本轮不新增 OpenClaw 队列、自动恢复、工具结果或副作用重试逻辑。
