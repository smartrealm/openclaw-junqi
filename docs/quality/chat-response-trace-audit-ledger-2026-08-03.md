# Chat 响应追溯与 OpenClaw 审计账本

日期：2026-08-03

## 依据

- 当前安装的 OpenClaw `2026.7.1-2` 官方文档 `docs/cli/audit.md` 与 `docs/gateway/protocol.md`。
- `audit.list` 要求 `operator.read`，结果为有界的 `AuditEvent[]`，并明确标记 `redaction: "metadata_only"`。
- 审计账本不保存 prompt、消息、工具参数、工具结果、命令输出或原始错误文本；它不能替代 transcript、任务历史、Cron 历史或日志。

## 当前行为

存在 `runId` 时，JunQi 的执行追溯按该标识只读查询 `audit.list`，严格解码后展示
事件时间、动作或工具名、状态、Agent 和“仅元数据”标记。审计记录仍与 transcript
分开，`/tasks` 也不是审计数据来源。

追溯顶部只在收到同一 `runId` 下明确的 `agent.run.finished` 记录时采用 OpenClaw
的终态。`blocked`、`timed_out` 和 `unknown` 保留为独立状态；没有权威终态时继续使用
transcript 状态。

## 目标行为

- 对存在上游 `runId` 的追溯面板，按该 `runId` 只读查询 `audit.list`。
- 通过严格解码器校验事件标识、序列、动作、状态、actor 和脱敏标记；响应结构不符合当前协议时整体标记为不可用。
- 在追溯面板显示时间、动作或工具名、状态、Agent 和“仅元数据”标识，不显示或持久化审计原始载荷。
- 只有同一 `runId` 的 `agent.run.finished` 事件才能覆盖追溯顶部状态；工具终态和孤立事件不参与覆盖。
- 查询失败、缺少权限、账本关闭或旧 Gateway 不支持时，不隐藏 transcript，也不把“无记录”解释为成功。

## 验证结果

- `src/services/gateway/auditLedger.test.ts` 覆盖严格解码、错误脱敏标记、精确 `runId` 请求、缺失运行标识和最新 Agent 终态投影。
- 追溯定向测试、`pnpm exec tsc --noEmit --pretty false`、`pnpm lint`、`pnpm test`、`pnpm build` 和 `git diff --check` 已通过。

## 未验证边界

- 尚未连接真实 Gateway 验证本机账本是否启用、当前连接是否携带 `operator.read`，以及真实事件是否有记录。
- 尚未在亮色、暗色、窄窗口和断线状态下完成人工视觉验收。
- 该投影仍是运维元数据，不会把 transcript-only 的按钮选择升级为正式审批记录。
