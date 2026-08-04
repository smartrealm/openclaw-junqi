# OpenClaw Talk 全局输出所有权

日期：2026-08-04

## 当前问题

JunQi 已为 Gateway TTS 和 assistant MEDIA 建立跨 WebView 的输出 claim/release 协议，但
OpenClaw Talk 的 PCM 输出只作为界面 `speaking` 状态投影。Tauri 的 Talk PCM 播放器是整个桌面进程
共享的单例，因此另一个 JunQi WebView 开始输出时，Talk 既不会声明全局占用，也不会立即停止共享 PCM
播放器。结果是同一桌面应用的多个窗口可能重叠发声。

## 权威契约

1. OpenClaw `talk.session.create` 创建 Gateway 拥有的 realtime/gateway-relay 会话。
2. OpenClaw `talk.event` 是 Talk 输出事件的唯一通道。
3. OpenClaw `talk.session.cancelOutput` 是 gateway-relay 的 barge-in 输出取消接口。
4. JunQi 的 `voice_talk_play_pcm`、`voice_talk_stop_playback` 与 `voice_talk_finish_playback` 仅渲染
   Gateway relay 提供的固定 PCM16 24 kHz 单声道帧；它们不合成文本也不改变 Gateway 会话。

## 目标

1. Talk 进入 speaking 时必须加入既有跨窗口输出所有权协议；结束时只释放自己仍拥有的 claim。
2. 新的跨窗口输出 claim、Stop 或当前窗口其他输出开始时，必须先请求停止进程共享的 Talk PCM 播放，
   再由拥有 Talk 会话的协调器调用官方 `talk.session.cancelOutput`。
3. 旧的 Talk output 事件、取消回执和延迟 UI effect 不得重新声明已被抢占的输出。
4. 不得创建本地 Talk 会话、伪造 Talk event、猜测 Gateway 取消成功，或让客户端替代 Gateway 的
   provider、会话或工具生命周期。

## 验收条件

- 两个 VoiceRuntime 实例中，Talk speaking 的实例能被另一实例的新 claim 抢占，且共享 PCM stop 被调用。
- 被抢占 Talk 所属的 composer 接到结构化的本地 interrupt 后，只在 matching `sessionKey` 且 Talk
  正在 speaking 时调用现有协调器 `interrupt()`。
- 协调器维持既有顺序：本地 PCM stop 后才调用 `talk.session.cancelOutput`；该 RPC 的结果仍由官方
  Gateway 回应决定。
- 现有 Gateway TTS、assistant MEDIA、会话级 Stop、Talk turn fencing 和跨窗口 claim 时序不回归。
- 文档明确自动化不等于 macOS、Windows、CentOS、Ubuntu 的多窗口与设备真机验收。

## 非目标

- 不增加 OpenClaw API、provider、WebRTC、浏览器语音或本地 TTS 回退。
- 不在本轮改变 Talk catalog、PCM 格式、Gateway session 选择或音频设备策略。
