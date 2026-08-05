# Agent Workspace 能力权威性收敛

日期：2026-08-04

## 依据

- 根目录 `AGENTS.md`：JunQi 是 OpenClaw 桌面客户端；没有官方或已验证本地契约的能力不得以产品功能呈现。
- OpenClaw 官方源码 `docs/gateway/protocol.md` 与 `packages/gateway-protocol/src/schema/agents-workspace.ts`：`agents.workspace.list/get` 是受限的只读 Gateway RPC，使用 `agentId` 与工作区相对路径，不提供写入、浏览器、检查、端口发现或 Vault 能力。
- 当前 JunQi `src/pages/AgentWorkspace/index.tsx`：本机文件、搜索、Git 和 PTY 具备实际实现；Browser、Checks、Ports、AI Vault 及 Agent Provider 标签只有“未连接”占位内容。

## 当前行为

工作台右侧栏允许选择 `checks`、`ports`、`vault`，标签模型允许 `browser`、`agent-terminal`、`conflict-review`、`check-details`。这些状态可以被持久化，但当前没有对应的 Tauri Adapter、Gateway 客户端或 OpenClaw 方法契约。页面只显示未接入提示，无法完成可操作功能。

## 目标行为

- 右侧栏仅保留已有本机实现的文件、搜索和源代码管理面板。
- 标签仅保留已经实现的本机终端、文件编辑器和 Git Diff。
- 将旧持久化快照迁移到新 schema：移除无支持标签，清理所属 group 的标签引用和 active tab，并把无支持右侧面板归一到文件面板。
- 不以本机路径模拟 OpenClaw `agents.workspace.*`，也不把只读 Gateway workspace RPC 伪装成可写本机工作区。

## 验证与边界

- schema 迁移测试覆盖旧标签、右侧面板和 active tab 收敛。
- 页面回归测试断言无支持入口及占位实现均不可重新引入。
- 已通过定向 Workbench 测试 34 项、`pnpm lint`、`pnpm test`、`pnpm test:rust`、`pnpm build` 和 `pnpm verify:openclaw-docs`。
- OpenClaw `agents.workspace.list/get` 的实际 Gateway 接入不属于本次变更；在没有完整连接能力广告、权限与跨目标运行时验证之前，保持未接入而不伪造结果。
