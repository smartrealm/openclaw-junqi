# 智能体中心默认办公室投影设计与验证记录

日期：2026-08-08

## 依据

- 协作插件的 `junqi.collab.run.list` 返回 Run 摘要，`junqi.collab.run.get` 返回同一 Run 的完整快照；两者均经 `CollaborationClient` 的严格解码和协作实例身份校验。
- `CollaborationActivityRuntime` 在认证 Gateway 连接有效时维护全局 Run 投影；智能体中心允许按需刷新，但不拥有新的协作状态。
- 既有 Agent Office 已明确为 `CollaborationRunSnapshot` 的只读派生展示，并严格区分配置 Agent、参与 Agent 和在线状态。

## 设计

智能体中心新增页面级 Office 面板，并将其作为默认视图。面板使用协作 store 中的未归档 Run 摘要确定候选项；默认选择按 `updatedAt` 倒序的第一项，用户切换后保留仍存在的选择。选择 Run 后调用 store 的 `refreshRun` 获得完整快照，再将该快照、官方能力中的 `configuredAgents` 和 `coordinatorAgentId` 传给既有 `AgentOfficeView`。

选择器显示 Run 的目标和状态，详情按钮只导航到现有聊天协作详情。Office 面板不提供创建、分派、取消、重试或审批操作，因此不会绕过协作详情的写入确认与版本围栏。

办公室工作区始终以 `configuredAgents` 展示静态员工席位卡片。该卡片只呈现 Gateway 已返回的名称、描述、协调者与允许参与配置，并明确标注为配置目录；它不是 Run 成员、在线、空闲或执行状态的投影。选定真实 Run 后，权威 `AgentOfficeView` 在同一工作区作为运行覆盖层呈现实际分派、尝试和人工核验状态。

## 状态语义

| 情况 | 展示 |
| --- | --- |
| Gateway 未连接 | 明确未连接状态；不使用缓存伪装实时结果。 |
| 正在读取 Run 或快照 | 局部加载状态；保留当前已核验快照直到新快照到达。 |
| 无未归档 Run | 展示静态员工席位与空运行说明，并提供切换回智能体列表的入口。 |
| 已选定 Run 且存在完整快照 | 静态员工席位保持可见，下面叠加权威运行工位与执行详情入口。 |
| 协作读取失败或插件不可用 | 内联错误和刷新入口；不生成假成员。 |
| 快照无参与证据 | 复用 Office 的权威空状态。 |

## 视觉与交互

- 使用 `aegis-surface`、`aegis-border`、`aegis-text`、`aegis-primary`、`aegis-warning` 和 `aegis-danger` 语义 token。
- 复用 `AgentOfficeView`、`LoadingIndicator`、协作状态图标和状态文案；无运行时使用独立配置席位组件，避免把配置数据传入权威 Run 投影。
- 视图切换、Run 选择、刷新、查看详情和返回列表均可键盘访问；窄窗口下选择器和操作按钮自然换行。

## 验证结果

- 已通过智能体中心 Office 选择规则、默认视图、断连边界、既有 Office 投影和协作详情定向测试，共 19 项。
- 已通过 `pnpm exec tsc --noEmit`、`node scripts/check-boundaries.mjs`、三份 locale JSON 解析和 `git diff --check`。
- 已通过 `pnpm build`，其中包含协作插件 package contract、TypeScript 与 Vite 生产构建。

## 未验证边界

- 真实 Tauri 中亮色、暗色、护眼和午夜主题的人工视觉验收。
- 真实 Gateway 的大量 Run、长目标文本和频繁事件变更下的交互表现。
