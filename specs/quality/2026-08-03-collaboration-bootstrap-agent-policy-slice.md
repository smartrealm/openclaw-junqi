# Collaboration Bootstrap Agent Policy 子域拆分规格

日期：2026-08-03

## 验收条件

- Agent ID 规范化和 OpenClaw agents 配置解析只存在于 `agent_policy.rs`。
- `agents.list` 必须是非空显式数组；重复规范化 ID、错误 `allowAgents` 类型和无效 ID 必须拒绝。
- coordinator 必须已配置且包含在显式插件白名单中；白名单禁止 wildcard、重复项和未配置 Agent。
- entry-level policy 优先于 defaults；需要扩展时保留已有有效策略，再增加所需 Agent。
- 既有配置写入的 command、参数、响应、错误码和 dry-run/readback 顺序保持不变。

## 非目标

- 不新增 Agent、subagent 或 OpenClaw 配置字段。
- 不把本地 JunQi Agent 列表当成 OpenClaw `agents.list` 的替代来源。
- 不改变 Gateway 连接、权限 scope、插件安装或配置持久化边界。
