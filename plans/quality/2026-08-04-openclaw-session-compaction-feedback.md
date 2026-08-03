# OpenClaw 会话压缩异步反馈计划

日期：2026-08-04

## 执行顺序

- [x] 核对安装版官方 CLI、方法权限、已有 compaction client、Dashboard 和命令面板。
- [x] 记录 COMPACT-01 审计、规格、当前行为与未验证边界。
- [x] 在严格解码器中保留官方 pending 线索，并建立共享结果分类器。
- [x] 让 Dashboard 和命令面板消费共享分类，新增三种语言的 pending 文案。
- [x] 添加解码和分类行为回归，执行完整验证、无引用代码与 Emoji 扫描，更新既有压缩
  对齐记录并中文提交。

## 文件范围

- `src/services/gateway/OpenClawSessionCompactionClient.ts`
- `src/services/gateway/OpenClawSessionCompactionClient.test.ts`
- `src/services/gateway/sessionCompactionFeedback.ts`
- `src/services/gateway/sessionCompactionFeedback.test.ts`
- `src/pages/Dashboard/index.tsx`
- `src/components/CommandPalette.tsx`
- `src/locales/{en,zh,zh-TW}.json`
- 对应 `docs/`、`specs/`、`plans/` 索引及压缩对齐记录

## 非目标

- 不创建 JunQi 本地 compaction job、超时、取消或完成状态机。
- 不将 `result.details` 的其他字段变成客户端契约。
- 不改变 `sessions.compact` 的权限、请求字段、Gateway transcript 或 checkpoint 行为。
