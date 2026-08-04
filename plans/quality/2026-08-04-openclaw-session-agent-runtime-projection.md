# OpenClaw 会话 Agent Runtime 投影计划

1. 核对最新 Gateway Protocol 与官方共享会话类型，确认 `agentRuntime.id` 的列表与 patch 回执契约。
2. 审查 JunQi 会话列表映射、Zustand Session、模型 patch 回执、Agent 状态卡和本地化，定位字段丢失处。
3. 新增严格只读解析器，并将有效 runtime 投影到会话列表和状态快照。
4. 模型 patch 仅在 Gateway 明确回传有效 runtime 时定向更新目标会话；缺失字段保持已有投影直到权威列表刷新。
5. 补充解析、状态隔离、回执更新与三语界面回归，完成类型检查、构建、差异检查和中文提交。

## 非目标

- 不创建 JunQi 私有 runtime、模型兼容表、运行时回退或 Cloud worker 调度。
- 不向 `sessions.patch` 写入 `agentRuntime`、`agentHarnessId` 或其他未经官方公开允许的字段。
