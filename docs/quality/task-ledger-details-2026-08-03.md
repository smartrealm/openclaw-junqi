# Gateway Task Ledger 详情对齐

日期：2026-08-03

## 依据

本机安装的 OpenClaw `2026.7.1-2 (0790d9f)` 随包
`docs/gateway/protocol.md` 明确提供 `tasks.get`：要求 `operator.read`，接收
`{ taskId }`，返回 `{ task: TaskSummary }`。原生控制台的任务页也在列表之外按任务读取
该详情，用于查看时间、交付状态、错误和终态摘要。

## 发现的问题

JunQi 活动中心此前只调用 `tasks.list` 和 `tasks.cancel`。列表展示的是受限摘要，用户无法
确认单个任务的完整运行上下文；继续依赖列表字段会把“没有返回”误认为“没有状态”。

## 当前行为

- 每个 Gateway task ledger 条目提供可展开的详情 icon。
- 展开时通过普通 `operator.read` 连接调用 `tasks.get`，严格校验 `TaskSummary`。
- 详情只显示协议已定义的身份、运行时、Agent、会话、流程、时间、进度、终态摘要和错误字段。
- 单个任务读取失败只影响该任务的详情区域，已加载列表和其他任务不被清空。
- 详情只保存在当前页面内存，不写入本地持久化或协作账本。

## 验证结果

- `src/services/gateway/taskLedger.test.ts`：5 项通过，包含 `tasks.get` envelope、参数和 malformed response。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- `pnpm test`：前端 2373 项、脚本 234 项全部通过。
- `pnpm lint`：通过；模块边界检查覆盖 802 个文件。
- `pnpm build`：通过，Vite 完成 9144 个模块，协作插件 bundle 校验通过。
- `git diff --check`：通过；修改和新增内容的尾随空白、Emoji 扫描无命中。

## 未验证边界

- 未在真实 Gateway 上验证当前用户的 `operator.read` scope 和 not-found 错误响应。
- 未在 Windows、macOS、Linux 真机上执行窄窗口和真实任务字段组合的视觉验收。
- `tasks.audit`、`tasks.maintenance` 和 Task Flow 仍未接入，需另行立项。
