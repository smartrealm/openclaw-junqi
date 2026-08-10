# 智能体与配置写入回执规格

## 目标

JunQi 只有在 OpenClaw Gateway 返回结构化成功回执且身份与请求目标一致时，才允许更新本地智能体、
会话或配置投影。

## 验收条件

- `agents.create` 必须确认 `ok`、目标 `agentId`、非空 `name` 和 `workspace`。
- `agents.update` 必须确认 `ok` 与目标 `agentId`。
- `agents.delete` 必须确认 `ok`、目标 `agentId` 与非负 `removedBindings`。
- `config.patch` 必须确认 `ok: true`。
- 任一条件失败时，调用方返回错误且不继续本地成功投影。

## 边界

本规格只约束官方 RPC 回执确认，不新增本地迁移、重试或兼容语义。
