# OpenClaw 原生 TTS 客户端对齐计划

日期：2026-08-03

## 实施顺序

1. 核对官方 `tts.speak` 文档、schema、handler、权限与当前 VoiceRuntime 入口。
2. 新建严格的 Gateway TTS client，校验请求与响应，并保留 `AbortSignal` 到 Gateway connection。
3. 将 VoiceRuntime 的本地系统朗读替换为可停止的内联音频播放适配器；保持原有队列、generation 与跨窗口 claim/release。
4. 补充 client decoder、请求中止、陈旧响应、播放失败和 Stop 的行为回归测试。
5. 运行定向测试、TypeScript、lint、完整前端测试、构建和 diff 检查；记录未完成的真实 Gateway 与跨平台实测。

## 文件范围

- `src/services/gateway/OpenClawTtsClient.ts`
- `src/services/gateway/OpenClawTtsClient.test.ts`
- `src/services/gateway/index.ts`
- `src/services/voice/VoiceRuntime.ts`
- `src/services/voice/VoiceRuntime.test.ts`
- `docs/quality/openclaw-native-tts-client-alignment-2026-08-03.md`
- `specs/quality/2026-08-03-openclaw-native-tts-client.md`
- `plans/quality/2026-08-03-openclaw-native-tts-client.md`
- 相关索引

## 非目标

- 不修改 Gateway TTS 配置、provider、Secret 或安装版本。
- 不新增本地 TTS 引擎、浏览器网络服务、LiveKit 或 WebRTC 回退。
- 不声称已经完成真实 Gateway、签名发布包或目标操作系统验收。

## 执行结果

1. 已核对官方文档、schema 与 handler，确认 `tts.speak` 是带 `operator.write` 的内联音频 RPC。
2. 已实现严格 Gateway client，并将 `AbortSignal` 传入既有 Gateway connection 本地取消路径。
3. 已以 Gateway 音频输出替换系统文本合成，保留队列、generation、跨窗口 claim/release 和会话级 Stop。
4. 已补充行为回归并完成项目级静态检查、测试、官方链接校验、协作包校验和生产构建。
5. 真实 Gateway 与 macOS、Windows、CentOS、Ubuntu 音频验收仍保持为后续明确验证项。
