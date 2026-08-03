# OpenClaw 全局语音唤醒触发词对齐计划

日期：2026-08-03

## 顺序

- [x] 阅读项目根文档、既有语音审计、Settings Jarvis、Gateway client、模型验证和测试。
- [x] 核对 OpenClaw 官方 voicewake 文档、schema 与 handler，确认 trigger list 为 Gateway
  全局完整更新，且路由是独立协议。
- [x] 记录本地模型选择覆盖全局 trigger list 的数据完整性缺陷与跨客户端 CAS 边界。
- [x] 在纯关键词选择模块实现保留非本地模型 trigger 的合并与容量失败关闭。
- [x] 让 Settings 保存前读取当前 fenced Gateway 快照并仅提交合并结果。
- [x] 移除 Rust 注释中的版本绑定，保留官方协议上限。
- [x] 补充回归、更新验证记录、执行全量检查与中文提交。

## 文件范围

- `src/services/voice/VoiceWakeKeywordSelection.ts`
- `src/services/voice/VoiceWakeKeywordSelection.test.ts`
- `src/hooks/useJarvisVoiceSettings.ts`
- `src-tauri/src/commands/voice_wake_model.rs`
- `docs/quality/2026-08-02-cross-platform-voice-wake-host.md`
- 本审计、规格、计划及三层索引

## 不做的事情

- 不把 JunQi 本地模型、CPAL 采集或 Settings 缓存伪装成 OpenClaw 的全局触发词权威源。
- 不通过 `voicewake.routing.set` 猜测或改变会话路由。
- 不为跨客户端同时写入虚构 revision、CAS、锁、成功状态或重试结果。
- 不把未在 Windows、CentOS、Ubuntu 真机验收的常驻唤醒描述为 OpenClaw 原生支持。
