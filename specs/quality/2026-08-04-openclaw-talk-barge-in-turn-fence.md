# OpenClaw Talk Barge-in Turn 围栏规格

日期：2026-08-04

## TALK-02 - 已取消 turn 的延迟音频仍可进入本地播放

### 当前

新唤醒替换既有 relay 时，JunQi 在等待原生 `talk.session.cancelOutput` 完成期间仍订阅旧 session。
协调器仅按 `sessionId` 接受 `output.audio.*`，没有记录被取消的输出 `turnId`。

### 目标

在本地停止和 Gateway cancel 之间，为当前输出 turn 建立内存围栏。被围栏 turn 的
`output.audio.started`、`output.audio.delta` 和 `output.audio.done` 不得调用原生播放或改变
新 turn 的播放状态；同一 session 的新 turn 可以继续按官方事件播放和排空。

### 约束

- 只使用已由 Talk event decoder 验证的 `turnId`；不解析或猜测 payload 字段。
- 取消标记必须在本地 stop 和 Gateway cancel 前建立。
- session terminal、stop 与 replacement 清理内存围栏；同一已取消 turn 保持被拒绝，不能把本地
  标记显示为 Gateway 终态。
- 不新增 RPC、重试、取消超时、provider 特例或跨 session 路由。
- `sessionId`、attested connection 和 `seq` 围栏保持既有行为。

### 验收条件

- [x] barge-in cancel 未返回时，同一旧 turn 的延迟 PCM delta 和 done 不会进入播放队列。
- [x] 同一 Talk session 的不同新 turn 仍可播放并在 done 后排空。
- [x] 围栏在停止、终态或 relay replacement 后不保留陈旧状态，并保持已取消 turn 被拒绝。
- [x] 定向回归、类型、边界、构建、完整测试、官方链接、diff 和 Emoji 扫描通过。
