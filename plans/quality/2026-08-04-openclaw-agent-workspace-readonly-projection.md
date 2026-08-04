# OpenClaw Agent 工作区只读投影计划

日期：2026-08-04

1. [x] 核对 OpenClaw 官方协议、schema、Gateway handler 和 JunQi 认证连接围栏。
2. [x] 新增严格的只读 Gateway 客户端与回归测试。
3. [x] 以只读 Gateway 面板替换 Agent Hub 的本机可写工作区链路，并删除已无引用的旧组件与测试。
4. [x] 更新多语言文本、索引和验证记录，运行定向及全量检查。

## 文件范围

- `src/services/gateway/OpenClawAgentsWorkspaceClient.ts`
- `src/services/gateway/OpenClawAgentsWorkspaceClient.test.ts`
- `src/services/gateway/index.ts`
- `src/components/Workspace/OpenClawAgentWorkspacePanel.tsx`
- `src/components/Workspace/OpenClawAgentWorkspacePanel.interaction.test.ts`
- `src/pages/AgentHub/index.tsx`
- `src/pages/AgentHub/AgentSettingsPanel.tsx`
- `src/pages/AgentHub/AgentSettingsPanel.interaction.test.ts`
- `src/components/Workspace/WorkspacePanel.tsx`
- `src/components/Workspace/WorkspaceFileTree.tsx`
- `src/components/Workspace/WorkspacePanel.interaction.test.ts`
- `src/components/FileExplorer/workspaceFileCapabilities.test.ts`
- `src/locales/en.json`、`src/locales/zh.json`、`src/locales/zh-TW.json`
- `docs/README.md`、`specs/README.md`、`plans/README.md`
