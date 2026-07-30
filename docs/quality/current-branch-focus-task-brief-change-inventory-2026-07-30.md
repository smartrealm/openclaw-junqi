# 当前分支 Focus Context 与 Task Brief 变更清单

日期：2026-07-30
当前分支：`Blues-Code/wei-dev`
基线：`origin/main`
基线提交：`cc6847fba0a94948e2a5f442dfc7e310455336e5`（`重构：统一状态加载与产品色彩契约`）

## 1. 盘点结论

当前实现以最新 `origin/main` 为基线，仅叠加本轮 **Focus Context（全局专注上下文）** 与 **Task Brief（任务简报）** 相关改动。

恢复本轮改动时使用了清理前的 Git 安全快照，并核对了快照父提交与当前 `origin/main` 一致。因此，本清单中的变更不包含其他分支或更早任务的未提交内容。

截至编写本文档前，本轮功能改动包括：

- 24 个已跟踪文件修改；
- 21 个新增功能、测试或设计文档文件；
- 不包含 Rust 后端、Tauri command、依赖、版本号和打包配置变更；
- 尚未提交或推送。

> 本文档本身是用户要求新增的盘点文件，不计入上述 21 个原始新增文件。

## 2. 产品主链

本轮建立的产品主链为：

```text
Task Brief
  → 确定性完整性检查
  → 稳定 Markdown Prompt 编译
  → 创建唯一 AgentWorkspaceTask
  → 使用 taskId 深链进入 AgentRun
  → 自动设置全局 Focus
  → TopBar / Dynamic Island 显示实时投影
  → 精确返回 Task、Session、Worktree 或 Brief
```

实现遵守以下边界：

1. Task Brief 不建立第二套 Agent 执行系统，而是复用 `AgentWorkspaceTask`。
2. Focus Store 只保存稳定 identity、导航目标和展示快照，不成为任务、会话或 Worktree 的实时状态 authority。
3. 来源不存在时 fail closed，不自动替换为最近任务、会话、Worktree 或 Brief。
4. Brief 引用只保存 metadata，不静默读取文件正文或抓取 URL 内容。
5. Focus 导航只允许 JunQi 内部白名单路由。

## 3. Focus Context 领域

### 3.1 新增文件

- `src/focus/focusContext.ts`
- `src/focus/openFocus.ts`
- `src/focus/useFocusProjection.ts`
- `src/stores/focusContextStore.ts`
- `src/components/Focus/FocusControl.tsx`

### 3.2 支持的 Focus 对象

```ts
'agent-task' | 'chat-session' | 'worktree' | 'task-brief'
```

### 3.3 支持的投影状态

```ts
'idle' | 'running' | 'attention' | 'success' | 'error' | 'unavailable'
```

### 3.4 状态与 authority 边界

Focus Store 持久化：

- Focus schema version；
- 目标类型与稳定 ID；
- 标题和详情快照；
- 内部返回路由；
- Focus 设置时间。

实时状态继续来自原业务 Store：

- Agent Task 状态来自 `agentWorkspaceStore`；
- Chat Session 状态来自聊天会话 authority；
- Worktree 状态来自 Workbench Store；
- Task Brief 状态来自 `taskBriefStore`。

如果稳定 ID 对应的来源已不存在，投影状态为 `unavailable`，不会重新指向其他对象。

### 3.5 导航约束

Focus 仅允许以下内部路由前缀：

- `/agent-run`
- `/chat`
- `/ai-workspace`
- `/briefs`

`prepareFocusNavigation()` 在返回路由前先激活精确业务对象；激活失败时返回 `null`。

## 4. Focus 产品接入

### 4.1 TopBar

修改：

- `src/components/Layout/TopBar.tsx`

变化：

- 非终端页面顶部栏增加全局 `FocusControl`；
- 显示当前 Focus 及实时投影状态；
- 支持返回精确来源和清除 Focus；
- 终端专用 chrome 不显示该控件，避免改变终端既有契约。

### 4.2 Chat Session

修改：

