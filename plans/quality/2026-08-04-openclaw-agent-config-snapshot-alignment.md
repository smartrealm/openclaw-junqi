# OpenClaw Agent 配置快照与并发写入对齐实施计划

## 实施顺序

1. 新增 Gateway 配置快照解析器，严格读取当前官方 envelope，并覆盖已有配置、首次写入、无效
   快照和 hash 缺失边界。
2. 将计划工具设置、Agent 创建补充、AgentHub 元数据读取、导入恢复和设置抽屉迁移到该解析器。
3. 将所有本次范围内 `agents.list` 写入收敛为单条目 id-keyed patch；保留存在配置时的 hash CAS，
   移除整段 list 和 `replacePaths`。
4. 补充行为回归：异常快照不得调用 privileged patch，已有 Agent 条目不能因导入或 fallback 编辑
   被客户端删除，读取异常不重置元数据。
5. 执行定向测试、TypeScript、lint、完整测试、构建、官方链接校验、差异检查和 Emoji 扫描，
   再以中文提交信息提交。

## 文件范围

- `src/services/gateway/OpenClawConfigSnapshot.ts`
- `src/services/gateway/OpenClawConfigSnapshot.test.ts`
- `src/services/gateway/OpenClawPlanToolSettings.ts`
- `src/services/gateway/OpenClawPlanToolSettings.test.ts`
- `src/pages/AgentHub/agentCreationConfig.ts`
- `src/pages/AgentHub/agentCreationConfig.test.ts`
- `src/pages/AgentHub/index.tsx`
- `src/pages/AgentHub/AgentSettingsPanel.tsx`
- `src/pages/AgentHub/AgentSettingsPanel.interaction.test.ts`
- 对应 `docs/`、`specs/`、`plans/` 索引

## 验证边界

自动化覆盖协议解析、CAS 参数与 id-keyed patch 形状。它不替代真实 Gateway 的 schema 拒绝、权限拒绝、
并发外部写入、配置 include 布局以及 macOS、Windows、CentOS、Ubuntu 实机测试。本计划不会宣称
这些环境已验证。
