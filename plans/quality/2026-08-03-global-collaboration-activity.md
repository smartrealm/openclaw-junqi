# 全局协作 Activity 实施计划

1. 从协作历史抽屉提取唯一 Needs You 纯投影函数，并保留 summary/snapshot revision 约束。
2. 在应用级 runtime 绑定已验证 Gateway/runtime identity，读取全局 runs、tombstones，并按 15 秒周期和 changed hint 刷新。
3. 将协作待决项合并到 Activity Center 的现有活动条目和 attention 过滤；保留 session、workspace、Gateway task ledger 和 approval 原有边界。
4. 通过带真实 runId 的 Chat 查询参数打开协作详情，消费后移除参数，避免刷新重复打开。
5. 补充文档索引、投影回归测试、TypeScript、边界检查、完整测试和生产构建。

## 文件范围

- `src/utils/collaborationNeedsYou.ts`
- `src/components/Collaboration/CollaborationHistoryDrawer.tsx`
- `src/components/Collaboration/CollaborationActivityRuntime.tsx`
- `src/AppRoutes.tsx`
- `src/pages/ActivityCenter.tsx`
- `src/components/Chat/CollaborationChatProvider.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 对应 `docs/quality`、`specs/quality` 和索引文件
