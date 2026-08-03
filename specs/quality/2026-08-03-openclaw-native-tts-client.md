# OpenClaw 原生 TTS 客户端对齐规格

日期：2026-08-03

## 问题

JunQi 的自动语音回复调用本地 `speechSynthesis`，而 OpenClaw 已拥有正式 Gateway TTS 契约。这使 JunQi 偏离 OpenClaw 的 provider、Secret、权限和错误权威。

## 目标

将自动语音回复改为 OpenClaw `tts.speak` 的桌面呈现，保留现有 VoiceRuntime 队列和中断协议，不新增本地或第三方 TTS 运行时。

## 契约与约束

1. 客户端仅发送 `{ text }`，其中 `text` 必须是非空字符串；不得添加 provider、voice、路径或版本推断字段。
2. 仅接受 `audioBase64` 和 `provider` 均为非空字符串的响应；`mimeType` 缺失、为空或非字符串时不可播放。
3. 未知响应字段可保留但不参与业务判断；不得补造 audio、provider 或 MIME。
4. Stop 使用 `AbortSignal` 取消本地等待，并停止当前音频元素；它不代表 Gateway 合成任务已被远端取消。
5. 任何失败都不得回退到系统 `speechSynthesis`、浏览器网络服务、LiveKit、WebRTC 或本地模拟音频。
6. Tauri WebView 只能播放 Gateway 已合成的内联音频。播放失败必须进入 VoiceRuntime 的真实错误状态。
7. 保留既有跨 WebView claim/release、会话作用域中断和队列代际防陈旧语义。

## 验收条件

- `OpenClawTtsClient` 只调用 `tts.speak`，并严格拒绝无效请求和无效响应。
- VoiceRuntime 在自动朗读启用时通过该 client 合成，而源码不再引用 `SpeechSynthesisUtterance` 或 `speechSynthesis`。
- 中断当前会话时，未完成的 Gateway 等待被本地中止，旧响应不得开始新播放。
- 有效 Gateway 音频开始、结束、失败与手动 Stop 能正确投影到既有 speaking/idle/error 状态及跨窗口控制协议。
- 旧的本地系统朗读行为不能作为成功或回退路径出现。
- 文档记录本机自动化、真实 Gateway、macOS、Windows、CentOS、Ubuntu 的验证边界。

## 当前验证

- Gateway client、Gateway 音频输出与 VoiceRuntime 定向回归 18 项通过。
- `pnpm lint`、`pnpm test`、`pnpm verify:openclaw-docs`、`pnpm collab:test`、`pnpm collab:validate` 和带当前本机 OpenClaw CLI 的生产构建通过。
- 尚未完成真实 Gateway TTS provider、Secret、权限与目标操作系统音频设备验收；这些不是自动化通过可以替代的范围。
