# OpenClaw 原生会话组写入对齐计划

1. [x] 核对官方 schema、Gateway handler、Control UI group catalog 与 JunQi 会话整理链路。
2. [x] 严格实现目录读取、追加、改名、删除及 Gateway 响应确认。
3. [x] 让手动会话分类复用 Gateway 拥有的目录与 category 编排。
4. [x] 从 Voice Wake 和 Jarvis Talk 移除自动分组、前缀识别及 category 副作用。
5. [ ] 执行相关回归、完整验证与最终差异审查。

## 文件范围

- `src/services/gateway/OpenClawSessionGroupsClient.ts`
- `src/services/gateway/OpenClawSessionGroupsClient.test.ts`
- `src/stores/chatStore.ts`
- `src/pages/SessionManager.tsx`
- `docs/quality/openclaw-session-group-mutations-alignment-2026-08-04.md`
