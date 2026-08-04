# OpenClaw Stop 派发前围栏审计

日期：2026-08-04

## 依据

- OpenClaw `sessions.abort` 只中止已经由 Gateway 识别的活动 Run；`key` 与可选 `runId`
  是其官方参数，客户端不能用本地提交状态伪造远端 Run。
- `ChatHandler` 在 `gateway.sendMessage` 内登记 pending send；`ChatSendCoordinator` 与本地
  队列排空则在此前异步持久化 Task Run。

## 发现

### STOP-04 高优先级：已记录 Stop 的发送仍可在派发前继续

发送事务先持久化 Task Run，随后才调用 `gateway.sendMessage`。若用户在该持久化等待期间触发
Stop，`gateway.abortChat` 能写入 `cancel_requested` checkpoint，但当时 Gateway 尚无 pending
Run 可精确中止。原发送恢复后没有读取该取消意图，仍会继续派发 `chat.send`。

此前 `sendingBySession` 被用于弥补此窗口，但它同时覆盖预算读取、附件准备和语音文件写入，
并不能证明 Gateway 已接收请求；以它发起远端 abort 会产生无目标或过宽中止。

## 目标行为

1. 发送事务在持久化 Run 后、调用 Gateway 前读取相同绑定下的精确 Run 状态。
2. 该 Run 已是 `cancel_requested` 时，停止本地派发，将乐观用户消息标为 `cancelled`，保留
   原始输入而不假装 Gateway 已处理它。
3. 已进入 `gateway.sendMessage` 的请求继续由现有 `ChatHandler` pending run 与原生
   `sessions.abort` 处理。
4. `sendingBySession` 仍可表达本地提交中的界面锁定，但不单独触发远端 Stop；本地预算或附件准备
   不再被误当作 Gateway Run。

## 未验证边界

真实 Gateway、模型与操作系统设备上的停止时延仍需真机验收。本次不修改 OpenClaw 协议、
`clearQueued`、Tauri IPC 或 Rust 宿主。

## 验证结果

- 定向回归覆盖精确 Run 状态、普通发送、原生转向发送、会话生命周期与本地队列既有交付行为。
- `pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs`、`cargo fmt -- --check`、
  `cargo check --lib` 和 `cargo test --lib` 均通过；Rust 为 707 通过、3 个既有忽略项。
- 未进行 Windows、macOS、CentOS、Ubuntu 真机与真实 Gateway 的停止时延验收。