- `src/components/Chat/SessionContextBar.tsx`

变化：

- 会话上下文栏增加准星按钮；
- 点击后以精确 `sessionKey` 设置 Focus；
- 返回路由为：

```text
/chat?session=<sessionKey>
```

### 4.3 Agent Task

修改：

- `src/pages/AgentRunView.tsx`

变化：

- Agent Task 标题栏增加准星按钮；
- 使用稳定 Task ID 设置 Focus；
- 返回路由为：

```text
/agent-run?taskId=<taskId>
```

### 4.4 Worktree

修改：

- `src/pages/AgentWorkspace/index.tsx`

变化：

- AI Workspace 顶部增加“专注此 Worktree”操作；
- 保存稳定 Worktree ID；
- 返回时精确激活该 Worktree。

## 5. Agent Task 深链恢复

修改：

- `src/pages/AgentRunView.tsx`
- `src/pages/AgentRunView.test.ts`

`AgentRunRoute` 现在读取：

```text
/agent-run?taskId=<taskId>
```

并从 `agentWorkspaceStore.tasks` 精确恢复：

- Task ID；
- 标题；
- 项目路径；
- Agent；
- Prompt；
- 权限模式；
- 任务状态；
- Session path 和 Session ID；
- Worktree path、branch 和 discarded 状态；
- Base branch；
- Plan mode；
- Launch mode；
- Draft 状态。

当 URL 中存在 `taskId`，但对应任务已不存在时：

- 显示“任务不可用”；
- 不替换成其他任务；
- 不执行空 Prompt；
- 不自动打开最近任务。

## 6. Task Brief 领域

### 6.1 新增文件

- `src/task-briefs/domain.ts`
- `src/task-briefs/checker.ts`
- `src/task-briefs/compiler.ts`
- `src/task-briefs/handoff.ts`
- `src/stores/taskBriefStore.ts`

### 6.2 卡片类型

Task Brief 支持五类有序卡片：

- `goal`：目标；
- `background`：背景；
- `constraint`：约束；
- `acceptance`：验收条件；
- `note`：补充说明。

卡片具有稳定 identity，调整顺序不会重新创建卡片。

### 6.3 引用类型

支持六类上下文引用：

- `file`；
- `directory`；
- `chat-session`；
- `agent-task`；
- `worktree`；
- `url`。

引用只保存类型、显示名称和值等 metadata，不自动读取内容。

### 6.4 Brief 状态

```ts
'draft' | 'ready' | 'launched' | 'archived'
```

### 6.5 确定性检查

`checkTaskBrief()` 的阻断项包括：

- 未选择项目路径；
- 缺少非空目标卡片；
- 缺少非空验收条件卡片。

警告项包括：

- 存在“它”“这个”“优化一下”等模糊表达；
- 缺少约束或上下文引用，可能导致 Agent 依赖猜测。

检查器使用确定性规则，不依赖 Apple Intelligence，也不伪装成模型语义 lint。

### 6.6 Prompt 编译

`compileTaskBrief()` 按当前卡片顺序生成稳定 Markdown Prompt，内容包括：

- 任务标题；
- 项目；
- 目标；
- 背景；
- 约束；
- 验收条件；
- 补充说明；
- 上下文引用。

空卡片不进入编译结果。

### 6.7 Brief Handoff

`handoffTaskBrief()` 执行以下流程：

1. 执行 Brief 完整性检查；
2. 编译稳定 Prompt；
3. 创建唯一一条真实 `AgentWorkspaceTask`；
4. 在 Task 上写入 `sourceBriefId`；
5. 更新 Brief 的 launched identity；
6. 将新 Agent Task 设置为当前 Focus；
7. 返回 `/agent-run?taskId=<新任务 ID>`。

修改：

- `src/stores/agentWorkspaceStore.ts`

新增字段：

```ts
sourceBriefId?: string;
```

## 7. Task Briefs 页面

新增：

- `src/pages/TaskBriefs/index.tsx`
- `src/pages/TaskBriefs/task-briefs.css`

页面支持：

