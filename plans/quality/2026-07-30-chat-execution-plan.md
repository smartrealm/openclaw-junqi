# Chat 执行计划实施计划

日期：2026-07-30

## 实施顺序

1. 在独立领域模块中定义计划状态、步骤、快照解析、稳定身份和摘要选择器。
2. 为合法、非法、重复和修订快照补充回归测试。
3. 扩展 SemanticBlock 与 RenderBlock，使计划成为独立语义，不进入普通工具分组。
4. 在响应组投影阶段归并多个快照，只输出最新 revision。
5. 新增 Chat 计划卡，支持折叠、长标题、修订说明和可访问性。
6. 在 Gateway 实时工具消息中保留 `seq`，并验证历史恢复一致性。
7. 补充三语言文案和文档索引。
8. 在连接设置中增加 OpenClaw 计划工具三态配置，并用官方配置 RPC 持久化。

## 文件范围

- `src/agent-execution-plan/`
- `src/types/SemanticBlock.ts`
- `src/types/RenderBlock.ts`
- `src/processing/buildSemanticBlocks.ts`
- `src/processing/projectResponseGroup.ts`
- `src/components/Chat/ExecutionPlanCard.tsx`
- `src/components/Chat/ChatView.tsx`
- `src/services/gateway/ChatHandler.ts`
- `src/services/gateway/OpenClawPlanToolSettings.ts`
- `src/hooks/useOpenClawPlanToolSetting.ts`
- `src/components/settings/StructuredPlanSettingsPanel.tsx`
- `src/stores/chatStore.ts`
- `src/locales/{zh,zh-TW,en}.json`

## 验证

```bash
node --import ./test-setup.ts --import tsx --test src/agent-execution-plan/*.test.ts src/processing/projectResponseGroup.test.ts
pnpm lint
pnpm test
pnpm build
git diff --check
```

真实 Tauri 验收仍需覆盖实时计划更新、会话切换、历史恢复、应用重启、窄窗口和四套主题。
