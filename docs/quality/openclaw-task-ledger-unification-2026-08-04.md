# OpenClaw 任务账本唯一链路收敛

## 结论

活动中心此前同时渲染两个原生任务账本面板，分别通过两个 adapter 和状态管理链路读取同一 `tasks.*` RPC。旧链路使用管理员连接、写死取消 reason，并接受当前稳定 schema 未定义的字段；这会制造重复轮询、双重取消入口和不一致的权限语义。

现行链路统一为 `OpenClawTaskLedgerClient`、Gateway facade、`openclawTaskLedgerStore` 和 `OpenClawTaskLedgerPanel`。列表、详情、分页和取消仍由 Gateway 唯一确认；JunQi 不创建或合成本地任务记录。

## 当前协议更新

本地官方 OpenClaw 工作树更新后，`TaskSummary` 已增加 `toolUseCount`、`lastToolName`、`deliveryStatus`、`terminalOutcome`，并由 `tasks.get` 返回 lookup-only `prompt` 与 `result`。`tasks.retry` 和 `tasks.dismiss` 是 `2026.7` 的 `operator.write` 增量 RPC：它们只恢复或确认不投递已阻塞的子智能体完成结果，不创建或重跑任务。

JunQi 因此将账本请求切换到经认证连接身份的 `requestFenced`；连接断开或切换时，请求不会发送或采纳旧 Gateway 的结果。列表与取消快照仍拒绝详情专属字段，恢复结果则按官方 handler 返回的详情快照解析。活动中心只在官方 `deliveryStatus=failed` 与 `terminalOutcome=blocked` 同时成立时显示恢复操作，并在重试前明确告知官方记录的重复可见结果风险。

官方 `docs/gateway/protocol.md` 当前仍只描述 `list/get/cancel` 的较早任务账本章节。按仓库规范，本次以同一官方工作树中可复现的 protocol schema、核心方法注册、handler 和 CLI/子智能体文档为行为依据，并记录该差异。

## 验证结果

- 已通过：`node --import ./test-setup.ts --import tsx --test src/services/gateway/OpenClawTaskLedgerClient.test.ts src/stores/openclawTaskLedgerStore.test.ts`，17 项回归测试通过。
- 已通过：`pnpm lint`、`pnpm test`、`pnpm test:rust`（709 通过、0 失败、3 跳过）、`pnpm build` 与 `pnpm verify:openclaw-docs`。
- 已通过：三份语言包 JSON 校验、`git diff --check` 与本次修改完整文件的 Emoji 扫描。

## 未验证边界

真实 Gateway 的 schema 与 handler 演进，以及 macOS、Windows、CentOS、Ubuntu 真机中的任务列表、取消、阻塞投递恢复和辅助功能验收仍待执行。
