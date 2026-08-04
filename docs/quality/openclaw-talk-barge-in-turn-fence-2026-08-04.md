# OpenClaw Talk Barge-in Turn 围栏

日期：2026-08-04

## 结论

OpenClaw 的 `talk.session.cancelOutput` 是 Gateway relay 中停止助手音频输出的官方 barge-in
命令。JunQi 在新唤醒替换既有 Talk relay 时，会先停止本地播放，再向同一 attested Gateway
请求该取消，最后关闭旧 relay。当前 `TalkConversationCoordinator` 只按 `sessionId` 接受输出
事件；在取消请求尚未返回时，旧 turn 的延迟 `output.audio.delta` 或 `output.audio.done` 仍可被
同一 session 接纳。

这是 `TALK-02`：已被本地停止的旧回答可能短暂重新写入原生播放队列；旧 done 也可能错误影响
后续输出排空。修复必须以官方事件的 `turnId` 建立仅内存的取消围栏：发起 barge-in 前登记当前
输出 turn，拒绝该 turn 的后续 audio 事件；新 turn 仍按原生事件继续播放。围栏不创造 Gateway
turn、终态或补偿结果。

## 权威依据

- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [OpenClaw Talk node documentation](https://github.com/openclaw/openclaw/blob/main/docs/nodes/talk.md)
- [OpenClaw Talk handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/talk.ts)

当前官方协议将 `talk.session.cancelOutput` 定义为 Gateway-owned realtime/gateway-relay 会话中
停止助手音频输出的控制命令。`talk.event` 是统一事件通道，JunQi 已按当前 schema 仅接受带有
有效 `turnId` 的 output 事件，并按 session 内 `seq` 过滤过期序号。客户端仍需在取消请求与
Gateway 事件到达之间维持本地播放围栏，不能把 RPC 返回前的延迟事件解释为新的输出。

## 审计范围

- `src/components/Chat/message-input/useComposerVoice.ts`
- `src/services/gateway/TalkGatewayClient.ts`
- `src/services/gateway/talkEventBridge.ts`
- `src/services/gateway/talkTypes.ts`
- `src/services/voice/TalkConversationCoordinator.ts`
- `src-tauri/src/commands/voice_talk_playback.rs`

## TALK-02 - 高 - 已取消 turn 的延迟音频仍可进入本地播放

`TalkConversationCoordinator.interruptPriorOutput()` 在替换 relay 时按顺序执行本地 stop、
`talk.session.cancelOutput` 和旧 relay close；但事件订阅在 close 前仍有效。`handleEvent()` 对
`output.audio.delta` 和 `output.audio.done` 只比较 sessionId，因此取消 in-flight 时来自旧 turn
的有效高序号事件会重新调用 `playOutput()` 或 `finishOutput()`。

修复在发起取消前标记当前输出的 `turnId`，并在事件处理处拒绝该 turn 的 delta、started 和 done。
同一 session 后续不同 turn 不受影响。已取消 turn 的围栏保持到 terminal session、stop 或
replacement 清理，避免异常高序号延迟事件被重新放行；不会由 JunQi 自行宣布 Gateway 已取消或结束。

## 验证结果

- Talk 定向回归覆盖官方 relay 创建、cancelOutput 参数、事件解码、单调序号、旧 turn
  延迟 delta/done 拒绝和新 turn 继续播放：21 项通过。
- `pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs` 与
  `git diff --check` 通过。
- 本轮修改文件的 Emoji 扫描和已删除的 release-marker helper 全局引用审查通过。

## 未验证边界

- 未连接真实 Gateway 捕获取消响应与延迟 `talk.event` 的精确时间线。
- Windows、CentOS、Ubuntu 的原生音频设备调度仍需真机验收；本轮只收紧跨平台共享的事件状态机。
