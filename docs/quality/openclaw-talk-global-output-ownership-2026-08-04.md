# OpenClaw Talk 全局输出所有权

日期：2026-08-04

## 审计结论

JunQi 以 Tauri command 播放 OpenClaw gateway-relay 传入的 PCM 帧。Rust 侧的 `PLAYBACK` 是进程级
单例，因此 Talk 的物理输出天然跨窗口共享。旧代码却只将 Talk speaking 投影到 `voiceStore`，没有接入
既有的 VoiceRuntime claim/release 协议。另一个窗口播放 Gateway TTS 或 assistant MEDIA 时，不会抢占
正在说话的 Talk PCM；反过来 Talk 也不会让其他窗口停止输出。

## 权威依据

- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md) 定义
  `talk.session.create`、`talk.event`、`talk.session.cancelOutput` 和 `talk.session.close`。
- [OpenClaw Talk Gateway handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/talk.ts)
  将 relay 输出和取消保持在 Gateway 拥有的会话内。
- JunQi `src-tauri/src/commands/voice_talk_playback.rs` 证明 PCM 播放队列由静态 `PLAYBACK` 持有，
  `voice_talk_stop_playback` 停止该共享 worker。

## 修复边界

Talk speaking 现在和 Gateway TTS、assistant MEDIA 一样声明跨 WebView 输出 claim。后到的 claim、用户
Stop 或其他本地输出先停止共享 PCM，并向 Talk 会话属主投递带 session scope 的 local interrupt；属主仅在
对应 Talk 仍处于 speaking 时复用既有协调器的 `interrupt()`。该协调器仍按原有顺序停止本地播放后调用
官方 `talk.session.cancelOutput`，不把本地停止或 RPC 发起误报为 Gateway 已取消。

输出结束时只释放仍由该 Talk 声明的 claim，避免旧 `output.audio.done` 或延迟 React effect 释放已经属于
后续 TTS、MEDIA 或 Talk 输出的全局占用。该调整不增加或修改 OpenClaw 的方法、字段、provider 或会话。

## 验证

- VoiceRuntime 定向回归覆盖 Talk claim 被新窗口 claim 抢占并停止共享 PCM；Talk 协调器回归覆盖
  只有 matching `sessionKey` 的 speaking 输出才会进入取消路径。
- Rust 回归覆盖 Stop 必须等待 worker acknowledgement；该回归不依赖真实音频设备。
- `pnpm lint`、`pnpm test`、`pnpm verify:openclaw-docs`、`cargo fmt -- --check`、
  `cargo check --lib`、`cargo test --lib` 与 `git diff --check` 已通过。Rust library tests 为
  707 passed、3 ignored；ignored 项需要外部模型夹具，不属于本次修改。

## 未验证边界

当前工作区没有连接真实 Gateway，未验证 provider 的取消时延或 Gateway relay 的真实多客户端行为。
自动化也不能替代 macOS、Windows、CentOS、Ubuntu 的 Tauri 打包应用在多窗口、设备热拔插、后台窗口与
休眠恢复下的音频验收。
