# OpenClaw 语音唤醒设置事件投影

日期：2026-08-04

## 结论

OpenClaw 将唤醒词作为 Gateway 拥有的全局配置，并通过 `voicewake.changed` 向具有
read scope 的客户端广播变更。JunQi 已将该事件从 Gateway WebSocket 分发到
`VoiceWakeGatewayClient`，聊天中的唤醒运行时也会消费它；但 Settings Jarvis 仅在打开
页面或用户手动刷新时读取 `voicewake.get`。当其他 OpenClaw 客户端更新全局列表时，设置页
会显示陈旧的触发词选择。

这是 `VW-05`：不改变 Gateway 数据，却会错误呈现当前全局配置，并使用户在保存前看不到
其他客户端的刚发生变更。应让启用状态下的 Settings Jarvis 订阅既有只读事件桥，仅用
`voicewake.changed` 的严格已解码快照替换内存中的 `gatewayTriggers`。`voicewake.routing.changed`
与错误事件不得改写该列表；组件卸载或设置页关闭后必须取消订阅。

## 权威依据

- [OpenClaw Voice Wake](https://github.com/openclaw/openclaw/blob/main/docs/nodes/voicewake.md)
- [OpenClaw voice wake Gateway handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/voicewake.ts)
- [OpenClaw voice wake routing Gateway handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/voicewake-routing.ts)

官方文档说明触发词为 Gateway 全局列表，任意客户端 UI 修改后 Gateway 会持久化并广播给
所有已连接客户端。文档还明确区分 `{ triggers }` 的 `voicewake.changed` 与
`{ config }` 的 `voicewake.routing.changed`。handler 先完成持久化，再广播实际保存的触发词。

## 审计范围

- `src/services/gateway/Connection.ts`
- `src/services/gateway/index.ts`
- `src/services/gateway/voiceWakeEventBridge.ts`
- `src/services/gateway/VoiceWakeGatewayClient.ts`
- `src/components/Chat/message-input/useComposerVoice.ts`
- `src/hooks/useJarvisVoiceSettings.ts`

## VW-05 - 中 - Settings Jarvis 未投影全局触发词广播

`voiceWakeEventBridge` 已严格解码 `voicewake.changed` 并通知订阅者，
`useComposerVoice` 也将触发词快照投影到当前唤醒路由判断。`useJarvisVoiceSettings` 却只调用
`getTriggers()`；没有调用 `voiceWakeGatewayClient.subscribe()`。所以同一 Gateway 上其他客户端
的合法 `voicewake.set` 成功后，已打开的 Settings Jarvis 不会更新其复选框。

修复只增加 Settings 的只读订阅和纯投影函数。该函数仅接受 `triggers` 事件，直接采用桥已
验证的 snapshot；routing 事件保持原列表。不会调用 `voicewake.set`、`voicewake.routing.set`、
session、Talk 或本地存储。

## 验证结果

- 定向回归覆盖 trigger 更新、routing 忽略、事件 payload 隔离、取消订阅、严格 Gateway
  解码、关键词选择和唤醒路由：22 项通过。
- `pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs` 与
  `git diff --check` 通过。
- 本轮修改文件的 Emoji 扫描和 `voicewake.routing.set`、本地 trigger 持久化引用审查通过。

## 未验证边界

- 未在真实 Gateway 上验证多个客户端同时广播和 Settings 页面关闭时的 WebSocket 时序。
- Windows、CentOS、Ubuntu 的本地捕获、常驻与系统权限不属于本次只读配置投影，仍须目标
  平台真机验收。
