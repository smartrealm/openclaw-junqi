# OpenClaw Stop 发送中状态围栏审计

日期：2026-08-04

## 依据

- OpenClaw 官方 Gateway 协议：`sessions.abort` 可携带 `key` 与可选的 `runId` 精确中止活动
  Run；省略 `clearQueued` 时必须保留 Gateway 队列：
  <https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md>。
- JunQi `gateway.abortChat` 已按既有 Stop checkpoint 顺序调用原生 `sessions.abort`，并由
  `ChatHandler` 只结算 Gateway 确认的精确 Run。

## 审计范围

审查 `MessageInput`、`useComposerInterruption`、`useComposerVoice`、`ChatStore`、
`gateway.abortChat`、`OpenClawSessionAbortClient` 与 `ChatHandler` 的完整 Stop 链路。

## 发现

### STOP-01 高优先级：语音中断遗漏发送中 Run

`useComposerVoice.stopAssistant` 只在 `typingBySession[sessionKey]` 为真时调用
`gateway.abortChat`。但普通发送从发起 RPC 到收到流式事件之间由
`sendingBySession[sessionKey]` 表示活动；该窗口内语音唤醒、录音或听写先停止本地音频，
随后直接返回，远端 Run 未收到原生中止请求。

### STOP-02 高优先级：Escape 未把发送中视为可中断

`useComposerInterruption.stopActiveResponse` 已同时判断 `typingBySession` 和
`sendingBySession`，但 Escape 的触发条件只检查前者和本地语音输出。因此发送中但尚未开始
流式输出时，Escape 落入恢复输入草稿逻辑，不会进入同一个 Stop 控制面。

## 影响

用户已经发出的聊天请求可能在开始语音输入或按 Escape 后继续由 Gateway 执行。JunQi 会给出
本地音频已经停止的表象，但不应把它误作远端 Run 已中止；这违反了桌面常驻语音助手的随时
打断预期。

## 修复方向

在 Chat Store 定义无副作用的会话请求活动判定，统一 `typingBySession` 和
`sendingBySession`。语音 Stop、Escape 和既有 Stop 回调都使用该判定；它们仍然调用现有
`gateway.abortChat`，由既有 checkpoint、`sessions.abort`、Run 身份确认和 history
reconciliation 决定最终状态。

## 验证结果

已执行并通过：

- Stop 链路定向回归：102 项通过；
- `pnpm lint`；
- `pnpm test`：245 项通过；
- `pnpm build`；
- `pnpm verify:openclaw-docs`；
- `cargo fmt -- --check`、`cargo check --lib`、`cargo test --lib`：707 项通过，3 项
  因外部模型夹具未提供而忽略；
- `git diff --check`、无引用扫描和本次改动文件的 Emoji 扫描。

## 未验证边界

本次只修复客户端是否发起原生中止请求；真实 Gateway 对特定模型、网络断开、Windows、
macOS、CentOS 与 Ubuntu 声音设备上的中止时延仍需真机验收。
