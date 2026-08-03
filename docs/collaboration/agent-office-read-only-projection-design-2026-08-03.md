# Agent Office 只读协作投影设计与验证记录

日期：2026-08-03

## 依据

本实现以以下本地契约为依据：

- `CONTEXT.md` 将 Graph Projection 定义为从 Workflow Run 派生的只读节点与边表示，不能改变编排状态。
- `docs/collaboration/openclaw-agent-collaboration-design.md` 将 Collaboration Plugin SQLite 定义为 Run、WorkItem、Attempt、Intervention 和 Delivery 的领域权威；Desktop 只维护投影。
- 当前 `CollaborationRunSnapshot` 已提供 WorkItem、Attempt、Intervention 和 Run 状态；`CollaborationCapabilities` 已提供当前实例配置的 Agent 名称、运行时类型和协调 Agent 身份。
- Star Office UI 审阅基线为上游提交 `f29c107e9728a72f2635f10b4e8203b29b37221d`。其代码可按 MIT 条款使用，但仓库美术资源具有非商业限制。本实现未复制其 Flask 状态服务、状态文件、轮询协议、图形代码或美术资源。

## 当前行为

协作详情此前提供工作项图谱和工作项列表。图谱准确展示 WorkItem 依赖，列表展示 WorkItem 的当前状态和 Agent 分派，但缺少按 Agent 聚合的空间化运行概览。

## 目标行为

协作详情增加“办公室”视图，与图谱和列表消费同一份权威快照。该视图：

1. 只显示在当前 Run 中具有权威参与证据的 Agent，包括存在 Planner/Synthesizer Attempt 的协调 Agent、已分派 WorkItem 的 Agent和存在 Attempt 的 Agent。仅在 capabilities 中配置为协调 Agent 不是 Run 级参与证据。
2. 使用配置能力中的 Agent 名称和运行时类型增强展示；能力元数据缺失时回退到权威 Agent ID。
3. 将 Agent 投影到协调、执行、等待、介入和完成区域。
4. 明确不投影在线状态，不把“已配置”解释为“在线”。
5. 工位编号由当前投影确定性生成，只用于展示，不触发 WorkItem 重分派或任何 Gateway 写命令。
6. `UNKNOWN` Attempt 和未解决 Intervention 优先进入介入区域，不能简化为普通失败或完成。
7. 保留现有 Graph/List 行为，不修改 Collaboration Plugin、Gateway RPC、SQLite schema 或 OpenClaw 协议。

## 状态投影规则

优先级从高到低：

1. Attempt 为 `UNKNOWN`：状态未确认，进入介入区域。
2. 存在未解决 Intervention，或当前 WorkItem 为 `NEEDS_INTERVENTION`：需要处理，进入介入区域。
3. Attempt 为 `CREATED`、`DISPATCHING`、`RUNNING` 或 `CANCELLING`：协调 Agent 进入协调区域，其他 Agent 进入执行区域。
4. WorkItem 为 `PLANNED`、`BLOCKED` 或 `READY`：进入等待区域。
5. Agent 的全部已分派 WorkItem 为 `SUCCEEDED`、`CANCELLED` 或 `WAIVED`：进入完成区域。
6. 协调 Agent 无活动 Attempt 时仍保留在协调区域，但只显示“协调 Agent 已分派”，不猜测具体活动。
7. 其他参与 Agent 显示当前无活动工作。

## UI 与可访问性

- 使用 Aegis 的 `aegis-bg`、`aegis-surface`、`aegis-elevated`、`aegis-border`、`aegis-text`、`aegis-primary`、`aegis-warning` 和 `aegis-success` 语义 token。
- 复用协作状态文案和 `collaborationWorkItemStatusLabel()`，不增加平行状态配色。
- Office 入口是现有视图切换组中的第三个 `aria-pressed` 按钮，支持键盘焦点。
- 每个 Agent 工位具有可访问名称；状态同时使用图标和文字，不只依赖颜色。
- 布局在常规宽度使用两列区域，在窄窗口自然退化为单列，不依赖固定画布宽度或横向滚动。
- 仅在 hover 时使用短距离 transform；系统 reduced motion 的全局规则仍须在真实 Tauri 中人工确认。

## 验证结果

已执行：

- Office 纯投影与 CollaborationDetails 定向测试：13/13 通过。
- `src/components/Collaboration` 与 `src/services/collaboration` 全部测试：200/200 通过。
- 最终完整前端测试：2293/2293 通过。
- 脚本测试：233/233 通过。
- `pnpm lint`：通过；模块边界检查覆盖 763 个文件，四处桌面版本一致为 2.0.0。
- `pnpm build`：通过；Collaboration Plugin package contract 通过，Vite 转换 9106 个模块。
- 三份 locale JSON 解析：通过。
- TypeScript `--noEmit`：通过。

完整禁用 Unicode 符号扫描和 `git diff --check` 在最终差异形成后执行。

## 未验证边界

以下不由自动化证明：

- 真实 Gateway 中长时间协作运行的区域变化。
- 真实 Tauri 的亮色、暗色、护眼、午夜主题视觉表现。
- 窄窗口、系统缩放、键盘焦点顺序和 reduced motion 的人工验收。
- 大量 Agent 和大量 WorkItem 下的实际帧率与信息密度。
- 当前运行中的旧 worktree 实例不会自动获得本实现；必须从当前 worktree 启动后才能验收。
