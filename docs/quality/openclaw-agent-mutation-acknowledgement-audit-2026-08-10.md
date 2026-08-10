# OpenClaw 智能体与配置写入回执审计

日期：2026-08-10

## 上游契约

最新版 OpenClaw Gateway 协议中，`agents.create` 返回 `ok`、`agentId`、`name` 和 `workspace`；
`agents.update` 返回 `ok` 与 `agentId`；`agents.delete` 返回 `ok`、`agentId` 和
`removedBindings`。`config.patch` 成功响应必须包含 `ok: true`。这些字段来自官方协议 schema
与 Gateway handler，不能由请求参数推断。

## 审计发现

AgentHub 的部分直接 RPC 调用在收到异常或失败形状时未检查成功回执，就继续执行本地状态清理或投影。
这会把 Gateway 未确认的写入显示成成功。

## 当前实现

- `AgentManagement` 严格确认创建结果、更新目标身份和删除统计。
- Gateway 的 `updateAgent` 与 `deleteAgent` 统一使用上述确认器。
- AgentHub 的三个直接 `config.patch` 调用与计划工具设置复用 `ok: true` 校验。
- 回执缺失、`ok` 为假、目标智能体不一致或删除统计非法时立即失败，调用方不会继续本地投影。

## 验证

已通过智能体、计划工具和配置客户端定向回归共 28 项，`pnpm lint` 与 `git diff --check` 通过。
真实 Tauri 与多智能体 Gateway 尚未完成窗口级验收。
