# OpenClaw 原生会话组写入对齐计划

1. [x] 核对当前官方 schema、Gateway handler、Control UI group catalog 与 JunQi 分类、Jarvis 唤醒链路。
2. [x] 扩展 group client，严格实现目录追加及 Gateway 响应确认。
3. [x] 将手动分类和 Jarvis 唤醒归属接入同一原生目录确认编排。
4. [x] 补充回归、质量记录和索引。
5. [x] 执行完整验证并以中文提交。

## 文件范围

- `src/services/gateway/OpenClawSessionGroupsClient.ts`
- `src/services/gateway/OpenClawSessionGroupsClient.test.ts`
- `src/services/gateway/index.ts`
- `src/stores/chatStore.ts`
- `src/components/Chat/message-input/useComposerVoice.ts`
- `src/stores/chatStore.test.ts`
- `docs/quality/openclaw-session-group-mutations-alignment-2026-08-04.md`
