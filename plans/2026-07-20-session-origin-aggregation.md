# 会话来源聚合执行计划

## 执行顺序

| 阶段 | 问题 | 文件 | 调整 |
| --- | --- | --- | --- |
| A | BUG-SESS-02 | `src/App.tsx`、`src/stores/chatStore.ts` | 保留 Gateway 官方来源与运行字段 |
| B | BUG-SESS-03 | `src/utils/sessionPresentation.ts` | 建立统一分类与聚合模型 |
| C | BUG-SESS-01 | `src/components/Layout/NavSidebar.tsx` | 普通会话与后台活动分区展示 |
| D | BUG-SESS-03 | `src/services/gateway/ChatHandler.ts`、`src/pet/usePetStateEmitter.ts` | 复用统一隔离规则 |
| E | 全部 | 聚焦测试与生产构建 | 验证分类、聚合、清理与类型契约 |
