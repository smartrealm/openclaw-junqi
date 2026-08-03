# Cron 任务详情与运行回溯规格

日期：2026-08-03

## 目标行为

1. Cron Monitor 选中任务后，以当前 Gateway 的 `cron.get` 响应作为详情来源；列表快照失败时，
   页面必须显示不可用状态，不得伪造详情。
2. 运行历史使用 `cron.runs` 的 job scope 和分页响应。只接受官方 `action: "finished"` 记录，
   `status` 只能是 `ok`、`error` 或 `skipped`。
3. 点击立即运行后，先调用 `cron.run`，保存 Gateway 返回的 `runId`，再只查询该 `runId`。
   未找到终态前显示运行中，超时显示等待超时，不能用其他历史记录替代。
4. 详情投影不保留 cron payload 内容，避免将命令参数、环境变量或消息正文扩散到页面状态。

## 验收条件

- `cron.get`、`cron.runs`、`cron.run` 参数与 OpenClaw `2026.7.1-2` 官方 schema 一致。
- malformed response、缺失 runId、不同 runId 的历史记录和等待超时均有失败或明确不可用语义。
- 单元测试在删除精确 runId 过滤或恢复“最近记录”逻辑时失败。
- 真实 Gateway 与目标操作系统验收边界在验证记录中明确列出。
