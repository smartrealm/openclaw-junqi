# OpenClaw 原生会话压缩对齐计划

日期：2026-08-04

## 实施顺序

1. 核对官方 `sessions.compact` schema、handler、权限和 compaction 语义。
2. 新增严格的 Gateway compaction client，保留官方 `ok/key/compacted/reason` 语义。
3. 将 Dashboard、命令面板和现有 Gateway facade 切换到 admin-scoped native RPC。
4. 补充请求、响应、no-op、授权失败和 UI 反馈回归测试，更新三层文档。
5. 执行 lint、定向测试、全量测试、构建、官方链接、差异和禁止字符检查。

## 文件范围

- `src/services/gateway/OpenClawSessionCompactionClient.ts`
- `src/services/gateway/OpenClawSessionCompactionClient.test.ts`
- `src/services/gateway/index.ts`
- `src/pages/Dashboard/index.tsx`
- `src/components/CommandPalette.tsx`
- `src/pages/Dashboard/dashboardInteraction.test.ts`
- `src/locales/{en,zh,zh-TW}.json`
- 对应 `docs/`、`specs/`、`plans/` 索引和对齐记录

## 不做的事情

- 不在 JunQi 侧实现摘要、memory flush、活动运行排空或 transcript 写入。
- 不把 `operator.admin` 加入日常 Gateway socket。
- 不把 RPC 返回或本地超时当作自动取消、自动恢复或工具结果。
