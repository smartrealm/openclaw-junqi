# OpenClaw Stop 发送中状态围栏计划

日期：2026-08-04

## 执行顺序

- [x] 核对官方 `sessions.abort` 语义、Run 确认、聊天状态和所有
  Composer Stop 入口。
- [x] 证实语音 Stop 与 Escape 触发条件遗漏 `sendingBySession`。
- [x] 在 Chat Store 增加无副作用的活动请求判定，并替换重复状态组合。
- [x] 补充发送中语音 Stop 和 Escape 的行为回归。
- [x] 执行全量验证、Emoji 与无引用扫描，更新记录并使用中文提交。

## 文件范围

- `src/stores/chatStore.ts`
- `src/stores/chatStore.test.ts`
- `src/components/Chat/message-input/useComposerVoice.ts`
- `src/components/Chat/message-input/useComposerInterruption.ts`
- `src/components/Chat/message-input/useComposerVoice.test.ts`
- `src/components/Chat/message-input/useComposerInterruption.test.ts`
- 本规格、计划、审计记录及三层索引

## 非目标

- 不修改 Gateway 协议、Tauri command 或 Rust 后端。
