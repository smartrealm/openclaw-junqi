# OpenClaw 会话操作事件对齐

日期：2026-08-03

## 结论

JunQi 现在消费 OpenClaw 官方 `session.operation` 事件，并把压缩操作投影为当前会话内的本地 session event。这个投影只用于桌面展示，不写入 OpenClaw transcript，不生成 run、tool result、审批结果或任务完成状态。

## 权威依据

- [Gateway protocol：session event families](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [SessionOperationEventSchema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts)
- [sessions.compact handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/sessions-compact.ts)
- [session operation broadcast](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/sessions-shared.ts)

当前官方 schema 只定义以下字段：`operationId`、`operation: "compact"`、`phase: "start" | "end"`、`sessionKey`、可选 `agentId`、`ts`、可选 `completed` 和可选 `reason`。Gateway handler 使用 `Date.now()` 生成 `ts`，客户端不推断其他时间或状态字段。

## 当前行为

- 已有 `sessions.messages.subscribe` 连接订阅继续作为事件来源；不创建第二条 WebSocket 或浏览器媒体链路。
- `ChatHandler` 对 `session.operation` 执行严格字段解码。非法事件、缺少会话身份的事件和隔离执行会话事件被丢弃，并保留连接继续处理其他事件。
- 合法 start 写入按会话隔离的临时压缩状态，当前会话上下文栏展示运行中状态；匹配的 end 清除该状态。
- `completed` 缺失或为 false 时不显示成功，也不把 `reason` 投影为本地消息。
- 本地展示不会触发语音播报、未读计数、Gateway 写入或聊天消息，也不会把 operation 当作新的 Task 或 Session。

## JunQi 边界

OpenClaw 负责压缩生命周期、操作 ID、会话身份和终态字段。JunQi 只负责在已认证、已订阅的桌面连接中做可丢弃的 UI 派生投影。OpenClaw 未声明的 operation 类型、字段和恢复结论保持未知，不添加猜测性兼容。

审批事件仍未接入：官方要求 `sessions.messages.subscribe({ includeApprovals: true })`，并额外要求 `operator.admin` 或配对设备的 `operator.approvals`。JunQi 的日常连接不请求该 scope，避免把权限提升伪装成普通只读追溯。

## 验证结果

- `sessionOperation.test.ts`：官方 start/end 字段、非法 payload、缺少终态标记均有回归覆盖。
- `ChatHandler.test.ts`：合法事件状态投影、重复事件和非官方 operation 均有覆盖。
- `pnpm exec tsc --noEmit` 通过。

## 未验证边界

- 当前工作区未连接真实 Gateway，未完成不同 Gateway 能力声明、手动压缩失败和连接重连期间的现场事件验收。
- Windows、CentOS、Ubuntu 和 macOS 真机 UI 验收未在本次变更中完成；实现使用 Tauri/React 既有桌面事件链，不以浏览器能力作为前提。
- OpenClaw 官方 schema 或 handler 未来变化时，必须重新核对官方源码后再更新解码器。
