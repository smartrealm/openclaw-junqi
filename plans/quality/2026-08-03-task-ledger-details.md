# Gateway Task Ledger 详情实施计划

日期：2026-08-03

## 文件范围

- `src/services/gateway/taskLedger.ts`：增加 `tasks.get` 参数构造、返回解析和严格类型。
- `src/services/gateway/taskLedger.test.ts`：覆盖 envelope、任务 ID 和 malformed response。
- `src/hooks/useGatewayTaskLedger.ts`：增加按任务读取、展开状态、缓存和失败隔离。
- `src/components/Activity/GatewayTaskLedgerPanel.tsx`：增加任务详情展开入口和字段呈现。
- `src/locales/en.json`、`src/locales/zh.json`、`src/locales/zh-TW.json`：同步详情文案。
- 对应 `docs/quality`、`specs/quality` 和索引文件。

## 顺序

1. [x] 先按当前 OpenClaw 官方协议实现 service 层 `tasks.get`。
2. [x] 在 task ledger hook 中只用普通 operator.read 连接读取详情，隔离单任务失败。
3. [x] 在活动中心以行内展开呈现已验证的 TaskSummary 字段。
4. [x] 补充回归测试、三语资源和文档验收记录。
5. [x] 运行定向测试、TypeScript、lint、边界检查、完整测试、生产构建和差异检查。

## 完成门禁

- 不新增 Gateway scope，不调用未核实 RPC。
- 不持久化任务详情，不展示未经协议确认的原始 payload。
- 真实 Gateway 权限、任务删除竞态和目标平台视觉验收作为未验证边界记录。
