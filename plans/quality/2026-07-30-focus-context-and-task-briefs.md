# 全局专注上下文与任务简报实施计划

日期：2026-07-30

## 当前执行状态

Phase 0 至 Phase 7 已在 `main` 提交 `35bd5c4` 之后的当前工作树完成。相对初始计划的扩展包括：

- Focus target 与路由前缀交叉校验，非法写入不清除已有合法 Focus；
- Chat、Worktree 和 Brief 的实时状态投影补全；
- Brief 生命周期、编辑后 handoff 失效与 `sourceBriefId` 幂等复用；
- Prompt 标签由语言目录注入，不在领域层固定语言；
- Brief 缺失深链和 Agent Task 缺失深链均 fail closed；
- Task Brief 页面按职责拆分为可独立维护的组件。

自动化验证已完成，实际结果记录在
`docs/quality/focus-context-and-task-briefs-validation-2026-07-30.md`。真实 Tauri 窗口、
完整退出后的持久化恢复、目标平台窗口行为、正式签名和公证仍待验证。

依据：

- `docs/design/focus-context-and-task-briefs-design.md`
- `specs/quality/2026-07-30-focus-context-and-task-briefs.md`
- 当前 `AgentWorkspaceTask`、Workbench session、Chat session 和 Dynamic Island 实现

## Phase 0 — 回归测试先行

1. 为 Focus domain 建立四类 target 和 projection 测试。
2. 为 Brief checker/compiler 建立失败测试和 golden output。
3. 为 Agent Task source identity 与 task-id 深链建立失败测试。
4. 扩展 Dynamic Island model 测试，守护静态 Focus 与运行状态语义。

完成条件：测试在缺少实现时失败，且不依赖源码字符串模拟业务行为。

## Phase 1 — Focus Context 领域

新增：

```text
src/focus/domain.ts
src/focus/projection.ts
src/focus/navigation.ts
src/stores/focusContextStore.ts
```

要求：

- persist schema version；
- 严格 target validator/migration；
- projection 从 Agent Task、Chat Session、Workbench Worktree 和 Brief snapshot 解析；
- status 使用 canonical `StatusTone` 可映射语义；
- object missing 时 unavailable；
- route allowlist，不接受任意 URL。

## Phase 2 — Task Brief 领域与 Store

新增：

```text
src/task-briefs/domain.ts
src/task-briefs/checker.ts
src/task-briefs/compiler.ts
src/task-briefs/handoff.ts
src/stores/taskBriefStore.ts
```

修改：

```text
src/stores/agentWorkspaceStore.ts
```

要求：

- stable id；
- immutable ordered card updates；
- sourceBriefId 加入 Agent Task contract；
- handoff 是可测试的单一 transaction coordinator，避免 UI 分别修改三个 Store；
- handoff 不自动执行 Agent，仅创建 todo task 并进入现有执行页。

## Phase 3 — AgentRun 深链闭环

修改：

```text
src/pages/AgentRunView.tsx
src/pages/AgentRunView.test.ts
```

要求：

- Route wrapper 按 taskId 查询 Task Store；
- 恢复 title、projectPath、prompt、agent、permission、plan、launch、session/worktree/status；
- 缺失 task id 明确 fail closed；
- 页面直接新建任务行为保持不变。

## Phase 4 — Task Briefs 产品页

新增：

```text
src/pages/TaskBriefs/index.tsx
src/pages/TaskBriefs/task-briefs.css
```

修改：

```text
src/AppRouteTree.tsx
src/components/Layout/tab-utils.ts
src/components/Layout/NavSidebar.tsx
src/components/Layout/NavSidebarPanels.tsx
```

页面交付：

- Brief 列表；
- 新建/重命名/删除/归档；
- project path 和执行配置；
- 五类卡片编辑、添加、删除、上下移动；
- 引用 metadata 编辑；
- checker 面板；
- compiled prompt 预览；
- Focus 和 handoff 操作；
- 空状态、错误状态、键盘与 aria label。

样式必须使用 Aegis token，无第三方视觉资产。

## Phase 5 — 全局 Focus 控件

新增：

```text
src/components/Focus/FocusControl.tsx
```

修改：

```text
src/components/Layout/TopBar.tsx
src/pages/AgentRunView.tsx
src/pages/AgentWorkspace/index.tsx
src/pages/ChatPage.tsx（仅在已有稳定 session identity 入口处）
```

要求：

- TopBar 可返回和清除当前 Focus；
- 业务页面在拥有稳定 identity 时提供“专注当前项”；
- 不把 route selection 自动等同于 Focus；必须是用户显式动作。

如 ChatPage 接入会扩大当前页面改动，可先由 TopBar 对当前 active session 提供显式设置，不能因此建立第二套 session 状态。

## Phase 6 — Dynamic Island 投影

修改：

```text
src/dynamic-island/model.ts
src/dynamic-island/model.test.ts
src/dynamic-island/DynamicIslandRuntime.tsx
src/dynamic-island/DynamicIsland.tsx
src/dynamic-island/dynamic-island.css
src/dynamic-island/integration.test.ts
```

要求：

- snapshot 包含 Focus projection；
- minimized + Focus 可见；
- activity/attention/error 优先，静态 Focus 为次级；
- Focus 使用独立 glyph/tone，不显示 running spinner；
- action 返回精确对象；
- Tauri allowlist route 保持不变或显式增加 `/briefs`；
- Focus 文本编辑不触发 auto-peek。

## Phase 7 — i18n、索引和验证记录

修改：

```text
src/locales/zh.json
src/locales/zh-TW.json
src/locales/en.json
docs/README.md
specs/README.md
plans/README.md
```

新增 validation 文档，记录实际命令和真机边界。

## 验证顺序

```bash
# 纯领域与 Store
node --import ./test-setup.ts --import tsx --test \
  src/focus/*.test.ts \
  src/task-briefs/*.test.ts \
  src/stores/focusContextStore.test.ts \
  src/stores/taskBriefStore.test.ts

# 页面/岛/深链
node --import ./test-setup.ts --import tsx --test \
  src/pages/TaskBriefs/*.test.ts \
  src/pages/AgentRunView.test.ts \
  src/dynamic-island/*.test.ts

pnpm lint
pnpm test
pnpm build
git diff --check
```

本轮不修改 Rust；如实施中发现必须修改 Tauri route allowlist，则补 Rust 测试并运行：

```bash
cd src-tauri
cargo fmt -- --check
cargo check --lib
cargo test --lib
```

## 真机验收

- 新建 Brief、检查、预览、handoff；
- 重启后 Brief 与 Focus 恢复；
- Agent Task 状态变化实时反映在 TopBar 和 Dynamic Island；
- 删除被 Focus 的对象后显示 unavailable；
- 主窗口最小化时静态 Focus 保持岛可见；
- 点击岛返回 Task、Session、Worktree 或 Brief；
- macOS/Windows 窗口置顶、点击穿透和多显示器不回归。
