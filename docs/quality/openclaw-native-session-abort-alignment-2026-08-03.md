# OpenClaw 原生会话中止对齐

日期：2026-08-03

## 结论

JunQi 的 Stop 已切换到 OpenClaw 原生 `sessions.abort`。它通过普通连接的
`operator.write` 权限发送当前 `sessionKey` 和已知的 `runId`，不默认发送
`clearQueued`，因此只请求中止当前活动 Run，并保留 OpenClaw 的 followup 与
lane 队列。JunQi 不重置 transcript、不创建新的会话，也不向 transcript 写入
合成的 Tool Result。

## 权威依据

- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [OpenClaw sessions schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts)
- [OpenClaw sessions.abort handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/sessions-abort.ts)
- [OpenClaw method descriptors](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)
- [OpenClaw chat abort lifecycle](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/chat-abort-handler.ts)

官方请求字段是可选的 `key`、`runId`、`agentId` 和 `clearQueued`；客户端为避免
无目标中止，额外要求至少提供 `key` 或 `runId`。官方成功返回的稳定字段是
`ok: true`、`status: "aborted" | "no-active-run"` 和 `abortedRunId`。
`chat.abort` 仍是 Gateway 内部的生命周期实现，不是 JunQi Stop 的 RPC 出口。

项目锁定的 OpenClaw 安装版本只用于当前运行环境复现和验证范围记录，不作为
能力开关或字段契约。能力判断以官方文档、协议 schema 和 handler 为准。

## 当前行为

1. `gateway.abortChat` 通过独立控制面请求 `sessions.abort`，不等待长时间
   `chat.send` 请求。
2. `status: "aborted"` 只有在 `abortedRunId` 与当前 OpenClaw 运行投影精确匹配时，
   才结束对应 UI 运行；工具卡仍按既有规则等待官方事件。
3. `status: "no-active-run"`、`abortedRunId` 缺失或与本地 Run 不匹配时，保持未知
   状态并请求官方 history/session reconciliation，不把空结果解释成成功。
4. 本地语音输出和页面队列仍由各自 UI/运行时边界停止；Gateway 队列是否清空由
   OpenClaw 的 `clearQueued` 语义决定，普通 Stop 不隐式改变它。
5. 下次发送继续使用同一个 OpenClaw session 的 transcript；Stop 不清空记忆。

## 验证

- `OpenClawSessionAbortClient.test.ts` 覆盖官方请求字段、默认保留队列、显式
  `clearQueued`、`no-active-run` 和非法响应。
- `OpenClawChatRunProjection.test.ts` 覆盖精确 `abortedRunId`、未知状态和字段
  错配；`ChatHandler.test.ts` 覆盖精确结算与 history reconciliation。
- `pnpm exec tsc --noEmit` 通过；定向 Gateway 回归 80 项通过。

## 未验证边界

- 尚未连接真实 Gateway 验证不同 agent scope、活动工具调用、队列和 worker-only
  Run 的现场返回。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机执行后台 Stop、语音打断和 Gateway
  重连验收。
- OpenClaw 官方 schema、handler 或权限目录变化时，必须重新核对源码后更新适配器。
