# OpenClaw 语音唤醒设置事件投影规格

日期：2026-08-04

## VW-05 - Settings Jarvis 未投影全局触发词广播

### 当前

Settings Jarvis 在打开和用户手动刷新时调用 `voicewake.get`，但不订阅已存在的
`VoiceWakeGatewayClient` 事件流。其他客户端完成原生 `voicewake.set` 后，设置页仍持有旧的
`gatewayTriggers`。

### 目标

当 Settings Jarvis 已启用时，订阅既有 Gateway 事件桥。收到严格解码的
`voicewake.changed` 后，用其 `{ triggers }` 快照替换暂态设置状态；routing 事件不能改变
触发词列表。禁用、卸载或订阅替换时释放监听器。

### 约束

- 只使用已有 `voiceWakeGatewayClient.subscribe()` 和已解码 `VoiceWakeGatewayEvent`；不得
  在 Hook 中解析原始 WebSocket payload。
- 不新增本地 trigger authority、持久化缓存、定时轮询或 Gateway 写操作。
- 不把 routing 事件、传输错误、方法广告或本地模型标签解释成 trigger 更新。
- 聊天中的唤醒运行时订阅保持独立，Settings 的订阅不能控制其麦克风、Talk 或会话状态。

### 验收条件

- [x] `triggers` 事件以 Gateway 快照替换设置页暂态 trigger list。
- [x] `routing` 事件不改变设置页 trigger list。
- [x] Hook 只在启用时保留一个订阅，并在禁用或卸载时释放。
- [x] 回归测试、类型、边界、构建、全量测试、官方链接和 diff/Emoji 扫描通过。
