# OpenClaw 原生任务账本对齐计划

## 执行顺序

1. 修复 BUG-TASK-01：将 `tasks.cancel` 从管理员临时连接收回到现有日常 write lane。
2. 修复 BUG-TASK-02 与 BUG-TASK-04：按官方 `tasks.ts` 重写 task decoder、request validator 和
   capability advertisement 处理。
3. 修复 BUG-TASK-03：新增 store 和活动中心独立任务账本面板，支持 list、lazy detail、分页和
   Gateway 确认后的取消。
4. 更新三种 locale 与 docs/spec/plan 索引。
5. 添加协议、权限、字段、分页、取消和 store 竞态回归测试，运行全量验证。

## 文件范围

- `src/services/gateway/OpenClawTaskLedgerClient.ts`
- `src/services/gateway/OpenClawTaskLedgerClient.test.ts`
- `src/services/gateway/index.ts`
- `src/stores/openclawTaskLedgerStore.ts`
- `src/stores/openclawTaskLedgerStore.test.ts`
- `src/components/Activity/OpenClawTaskLedgerPanel.tsx`
- `src/pages/ActivityCenter.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- `docs/README.md`
- `specs/README.md`
- `plans/README.md`
- `docs/quality/openclaw-native-task-ledger-alignment-2026-08-03.md`
- `specs/quality/2026-08-03-openclaw-native-task-ledger.md`
- `plans/quality/2026-08-03-openclaw-native-task-ledger.md`

## 完成判据

- [x] 所有 task RPC 使用官方方法、参数、权限和 capability semantics。
- [x] decoder 覆盖官方公开 `TaskSummary` 字段且不私自规范化字符串。
- [x] 活动中心将 Gateway task ledger 与本地任务独立展示，支持 detail、pagination 和确认取消。
- [x] 未广告、断线、加载、错误和否定取消结果均有真实状态。
- [x] 回归测试、TypeScript、完整测试、构建、官方链接校验、diff 检查和 Emoji 扫描通过。
