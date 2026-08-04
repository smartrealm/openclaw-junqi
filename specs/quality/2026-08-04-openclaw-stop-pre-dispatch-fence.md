# OpenClaw Stop 派发前围栏规格

日期：2026-08-04

## 目标

防止已持久化 Stop 的本地 Chat Run 在 Gateway 尚未登记前继续发出 `chat.send`。

## 验收条件

- 在 Task Run 已 `cancel_requested` 时，普通发送、语音发送和本地队列排空都不调用 Gateway
  send 方法。
- 被阻止的乐观消息显示为 `cancelled`，不伪造远端成功或失败。
- 本地 preflight 的 `sendingBySession` 不单独触发远端 Stop。
- 已登记 Gateway pending Run 的 Stop 仍走既有原生 `sessions.abort`。
- 定向回归、类型检查、完整前端测试、构建、官方文档链接、Rust library 检查与差异检查通过。

## 非目标

- 不新增 OpenClaw RPC 参数或第二套远端取消协议。
- 不自动重试被用户取消的消息。
