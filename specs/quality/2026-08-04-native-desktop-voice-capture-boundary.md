# 原生桌面语音采集边界规格

日期：2026-08-04

## 当前行为

在听写模式下，`useVoiceWake` 会优先使用 WebView `SpeechRecognition`；仅在该能力不存在或失败时才启动原生 VAD。该分支使桌面输入路径依赖浏览器能力，并保留了与原生音频草稿不同的文本注入语义。

## 目标行为

1. JunQi 本地语音采集只经 Tauri `voice_wake_start` 与 `voice_wake_stop`。
2. 每次启动必须显式绑定 `dictation` 或 `wake_word`、PCM 请求和非空 listener owner。
3. 原生 VAD 只产出 PCM 或确认后的 WAV 草稿；不能用 Web Speech 转写文本作为隐式回退。
4. 关键词、VAD、会话身份与 Talk relay 的既有围栏保持不变。
5. Gateway 能力继续以官方 `voicewake.*` 和 `talk.*` 协议为准，JunQi 不根据 WebView 能力推断 OpenClaw 功能。
6. 官方 `transcription` relay 的 `g711_ulaw/8000` 输入未与当前原生 `pcm16/24000` 采集契约协商一致时，必须保持不可用，不得自动转发或伪造转写。

## 验收条件

- `VoiceWakeOptions` 不包含浏览器识别专用的文本回调或语言参数。
- 原生启动请求会拒绝空 owner，并精确保留模式与 PCM 标志。
- 打断策略仍只接受非空关键词作为助手输出期间的语音打断证明。
- `pnpm lint`、相关测试、`pnpm build`、`pnpm verify:openclaw-docs` 与 `git diff --check` 通过。

## 非目标

- 不新增 OpenClaw RPC、浏览器 WebRTC、Provider WebSocket、Web Speech、系统语音或本地伪造转写。
- 不在本次接入官方 transcription relay 或自定义音频格式转换。
- 不声明 Windows、CentOS、Ubuntu 或 macOS 已完成真实设备验证。
