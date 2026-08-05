# OpenClaw 会话操作展示归属

日期：2026-08-05

## 依据

- [Gateway protocol session event families](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [SessionOperationEventSchema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts)
- [session operation broadcast](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/sessions-shared.ts)

官方将 `session.operation` 定义为订阅会话的运行中操作事件，当前唯一
operation 是 `compact`，只提供 start/end、操作身份、会话身份、时间和可选终态。
该事件不是 transcript 消息。

## 当前行为

1. `ChatHandler` 严格解码并按 operation 身份去重，在 start 时写入既有的
   `compactionStatusBySession`，在匹配 end 时清除它。
2. 当前会话的压缩状态展示在 `SessionContextBar`，紧随会话运行时控制；它是
   会话级运行态，不进入聊天正文，也不位于右侧杂项操作区。
3. `projectSessionActivity` 将同一只读状态投影为 `compacting`。顶部状态、侧栏、
   活动中心、仪表盘和灵动岛使用同一个投影；最小化主窗口时，灵动岛继续显示该
   会话为工作中。
4. 只有 OpenClaw 终态明确 `completed: true` 时才注入本地压缩分隔线。该分隔线
   表示已完成的 transcript 边界；它不来自 `session.operation` 的展示投影。

## 删除的行为

主窗口和 Quick Chat 不再把 `session.operation` 创建为空的 assistant 消息或
`sessionEvents`。不保留回调兼容层或未使用的翻译文案。

## 验证

- `sessionOperation.test.ts` 覆盖官方事件字段和缺失终态不推断成功。
- `ChatHandler.test.ts` 覆盖 start/end、重复事件和真实压缩分隔线。
- `sessionPresentation.test.ts` 覆盖压缩运行态、Gateway 时间戳和全部活动面的
  共享投影契约。

## 未验证边界

- 尚未在连接真实 Gateway 的 macOS、Windows、CentOS 或 Ubuntu 制品中现场触发
  `sessions.compact` 并检查 start/end 广播顺序。
- Gateway 新增 operation 类型时，严格解码器会拒绝该事件；需要先复核官方协议后
  再扩展。
