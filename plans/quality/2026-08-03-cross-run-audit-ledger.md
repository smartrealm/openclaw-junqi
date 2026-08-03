# 跨运行审计账本实施计划

日期：2026-08-03

## 文件范围

- `src/services/gateway/auditLedger.ts`：保留单响应 runId 强约束，新增无 runId 的官方跨运行查询出口。
- `src/services/gateway/auditLedger.test.ts`：覆盖 kind/status/cursor 查询参数。
- `src/hooks/useGatewayAuditLedger.ts`：实现连接状态、刷新、可见页面轮询、生成代际和 cursor 分页。
- `src/components/Activity/GatewayAuditLedgerPanel.tsx`：活动中心只读审计展示与筛选。
- `src/pages/ActivityCenter.tsx`：挂载审计区。
- `src/locales/en.json`、`src/locales/zh.json`、`src/locales/zh-TW.json`：同步 UI 资源。
- `docs/quality/openclaw-cross-run-audit-ledger-2026-08-03.md`、`specs/quality/2026-08-03-cross-run-audit-ledger.md`：记录依据、目标、验证和边界。

## 顺序

1. 先实现 service 的无 runId 查询出口，保持原有 Chat 查询契约不变。
2. 增加 hook 的刷新、筛选重置和 Gateway cursor 分页。
3. 在 Activity Center 展示 metadata-only 事件和不可用状态。
4. 补齐三语文案与专项测试。
5. 运行定向测试、TypeScript、lint、边界检查、完整测试、生产构建和差异检查。

## 完成门禁

- 不新增 Gateway scope，不调用未核实 RPC。
- 不持久化审计 payload，不显示 prompt、消息、工具参数或原始错误。
- 真实 Gateway 数据、账本启用状态和人工视觉验收作为未验证边界记录。