- 新建和删除 Brief；
- 编辑任务名称；
- 设置项目路径；
- 选择 Agent；
- 选择权限模式；
- 添加五类任务卡片；
- 编辑、删除和调整卡片顺序；
- 添加上下文引用；
- 查看完整性检查结果；
- 预览编译后的 Prompt；
- 创建真实 Agent Task；
- 将 Brief 设为当前 Focus。

当前 `task-briefs.css` 是空文件，页面主要复用已有 Aegis/Tailwind 样式。

## 8. 路由、导航与 Edition 接入

修改：

- `src/AppRouteTree.tsx`
- `src/components/Layout/NavSidebar.tsx`
- `src/components/Layout/NavSidebarPanels.tsx`
- `src/components/Layout/tab-utils.ts`
- `src/config/edition.ts`
- `src/config/edition.test.ts`

新增正式路由：

```text
/briefs
```

产品接入：

- 默认产品导航工具区增加“任务简报”；
- 紧凑产品导航增加“任务简报”；
- `/briefs` 归入 `tools` Tab；
- `/briefs` 映射到现有 `agentRun` edition feature gate。

## 9. Dynamic Island 接入

修改：

- `src/dynamic-island/DynamicIsland.tsx`
- `src/dynamic-island/DynamicIslandRuntime.tsx`
- `src/dynamic-island/dynamic-island.css`
- `src/dynamic-island/model.ts`

变化：

1. `DynamicIslandSnapshot` 增加 `focus: FocusProjection | null`。
2. 主窗口最小化且存在 Focus 时，即使没有运行中的任务，也可以保持 Dynamic Island 显示。
3. 静态 Focus 使用 `Crosshair` 图标，不冒充 running spinner。
4. Focus 卡片显示标题、详情和实时投影状态。
5. 新增 `open-focus` 操作，点击后精确返回来源。
6. 来源失效时显示 unavailable/error 色调，不跳转到其他对象。
7. waiting、failed、running、语音和文件拖放等现有高优先级状态仍优先于静态 Focus。

## 10. 三语言本地化

修改：

- `src/locales/zh.json`
- `src/locales/en.json`
- `src/locales/zh-TW.json`

新增：

- 任务简报导航名称；
- Task Brief 页面字段、状态和操作；
- 五类卡片名称与占位文本；
- 六类引用名称；
- 完整性检查提示；
- Focus 设置、清除和状态；
- Dynamic Island“当前专注”；
- Agent Task 不可用提示。

## 11. 测试变更

### 11.1 新增测试文件

- `src/focus/focusContext.test.ts`
- `src/focus/openFocus.test.ts`
- `src/stores/taskBriefStore.test.ts`
- `src/task-briefs/handoff.test.ts`
- `src/task-briefs/taskBriefs.test.ts`

### 11.2 修改测试文件

- `src/pages/AgentRunView.test.ts`
- `src/dynamic-island/model.test.ts`
- `src/dynamic-island/integration.test.ts`
- `src/config/edition.test.ts`

### 11.3 主要覆盖内容

- Focus 从原业务 Store 投影实时状态；
- 来源缺失时投影为 unavailable；
- Focus 内部路由 allowlist；
- 精确激活 Agent Task 和 Worktree；
- 对象缺失时 fail closed；
- Brief 卡片稳定 identity、编辑与排序；
- Brief launched identity；
- Brief 检查器阻断项与警告项；
- Prompt 稳定编译和空卡片排除；
- Handoff 仅创建一个关联 Task；
- Handoff 更新 Task、Brief 和 Focus 的顺序；
- `taskId` 深链精确恢复；
- Dynamic Island 在最小化且存在 Focus 时显示；
- `/briefs` edition mapping。

## 12. 文档、规格与计划

新增：

- `docs/design/focus-context-and-task-briefs-design.md`
- `docs/quality/focus-context-and-task-briefs-validation-2026-07-30.md`
- `specs/quality/2026-07-30-focus-context-and-task-briefs.md`
- `plans/quality/2026-07-30-focus-context-and-task-briefs.md`

