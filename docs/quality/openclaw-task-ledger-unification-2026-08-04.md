# OpenClaw 任务账本唯一链路收敛

## 结论

活动中心此前同时渲染两个原生任务账本面板，分别通过两个 adapter 和状态管理链路读取同一 `tasks.*` RPC。旧链路使用管理员连接、写死取消 reason，并接受当前稳定 schema 未定义的字段；这会制造重复轮询、双重取消入口和不一致的权限语义。

现行链路统一为 `OpenClawTaskLedgerClient`、Gateway facade、`openclawTaskLedgerStore` 和 `OpenClawTaskLedgerPanel`。列表、详情、分页和取消仍由 Gateway 唯一确认；JunQi 不创建或合成本地任务记录。

## 契约差异

当前稳定 `TaskSummary` schema 不包含 `toolUseCount`、`lastToolName` 或 `prompt`。当前 Gateway handler 的 `tasks.get` 明确传入 `includePrompt: true`，因此仅详情解析可以接受 `prompt`。列表和取消快照仍拒绝该字段及任何未知字段，避免将 handler 的详情扩展误用为稳定列表契约。

## 验证结果

- 已通过：`node --import ./test-setup.ts --import tsx --test src/services/gateway/OpenClawTaskLedgerClient.test.ts src/stores/openclawTaskLedgerStore.test.ts`，12 项回归测试通过。
- 已通过：`pnpm exec tsc --noEmit`、三份语言包的 `jq empty`、遗弃任务账本链路引用扫描与 `git diff --check`。
- 已通过：`pnpm lint`、`pnpm test`（2743 项通过）、`pnpm build` 与 `pnpm verify:openclaw-docs`。

## 未验证边界

真实 Gateway 的 schema 与 handler 演进，以及 macOS、Windows、CentOS、Ubuntu 真机中的任务列表、取消和辅助功能验收仍待执行。
