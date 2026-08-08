# 项目交接状态

更新时间：2026-08-08

## 当前目标

将已验证的 Agent Office 只读投影接入智能体中心，并将其作为默认视图；保留原有智能体列表、网格和活动入口。

## 已完成内容

- 智能体中心默认进入 Office，原有树状、网格和活动视图仍可切换。
- Office 只使用协作 store 的 `junqi.collab.run.list` 与 `junqi.collab.run.get` 投影，不新增任务、运行、会话或本地持久化语义。
- 默认选择最近更新的未归档 Run；用户可切换其他未归档 Run，并跳转到既有聊天协作详情。
- 运行未连接、加载中、无 Run、读取失败和快照无参与证据均有明确真实状态；配置 Agent 不会被伪装为 Run 成员。
- 补齐简体中文、繁体中文和英文文案，并新增 Run 选择与默认视图回归测试。

## 关键技术决策

- Office 继续复用 `AgentOfficeView` 与 `buildAgentOfficeProjection`，保证协作详情和智能体中心使用相同的参与证据与状态规则。
- 选择器只显示 `archiveState` 为 `ACTIVE` 的 Run，并按 `updatedAt` 倒序排序；同一时间用 Run ID 保证稳定排序。
- 智能体中心只读取并导航，不提供协作编排写操作，避免绕过协作详情的确认和版本围栏。

## 核心文件

- `src/pages/AgentHub/AgentHubOfficePanel.tsx`：智能体中心 Office 的加载、选择、空态、错误态和详情导航。
- `src/pages/AgentHub/agentHubOfficeRunSelection.ts`：未归档 Run 的稳定排序与默认选择规则。
- `src/pages/AgentHub/index.tsx`：默认视图与现有视图切换集成。
- `docs/collaboration/agent-hub-office-default-design-2026-08-08.md`、
  `specs/collaboration/2026-08-08-agent-hub-office-default.md`、
  `plans/collaboration/2026-08-08-agent-hub-office-default.md`：依据、验收和实施记录。

## 测试与验证

- 已通过 19 项定向测试，覆盖 Office 选择规则、默认视图、断连边界、协作 Office 投影与详情状态。
- 已通过 `pnpm exec tsc --noEmit`、`node scripts/check-boundaries.mjs`、三份 locale JSON 解析、`pnpm build` 和 `git diff --check`。

## 已知问题

- 尚未在真实 Tauri 中人工验收亮色、暗色、护眼和午夜主题，以及窄窗口下的 Office 选择器与详情导航。
- 尚未用真实 Gateway 的大量 Run、长目标文本和高频事件变更验证渲染密度与刷新体验。

## 已放弃方案

- 不将配置 Agent 直接填充到 Office；它们没有当前 Run 的参与证据。
- 不在智能体中心复制协作写操作或维护独立 Office 状态。

## 下一步顺序

1. 在真实 Tauri 的四种主题和窄窗口中验收智能体中心 Office。
2. 使用真实协作 Run 验证默认 Run 选择、切换、刷新与聊天详情导航。
3. 后续行为变更结束、暂停或交接前，按 `AGENTS.md` 更新本文件并重新执行对应验证。
