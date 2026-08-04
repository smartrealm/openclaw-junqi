# JunQi 原生桌面语音采集边界

日期：2026-08-04

## 权威依据

- OpenClaw 官方源码 [Voice Wake 文档](https://github.com/openclaw/openclaw/blob/main/docs/nodes/voicewake.md) 规定：触发词与路由由 Gateway 持久化，客户端通过 `voicewake.get`、`voicewake.set` 和事件保持同步。
- OpenClaw 官方源码 [Talk 文档](https://github.com/openclaw/openclaw/blob/main/docs/nodes/talk.md) 将浏览器的 client-owned WebRTC 与 Gateway-owned `gateway-relay` 明确区分；后者不要求客户端打开浏览器 WebRTC 连接。
- 本机官方源码副本在本轮审查时为 `1e3880352e614116549c0a30c67a59a2d40ba259`；`docs/nodes/voicewake.md` 与上述文档一致，本次未以 `node_modules` 作为协议或能力依据。

## 问题

`useVoiceWake` 同时保留 WebView `SpeechRecognition` 和 Tauri 原生 CPAL 采集。听写模式在 WebView 暴露该 API 时优先使用浏览器识别，导致桌面常驻语音的实际输入后端随 WebView 能力变化；这与 JunQi 是桌面客户端、原生采集由 Rust 管理的边界不一致，也不能作为 Windows、CentOS 或 Ubuntu 的可用性证明。

## 修复

1. 删除 Web Speech 类型、识别器、重启计时器和回调路径。
2. `dictation` 与 `wake_word` 均通过带 `ownerId` 的 `voice_wake_start` Tauri command 启动；Rust CPAL 负责设备采集，Wake Word 使用本地 Sherpa-ONNX，VAD 负责听写切段。
3. 移除只服务于浏览器识别的文本回调和语言参数。原生 VAD 的 WAV 继续进入现有确认草稿；满足 OpenClaw `talk.catalog` 能力门禁时，PCM 继续进入官方 `talk.session.*` Gateway relay。
4. 启动参数通过 `NativeVoiceWakeStartRequest` 进行严格构造，模式、PCM 请求和 listener owner 都必须显式存在；空 owner 在进入 Tauri IPC 前失败。

## 保持不变

- Gateway 的 `voicewake.*` 触发词和路由权威、当前会话身份围栏、Jarvis category、Talk relay、barge-in、Stop 和普通文本会话均未改变。
- JunQi 不创建 browser-owned WebRTC、Provider WebSocket、Web Speech 或系统语音回退。
- OpenClaw 没有为 Windows、CentOS、Ubuntu 的 JunQi 常驻唤醒提供原生认证承诺。CPAL 的跨平台构建路径不等于目标平台真机可用；麦克风权限、托盘、登录启动、睡眠恢复和前台恢复仍须分别验证。

## 上游更新复核

当前官方 Talk 文档增加了 `transcription` Gateway relay：它使用
`talk.session.create({ mode: 'transcription', transport: 'gateway-relay', brain: 'none' })`，并以
`transcript.delta`、`transcript.done` 传递转写结果。JunQi 已能严格解码该目录和事件枚举，但当前
Rust worker 为 realtime relay 发出 `pcm16/24000/mono`；官方 transcription relay 当前要求
`g711_ulaw/8000` 输入。两条媒体契约不兼容，因此本次不把本地 VAD 的 PCM 接入 transcription
relay，也不把 WAV 草稿伪装成原生实时转写。

后续仅在 Gateway catalog 声明与原生采集可验证协商到同一音频格式，并为该格式补齐端到端测试时，才可增加 transcription relay。该改动必须保持连接、会话、取消和最终转写事件的围栏。

## 验证

- `voiceWakeContract.test.ts` 覆盖原生启动请求的模式、PCM 与 owner 绑定，并拒绝空 owner。
- `VoiceWakeBargeInPolicy.test.ts` 覆盖关键词打断与无关键词 VAD 抑制。
- 定向 TypeScript、语音接收门和 composer 语音回归通过。

## 未验证边界

- 本次没有在 Windows、CentOS、Ubuntu 或真实 macOS 安装包上执行麦克风、后台常驻、睡眠恢复和焦点恢复验收。
- 本次没有连接真实 Gateway 验证 `voicewake.changed`、`talk.catalog` 与 PCM relay 的端到端时序。
