# OpenClaw 原生 TTS 客户端对齐

日期：2026-08-03

## 审计结论

JunQi 是 OpenClaw Gateway 的桌面客户端，不拥有另一套文本合成服务。此前“自动语音回复”直接使用 WebView 的 `speechSynthesis`，因而绕开 Gateway 的 TTS provider 选择、Secret 可用状态、最大文本长度与结构化错误语义。这会使同一 OpenClaw 会话在不同 JunQi 主机上产生不同的本地系统语音，且无法如实显示 Gateway 的 TTS 不可用状态。

当前 OpenClaw 官方协议提供 `tts.speak`。该方法以非空 `text` 作为唯一请求字段，使用 Gateway 已配置的通用 TTS provider 链合成，并返回内联 `audioBase64`、`provider` 与可选音频元数据。该方法要求 `operator.write`，不会返回 Gateway 本地文件路径。JunQi 应将既有句子队列逐项提交给该方法，再播放返回的音频；不再将 WebView 系统语音作为回退。

## 权威依据

- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [OpenClaw TTS Gateway handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/tts.ts)
- [OpenClaw Gateway protocol schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/channels.ts)

官方 schema 将 `tts.speak` 请求限定为 `{ text: NonEmptyString }`。响应要求非空 `audioBase64` 与 `provider`；`outputFormat`、`mimeType`、`fileExtension` 可选。官方 handler 在文本为空或超过 Gateway 配置的 `tts.maxTextLength` 时返回 `INVALID_REQUEST`，provider 或 Secret 不可用时返回 `UNAVAILABLE`。

## 目标行为

- 自动语音回复保留现有的句子切分、跨窗口全局播放占用、会话级 Stop 和 barge-in 状态机。
- 每个待播放句子都经 `tts.speak` 请求 Gateway；客户端只接受严格解码后的内联音频结果。
- 发送请求时附加 `AbortSignal`。Stop、会话中断、连接切换或窗口销毁只中止本地等待和播放，不把本地取消伪称为 Gateway 已取消合成。
- 只有 Gateway 提供明确的 `mimeType` 时才在 Tauri WebView 播放返回的二进制音频。WebView 在此仅为桌面渲染层的音频解码器，不参与文本合成、provider 选择或任何网络回退。
- Gateway 请求失败、权限不足、连接断开、响应畸形或缺少可播放 MIME 时显示真实错误并停止该语音队列；不得回退到 `speechSynthesis`、第三方网页 TTS、本地假音频或猜测格式。

## 跨平台边界

Gateway 负责 TTS 合成与凭据，JunQi 负责在当前 Tauri WebView 内播放 Gateway 返回的音频。该边界对 macOS、Windows、CentOS 和 Ubuntu 一致，不要求每个平台安装本地语音引擎。不同平台 WebView 的具体解码器与自动播放策略仍需用真实 Tauri 安装包验证；客户端不以当前操作系统、浏览器特征或 OpenClaw 安装版本决定能力。

## 验证结果

- 新增 Gateway TTS client、音频输出适配器与 VoiceRuntime 定向回归共 18 项通过，覆盖严格响应解码、MIME 缺失、请求中止、队列、会话级 Stop、错误投影和跨窗口抢占。
- `pnpm lint` 通过，包含模块边界、发布版本一致性和 TypeScript 严格检查。
- `pnpm test` 通过。
- `pnpm verify:openclaw-docs` 通过，核验 55 个官方链接及锚点。
- `pnpm collab:test` 与 `pnpm collab:validate` 通过。
- `OPENCLAW_BIN=/Users/wei/.npm-global/bin/openclaw pnpm build` 通过；该 CLI 报告版本为 `2026.7.1-2`，只作为本机构建复现证据，不作为客户端能力开关。
- `git diff --check` 通过，构建没有产生 provider catalog 或协作制品额外差异。

## 未验证边界

- 当前工作区未连接真实 Gateway，尚未验证 `operator.write` 授权、provider/Secret 失败和实际音频响应。
- 尚未在 macOS、Windows、CentOS、Ubuntu 的 Tauri 打包应用中验证 MIME 覆盖面、后台窗口播放、Stop 时延和设备切换。
- `tts.speak` 返回整段音频，不是流式协议；首音延迟与长回复体验应由真实 provider 测量，不能由前端单元测试推断。
