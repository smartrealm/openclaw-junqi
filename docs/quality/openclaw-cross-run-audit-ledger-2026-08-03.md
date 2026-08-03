# OpenClaw 跨运行审计账本

日期：2026-08-03

## 依据

- 当前安装的 OpenClaw `2026.7.1-2 (0790d9f)` 官方文档：`docs/cli/audit.md` 与 `docs/gateway/protocol.md`。
- `audit.list` 要求 `operator.read`，支持可选的 `agentId`、`sessionKey`、`runId`、`kind`、`status`、时间边界和 cursor；结果为 newest-first 的有界 `AuditEvent[]`。
- 账本始终为 `redaction: "metadata_only"`，不保存 prompt、消息、工具参数、工具结果、命令输出或原始错误文本；记录保留 30 天并受 100,000 行上限约束。

## 当前行为

活动中心新增跨运行审计区，默认读取最近一页 Gateway 审计事件，可按 `agent_run` / `tool_action` 和七种官方状态筛选，并通过官方 `nextCursor` 继续读取更早记录。刷新和分页都复用日常 `operator.read` 连接，不扩大权限，不写入本地持久化。

每条记录只展示 Agent、run/session 标识、动作或工具名、状态、账本序号、时间和标准化错误码。它与 Chat 的单响应 transcript、任务账本、Cron 历史和日志保持分离。

## 验证结果

- `listAuditLedger` 构造无 runId 的跨运行查询，保留精确的官方筛选字段和 cursor；单响应的 `listAuditEvents` 仍强制真实 `runId`。
- 审计解析测试覆盖跨运行请求、分页参数、严格 metadata-only 解码和 malformed 记录失败关闭。
- 组件过滤器只发送已定义的 OpenClaw kind/status 枚举；查询失败时保留空状态并显示不可用，不把无记录解释为成功。

## 未验证边界

- 尚未连接真实 Gateway 验证本机账本是否已有记录、`audit.enabled` 当前取值和分页期间是否有新写入。
- 尚未在亮色、暗色、窄窗口和断线状态下完成人工视觉验收。
- 该视图不提供 Prompt、消息正文、工具参数、工具结果或原始错误内容，也不替代 transcript、tasks、cron 或日志。
