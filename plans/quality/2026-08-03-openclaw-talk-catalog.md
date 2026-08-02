# OpenClaw Talk 能力目录对齐计划

日期：2026-08-03

## 实施顺序

1. 对照 OpenClaw 官方 Talk 文档、schema、handler 和 JunQi 的 native 音频边界，确认目录真实形状。
2. 重写 Talk catalog decoder，保留官方 group/provider 结构和可选能力，不添加版本开关或默认能力。
3. 让 relay provider 选择同时校验 Gateway readiness、传输、brain、barge-in 以及 native PCM 输入输出格式。
4. 用官方目录形状补充客户端和 decoder 回归测试，覆盖缺失能力和旧形状拒绝。
5. 更新跨平台语音审计、规格和索引，记录真实 Gateway 与目标平台未验证边界。

## 文件范围

- `src/services/gateway/talkTypes.ts`
- `src/services/gateway/TalkGatewayClient.test.ts`
- `src/services/gateway/talkTypes.test.ts`
- `docs/quality/2026-08-03-openclaw-talk-catalog-alignment.md`
- `specs/quality/2026-08-03-openclaw-talk-catalog.md`
- `plans/quality/2026-08-03-openclaw-talk-catalog.md`
- `docs/quality/2026-08-02-cross-platform-voice-wake-host.md`
- `AGENTS.md` 与对应索引

## 完成判据

目录解析、relay 选择、回归测试和文档必须引用官方当前契约；真实 Gateway、Windows、CentOS、Ubuntu 和不同音频设备的验证另行记录，不能由本机 TypeScript 测试代替。
