# 全局专注上下文与任务简报验证记录

日期：2026-07-30

实现基线：`main` 提交 `35bd5c4`。本文只记录该提交之后当前工作树中的 Focus Context
与 Task Brief 扩展，不复用来源工作树的构建或候选包结论。

## 实施范围

本轮完成首个端到端版本：

- 新增独立 Focus Context domain，支持 Agent Task、Chat Session、Workbench Worktree 和 Task Brief 四类 target；
- Focus Store 只持久化 identity、导航和展示快照，实时状态继续从原业务 Store 投影；
- 新增统一 `prepareFocusNavigation` coordinator，在跳转前激活精确 task/session/worktree/brief，来源缺失时 fail closed；
- TopBar、Dynamic Island、AgentRun、Chat SessionContextBar 和 AI Workbench 共享 Focus 能力；
- 新增 `/briefs` 正式产品路由和产品导航入口；
- Task Brief 支持五类有序卡片、引用 metadata、确定性完整性检查、稳定 Markdown Prompt 编译和预览；
- Brief handoff 创建真实 `AgentWorkspaceTask`，写入 `sourceBriefId`，更新 Brief launched identity、切换 Focus，并按 task id 进入现有 AgentRun；
- Brief handoff 按 `sourceBriefId` 幂等复用已有任务，编辑后清除过期 handoff identity；
- Brief 支持归档、恢复和归档只读，恢复时按当前内容重新计算 `draft | ready`；
- Prompt 编译器从三语言目录接收章节标签，领域层不固定展示语言；
- AgentRun route 按稳定 task id 恢复任务配置，来源缺失时不替换为其他任务；
- `/briefs?brief=...` 在来源缺失时 fail closed，不回退到列表中的其他 Brief；
- Task Brief 页面按列表、工具栏、执行配置、卡片、引用和编辑器拆分，响应式图标按钮保留本地化可访问名称；
- 三套 locale 已补齐导航、Focus、Brief、Dynamic Island 和深链错误文案。

## 自动化结果

### 定向回归

```text
70 passed
```

覆盖：

- 四类 Focus projection 和 allowlist route；
- 精确 Task/Worktree activation 与 missing-source fail closed；
- Brief checker/compiler/handoff；
- Brief card identity、reorder、归档恢复、自动 readiness 和 launched identity；
- handoff 幂等复用、Prompt 多语言和重复 identity 拒绝；
- Dynamic Island 可见性、Focus action 和既有窗口契约；
- AgentRun task-id 深链；
- AI Workspace 产品 Shell；
- edition route 映射。

### Lint 与边界

```text
pnpm lint
[pass] Module boundaries clean (checked 638 files)
[pass] TypeScript noEmit
```

### 全量测试

```text
pnpm test
[pass] frontend 1943/1943
[pass] scripts 224/224
```

测试输出仍包含 Node 26 对 `module.register()` 的既有 deprecation warning；不是本轮新增失败。

### 生产构建

```text
pnpm build
[pass] provider catalogs generated from workspace-pinned OpenClaw
[pass] collaboration package contract and bundle
[pass] TypeScript
[pass] Vite production build: 8984 modules transformed
```

### Diff

```text
git diff --check
[pass] clean
```

## 未执行验证

本轮未启动真实 Tauri 窗口，因此以下仍待人工验收：

- 四套主题下 `/briefs` 页面布局、窄窗口和滚动体验；
- 主窗口最小化后静态 Focus 触发 Dynamic Island 的真实窗口行为；
- 点击 Dynamic Island 返回 Task、Session、Worktree 和 Brief；
- macOS/Windows 多显示器、置顶和 click-through；
- 应用重启后 localStorage 中 Focus/Brief 的真实恢复；
- 使用真实 Claude/Codex/Pi 执行由 Brief 编译的任务。
- Windows 目标平台行为、正式签名和公证。

本轮没有执行 `pnpm tauri build`，也没有生成新的 DMG。来源盘点文档中的 adhoc 候选包属于
另一个工作树，不代表当前 `main` 扩展后的桌面包。

未执行 Rust 测试：本轮没有修改 Rust/Tauri command、command 注册、serde 或 collaboration wire contract。Dynamic Island 既有 Rust command 的源码契约测试包含在前端全量测试中，但不替代目标平台真机验证。

## 2026-07-31 导航调整

- `/ai-workspace` 改为与 `/terminal` 使用同一个完整产品导航，不再强制显示仅图标的专用迷你栏。
- AI Workspace 内部 Worktree 侧栏继续独立于产品导航，使用共享 Workspace Chrome，完整态宽度为 220px，紧凑态宽度为 52px。
- 清理旧的 `terminal-rail` 展示分支、专用 Logo 入口、重复的 Worktree 分组标题和页脚；列表只保留项目名、分支与移除操作。
- 已执行 `node --import ./test-setup.ts --import tsx --test src/pages/AgentWorkspace/index.test.ts src/pages/AgentWorkspace/noPrototypeData.test.ts src/components/Layout/terminalNavigation.test.ts src/components/Layout/WorkspaceChrome.test.tsx`，13 项通过。
- 已执行 `pnpm lint`、`pnpm build` 与 `git diff --check`。当前环境没有可连接的应用内浏览器，因此未完成真实 Tauri 窗口的视觉验收。

## 延期边界

以下能力未伪装完成：

- 无限画布、边和自动布局；
- 模型语义 lint；
- GitHub/Linear/Notion/Figma/Sentry Connector；
- 自动读取或内联文件/URL 内容；
- 生成并写入仓库 spec/plan；
- 剪贴板历史和媒体控制。

这些阶段继续使用本轮稳定的 Brief/Card/Reference/Focus identity，不另建平行 authority。