修改索引：

- `docs/README.md`
- `specs/README.md`
- `plans/README.md`

文档记录了设计依据、领域边界、目标行为、实施顺序、自动化结果和未验证边界。

## 13. 已跟踪文件修改清单

```text
docs/README.md
plans/README.md
specs/README.md
src/AppRouteTree.tsx
src/components/Chat/SessionContextBar.tsx
src/components/Layout/NavSidebar.tsx
src/components/Layout/NavSidebarPanels.tsx
src/components/Layout/TopBar.tsx
src/components/Layout/tab-utils.ts
src/config/edition.test.ts
src/config/edition.ts
src/dynamic-island/DynamicIsland.tsx
src/dynamic-island/DynamicIslandRuntime.tsx
src/dynamic-island/dynamic-island.css
src/dynamic-island/integration.test.ts
src/dynamic-island/model.test.ts
src/dynamic-island/model.ts
src/locales/en.json
src/locales/zh-TW.json
src/locales/zh.json
src/pages/AgentRunView.test.ts
src/pages/AgentRunView.tsx
src/pages/AgentWorkspace/index.tsx
src/stores/agentWorkspaceStore.ts
```

## 14. 原始新增文件清单

```text
docs/design/focus-context-and-task-briefs-design.md
docs/quality/focus-context-and-task-briefs-validation-2026-07-30.md
plans/quality/2026-07-30-focus-context-and-task-briefs.md
specs/quality/2026-07-30-focus-context-and-task-briefs.md
src/components/Focus/FocusControl.tsx
src/focus/focusContext.test.ts
src/focus/focusContext.ts
src/focus/openFocus.test.ts
src/focus/openFocus.ts
src/focus/useFocusProjection.ts
src/pages/TaskBriefs/index.tsx
src/pages/TaskBriefs/task-briefs.css
src/stores/focusContextStore.ts
src/stores/taskBriefStore.test.ts
src/stores/taskBriefStore.ts
src/task-briefs/checker.ts
src/task-briefs/compiler.ts
src/task-briefs/domain.ts
src/task-briefs/handoff.test.ts
src/task-briefs/handoff.ts
src/task-briefs/taskBriefs.test.ts
```

## 15. 明确未变更的范围

以下内容仍与 `origin/main` 一致：

- Rust 后端；
- Tauri command 及注册路径；
- Rust serde 与 collaboration wire contract；
- `package.json` 和 `pnpm-lock.yaml`；
- `Cargo.toml` 和 `Cargo.lock`；
- 应用版本号；
- updater 配置；
- macOS 打包配置；
- 终端导航实现；
- 安装流程；
- Provider catalog 生成器；
- Runtime 默认值。

构建后以下生成目录没有留下额外 Git 修改：

- `src/generated`；
- `src-tauri/resources/collaboration`。

## 16. 验证状态

已执行并通过：

- Focus/Task Brief 定向回归测试；
- TypeScript lint 和模块边界检查；
- 前端与脚本全量测试；
- TypeScript 与 Vite production build；
- `git diff --check`；
- macOS arm64 adhoc 本地候选包构建；
- DMG `hdiutil verify`。

尚未完成：

- 真实 Tauri 窗口中的完整人工验收；
- Dynamic Island 多显示器、置顶和 click-through 验收；
- 完全退出后的 Brief 与 Focus 持久化恢复验收；
- 真实 Claude、Codex 或 Pi Agent 执行验收；
- Windows 目标平台验收；
- Apple 正式签名与公证。

## 17. 当前本地候选包

```text
/Users/wei/orca/workspaces/openclaw-junqi/wei-dev/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/JunQi Desktop_1.4.18_aarch64.dmg
```

SHA-256：

```text
de6d123b3db579bb03978857eeb9d62fab7037d43e1a031c957b010be555d032
```

该包是 `origin/main` 加本轮 Focus Context / Task Brief 未提交改动构建的 macOS arm64 本地候选包，使用 adhoc 签名，未公证且未生成 updater artifacts，不能描述为正式发布包。
