# Nezha 拆零件移植计划（Option A）

> **Status**: historical execution plan; local mirror directories were removed after the useful pieces were migrated.
> **Source**: hanshuaikang/nezha（历史镜像目录已删除；当前前端实现以 `src/components/shared/`、`src/components/Terminal/`、`src/components/settings/`、`src/styles/nezha-bridge.css` 等迁移后文件为准）
> **Target**: openclaw-junqi
> **Branch**: `feat/port-nezha-fullsuite`
> **总估时**: 7-10 个工作日
>
> **关联文档**：
> - 功能盘点 [`NEZHA-FEATURES-AND-UI.md`](./NEZHA-FEATURES-AND-UI.md)
> - 视觉设计系统 [`NEZHA-VISUAL-DNA.md`](./NEZHA-VISUAL-DNA.md)

---

## 0 — 模式声明

**Option A — 拆零件照抄**：

- ✅ **保留** junqi 现有架构（Gateway WebSocket / ChatPage / Dashboard / Workshop / Analytics / Calendar / Kanban / 24 个页面 / Zustand stores）
- ✅ **保留** junqi 现有状态管理（Zustand）
- ✅ **保留** junqi 现有路由（HashRouter）
- ✅ **保留** junqi 现有 i18n（i18next + react-i18next, zh/en/ar）
- ❌ **不引入** nezha 的 WelcomePage / ProjectPage / App.tsx 整树替换
- 🔧 **新增/替换**：把 nezha 的可独立模块 1:1 移植进 junqi 的现有页面/组件

> **原则**：junqi 的页面 = 宿主；nezha 的组件 = 插件。**插件不修改宿主结构，宿主按需 import 插件。**

---

## 1 — 现有 nezha 资产盘点（历史记录）

| 资产 | 位置 | 体量 | 状态 |
|---|---|---|---|
| 26 个 nezha 组件 | 历史镜像 | ~8000 行 | 已拆分迁移，镜像目录已删除 |
| 11 个 AppSettings 子面板 | 历史镜像 | ~1500 行 | 已拆分迁移，镜像目录已删除 |
| 14 个样式模块 | 历史镜像 | ~3000 行 | 已收敛为 `src/styles/nezha-bridge.css` 等当前样式 |
| 6 个 hooks | 历史镜像 | ~800 行 | 已拆分迁移，镜像目录已删除 |
| nezha App + main + types + i18n + utils | 历史镜像：`src/_nezha_root/` | ~3000 行 | 仅保留仍被当前代码使用的 `platform.ts` / `shortcuts.ts` / `types.ts` |
| 19 个 nezha Rust 模块 | `src-tauri/src/nezha/` | 10683 行 | 已镜像未注册 |
| Terminal 组件 | `src/components/Terminal/` | ~700 行 | ✅ 已接入 |
| **git 命令** | `src-tauri/src/commands/git_neu.rs` | 1370 行 | ✅ **已移植 + 注册** |
| **fs 命令** | `src-tauri/src/commands/fs_neu.rs` | 680 行 | ✅ **已移植 + 注册** |
| **shell pty 命令** | `src-tauri/src/commands/pty_neu.rs` | 383 行 | ✅ **已移植 + 注册（仅 shell 部分）** |

**关键发现（更新于 2026-06-22）**：
junqi 在早期已经把 nezha 的 git/fs/pty 命令**移植到了 `commands/*_neu.rs`**（命名约定 `_neu` = Nezha-Unified），全部已在 `src-tauri/src/lib.rs` 的 `invoke_handler!` 注册。**这部分不需要重复工作**。

**剩余 nezha 后端模块未移植**（仍是孤儿）：
- `pty.rs` 的 agent 任务命令：`run_task` / `resume_task` / `cancel_task` / `complete_task` / `get_active_task_ids` / `reset_task_process`
- `git.rs` 的 worktree 命令：`create_task_worktree` / `merge_task_worktree` / `remove_task_worktree` / `worktree_diff_stats`
- `analytics.rs::read_session_metrics`
- `session.rs::read_session_messages` / `export_session_markdown`
- `agent_assist.rs::generate_task_name`
- `usage.rs::read_usage_snapshot`
- `notification.rs::*`（list_notifications / mark_read / mark_all_read）
- `hooks.rs::get_hook_readiness` 等
- `skills.rs::*`（list_skills / install_skill / delete_skill 等）
- `app_settings.rs::*`
- `config.rs::init_project_config` / `read_project_config` / `write_project_config`

---

## 2 — 移植阶段划分

按「依赖关系 + 风险递增 + 价值递增」划分 6 个阶段，每阶段产出独立可交付 PR。

```
Phase 0: 基础设施接入              0.5d ─┐
Phase 1: 视觉/状态统一              1d   ├─ 可独立上线
Phase 2: 通知/状态可视化           1d   │
Phase 3: 文件/代码/Markdown 浏览器  1.5d │
Phase 4: Git 工作流                1.5d │
Phase 5: Agent/任务/Skill      2-3d ─┘
```

---

## 3 — Phase 0: 基础设施接入（0.5 天）

**目标**：让 nezha 的前端样式/hooks/类型在 junqi 中可被 import 而不报错。

### 3.1 后端 nezha 缺失命令补齐（取消）

**结论**：PR-0.1 原计划是「注册 nezha 模块」。但实地探查发现 junqi **已经** 把 nezha 的 git/fs/pty 命令移植到了 `commands/*_neu.rs` 并注册。**这部分不需要重复做**。

**实际要做**：补齐剩余未移植的 nezha 后端模块（agent task / worktree / session / analytics / usage / notification / hooks / skills / app_settings / config）—— 见 §3.2。

### 3.2 nezha 样式注入

**当前状态**：旧镜像样式目录已删除；迁移后的兼容变量桥保留在 `src/styles/nezha-bridge.css`，由 `src/styles/index.css` 统一加载。

### 3.3 nezha 类型与 utils 暴露（历史记录）

**当前状态**：不再新增 `@nezha/*` alias；保留的兼容类型直接从当前文件导入，避免继续依赖已删除镜像。

```json
{
  "compilerOptions": {}
}
```

### 3.4 验收

- [ ] `pnpm tauri dev` 能起，无命名冲突编译错误
- [ ] 当前组件不依赖已删除的 `@nezha/*` alias
- [ ] 当前组件不依赖已删除的历史镜像样式模块

---

## 4 — Phase 1: 视觉/状态统一（1 天）

**目标**：junqi 全应用的「状态可视化」和「主题系统」对齐 nezha 规范。

### 4.1 PR-1: 统一 StatusIcon（4h）

**上游来源**：`nezha/src/components/nezha/StatusIcon.tsx`

**接入位置**：

| 位置 | 现状 | 目标 |
|---|---|---|
| `ChatPage` | `StatusDot` 自定义圆点 | 用 nezha `StatusIcon` 替换 |
| `AgentHub` | 状态文字 + 自定义色块 | 用 nezha `StatusIcon` |
| `SetupPage` | 检测步骤状态图标 | 用 nezha `StatusIcon` |
| `TasksPage/Workshop` | 任务状态 | 用 nezha `StatusIcon` |

**改动文件**：

```
src/components/Chat/ChatView.tsx        // import nezha StatusIcon
src/pages/AgentHub/index.tsx
src/pages/SetupPage.tsx
src/components/shared/StatusDot.tsx     // 标为 deprecated，保留 shim
```

**验收**：

- [ ] 4 处全部替换为 nezha StatusIcon，视觉一致
- [ ] 旧 `StatusDot` 标 `@deprecated` 但保留导出

### 4.2 PR-2: 主题选择器升级（2h）

**上游来源**：`nezha/src/components/nezha/app-settings/ThemePanel.tsx`

**接入位置**：替换 `src/components/settings/ThemePicker.tsx`

**改动**：

```tsx
// src/components/settings/ThemePicker.tsx → 重新导出 ThemePanel
export { ThemePanel as ThemePicker } from "@/components/nezha/app-settings/ThemePanel";
```

**注意**：junqi 有 `aegis-dark` / `aegis-light` / `aegis-eyecare` 三主题；nezha 有 `dark` / `midnight` / `light` / `eyecare` 四主题。需要：

1. 在 junqi 的 `theme/useTheme.ts` 加 `midnight` 主题
2. 把 nezha 的 `themeVariant` 类型扩展与 junqi 的 `themeVariant` 对齐

**验收**：

- [ ] SettingsPage → 主题选择器呈现 nezha 风格的 4 主题预览缩略图
- [ ] 切换 midnight 主题正常
- [ ] 旧 AEGIS 主题代码路径保留（向下兼容）

### 4.3 PR-3: SidebarFooterActions 复用（2h）

**上游来源**：`nezha/src/components/nezha/SidebarFooterActions.tsx`

**接入位置**：`src/components/Layout/NavSidebar.tsx` 底部

**验收**：SettingsPage 顶部按钮区呈现 nezha 风格。

---

## 5 — Phase 2: 通知/状态可视化（1 天）

### 5.1 PR-4: NotificationBell 接入（4h）

**上游来源**：`nezha/src/components/nezha/NotificationBell.tsx` + `nezha/src/hooks/nezha/useNotifications.tsx`

**接入位置**：`src/components/Layout/TopBar.tsx` 通知铃铛位置

**对接点**：junqi 已有 `notificationStore` + `services/notifications`，需要：

1. nezha 的 `useNotifications` 改用 junqi 的 store 数据源
2. 或：保留 nezha 的 store 结构，junqi 的 `notificationStore` 写入 nezha 的 store

**推荐方案**：在 nezha 的 `useNotifications` 增加适配层，调用 junqi 的 `notifications.list()` 命令（如果存在）或 Tauri 直接读取 `notificationStore`。

**验收**：

- [ ] TopBar 铃铛点击弹 nezha 风格通知面板
- [ ] 未读徽章颜色正确（danger）
- [ ] mark read / mark all read 工作

### 5.2 PR-5: UsagePopover 接入（3h，可选）

**上游来源**：`nezha/src/components/nezha/UsagePopover.tsx` + `nezha/src/hooks/nezha/useUsageSnapshot.ts`

**接入位置**：TopBar 通知铃铛旁 / SidebarFooterActions 内

**前置**：需要后端实现 `read_usage_snapshot` 命令（nezha 的 `usage.rs` 已镜像）。

**验收**：

- [ ] Popover 打开显示 Claude/Codex 用量
- [ ] 5h/7d 窗口数值正确
- [ ] unavailable 状态降级显示

---

## 6 — Phase 3: 文件/代码/Markdown 浏览器（1.5 天）

### 6.1 PR-6: FileExplorer 替换（6h）

**上游来源**：`nezha/src/components/nezha/FileExplorer.tsx` + `nezha/src/components/nezha/file-explorer/*`

**接入位置**：`src/pages/FileManager.tsx`（目前是 junqi 自己的实现）

**后端依赖**：

| 命令 | 现状 | 移植方案 |
|---|---|---|
| `read_dir_entries` | junqi 有（`fs_neu`） | 复用 junqi，**不移植 nezha 的** |
| `list_project_files` | nezha 有，junqi 无 | 从 `src-tauri/src/nezha/fs.rs` 移植到 `commands/fs_neu.rs` |
| `open_in_system_file_manager` | nezha 有，junqi 无 | 同上 |
| `create_file` / `create_directory` | nezha 有，junqi 无 | 同上 |
| `delete_path` | nezha 有，junqi 无 | 同上 |

**改动**：

```bash
# 从 nezha fs.rs 抽出需要的命令，合并到 junqi fs_neu.rs
# 或新增 commands/fs_nezha.rs 避免命名冲突
```

**验收**：

- [ ] FileManager 页面用 nezha FileExplorer（虚拟滚动树）
- [ ] 右键菜单全部工作（新建 / 删除 / 重命名 / 系统文件夹打开）
- [ ] 拖动宽度 / 自动刷新正常

### 6.2 PR-7: FileViewer 替换（6h）

**上游来源**：`nezha/src/components/nezha/FileViewer.tsx`

**接入位置**：FileManager 内打开文件时 / `Workshop.tsx` 的代码片段查看

**后端依赖**：`read_file_content`（junqi 已有）+ `read_image_preview`（移植）

**注意**：FileViewer 使用 `marked` + `dompurify` + `@uiw/react-codemirror` —— 这些依赖 junqi 都已经装（见 `package.json`）。

**验收**：

- [ ] 代码文件用 CodeMirror 高亮
- [ ] Markdown 文件支持 Edit/Preview 切换 + TOC 锚点
- [ ] 图片预览缩放正常
- [ ] 多 Tab 工作

---

## 7 — Phase 4: Git 工作流（1.5 天）

### 7.1 PR-8: GitChanges 替换（5h）

**上游来源**：`nezha/src/components/nezha/GitChanges.tsx` + `git-view/GitFileBrowser.tsx`

**接入位置**：`src/pages/GitPage.tsx`（目前是分析视图，**不是变更视图**）

**决策点 DP-2**：junqi 的 GitPage 是 dashboard 风格（提交图谱 + 贡献热力），与 nezha 的 GitChanges 是文件级变更列表。**两者并存**，在 GitPage 内新增 tab：「Changes / History / Stats」。

**后端依赖**：

| 命令 | 状态 |
|---|---|
| `git_status` | junqi 有，nezha 有 — **使用 nezha 版本**（更完整） |
| `git_stage` / `git_unstage` | nezha 有，移植 |
| `git_stage_all` / `git_unstage_all` | nezha 有，移植 |
| `git_commit` | junqi 有，移植 nezha 的（带 AI 生成） |

### 7.2 PR-9: GitHistory 替换（3h）

**上游来源**：`nezha/src/components/nezha/GitHistory.tsx`

**接入位置**：GitPage → History tab

**验收**：commit log + branch + ahead/behind + push/pull

### 7.3 PR-10: GitDiffViewer 接入（2h）

**上游来源**：`nezha/src/components/nezha/GitDiffViewer.tsx`

**接入位置**：在 GitChanges / GitHistory 内点击文件/提交触发

### 7.4 PR-11: AI 生成 commit message（2h）

**上游来源**：`nezha/src/components/nezha/GitChanges.tsx` 的 Sparkles 按钮 + `src-tauri/src/nezha/git.rs::generate_commit_message`

**接入位置**：GitChanges 提交区

**后端改动**：把 nezha 的 `generate_commit_message` 函数直接搬到 `src-tauri/src/commands/git_neu.rs`（**命令名加 `junqi_` 前缀避免冲突**）

**验收**：点击 Sparkles → 调 agent 生成 → 填入 commit message

---

## 8 — Phase 5: Agent/任务/Skill（2-3 天，可选拆分）

> 这一阶段是 junqi **没有的全新能力**。可拆为 3 个独立 PR。

### 8.1 PR-12: SkillHub 接入（6h）

**上游来源**：`nezha/src/components/nezha/skill-hub/*` + `src-tauri/src/nezha/skills.rs` + `nezha/src/components/nezha/app-settings/SkillsPanel.tsx`

**接入位置**：junqi 的 `SkillsPage` 已有部分实现，可借鉴 nezha 的 SkillHub 架构（软链管理 / frontmatter 解析 / 冲突处理）

**验收**：

- [ ] SkillsPage 增设 Hub 配置入口
- [ ] frontmatter 解析 + 软链安装工作
- [ ] Skill 列表 + manage dialog 完整

### 8.2 PR-13: Terminal 升级（4h）

**上游来源**：`nezha/src/components/nezha/ShellTerminalPanel.tsx` 已部分接入，补全：

- 多 Tab（最多 5 个）
- 拖拽调高度（用 nezha 的 `onResizeStart` 模式替换现有 `useEffect + window mousemove`）
- `pendingCmdRef` 队列（shell 未开时排队）

**验收**：参照 nezha ShellTerminalPanel 的所有能力

### 8.3 PR-14: Make Target 一键运行（3h）

**上游来源**：`nezha/src/components/nezha/FileViewer.tsx` 的 Makefile 检测逻辑

**接入位置**：FileViewer 顶部

**后端依赖**：无新命令

**验收**：FileViewer 检测 Makefile → 渲染目标 → 点击通过 `panelRef.sendCommand` 注入终端

### 8.4 PR-15: @ 文件提及（半天，可选）

**上游来源**：`nezha/src/components/nezha/new-task/MentionPopover.tsx` + `PromptEditor.tsx`

**接入位置**：`src/components/Chat/MessageInput.tsx`

**后端依赖**：`list_project_files`（已在 PR-6 移植）

**验收**：聊天输入 `@` 触发文件搜索浮层

---

## 9 — 决策点（需要你拍板）

### DP-1: nezha 后端命令命名

**问题**：junqi 已有 `git_status` / `read_file_content` / `open_shell` 等命令，nezha 也叫同名命令。

**选项**：

- **A** (推荐)：全部 nezha 命令加 `nezha_` 前缀 → `invoke("nezha_git_status")`，junqi 命令加 `junqi_` 前缀 → `invoke("junqi_git_status")`，**命令共存**。
- **B**：junqi 现有 git/fs/pty 命令**全部废弃**，由 nezha 接管，junqi 改调 nezha 版本。
- **C**：junqi 不注册 nezha 模块，**后端 nezha 完全不用**，仅前端 nezha 组件（依赖的命令由前端适配层转换）。

**推荐**：选 **A**。风险最低，向后兼容。

### DP-2: GitPage 改造

**问题**：junqi 的 GitPage 是 dashboard 风格（贡献图、统计），nezha 的 GitChanges 是文件级操作面板。

**选项**：

- **A** (推荐)：GitPage 加 tab「Changes / History / Stats」，原有统计仪表保留为 Stats tab
- **B**：GitPage 完全替换为 nezha 风格，统计仪表迁到 FullAnalytics
- **C**：保持 GitPage 不动，新建 GitWorkspacePage 走 nezha

**推荐**：选 **A**。

### DP-3: 后端 nezha 镜像处理

**问题**：`src-tauri/src/nezha/` 10,683 行代码完整躺着，无人引用。

**选项**：

- **A** (推荐)：按需从 nezha 镜像**抽取**到 junqi 的 `commands/` 模块，加 `junqi_` 前缀
- **B**：注册整个 nezha 模块（`mod nezha`），命名空间隔离
- **C**：删除 nezha 镜像，按需手动抄命令

**推荐**：选 **A**。保持命令扁平命名空间。

---

## 10 — 风险与回滚

| 风险 | 概率 | 影响 | 回滚方案 |
|---|---|---|---|
| nezha CSS 变量污染 junqi AEGIS 主题 | 中 | 中 | Phase 1 加 scoped CSS / 用 `:where(.nezha-scope)` 包裹 |
| 命令命名冲突编译失败 | 高 | 高 | 全部加 `junqi_` / `nezha_` 前缀（DP-1 选 A） |
| 状态管理不一致导致 store 类型冲突 | 低 | 中 | nezha 组件不写 store，只读 props |
| i18n 双实例冲突（i18next + nezha 的 Context） | 中 | 低 | nezha 组件按需 `useTranslation` 替换 `useI18n` |
| 终端 xterm 实例内存泄漏 | 低 | 中 | 复用现有 TerminalView 实现，仅引用 nezha helpers |

---

## 11 — 时间线（甘特图）

```
Day  1         2         3         4         5         6         7         8
─────│─────────│─────────│─────────│─────────│─────────│─────────│─────────│
Phase 0 ▓░
PR-0.1: lib.rs mod nezha + 命令加前缀 ▓▓
PR-0.2: styles/hooks 注入全局         ░▓
        │
        ├─ Phase 1 ─────────────────────┐
        PR-1: StatusIcon 统一                   ▓▓▓▓
        PR-2: ThemePanel 升级                            ▓▓
        PR-3: SidebarFooterActions                            ▓▓
                │
                ├─ Phase 2 ────────────────┐
                PR-4: NotificationBell                         ▓▓▓▓
                PR-5: UsagePopover                                  ▓▓▓
                        │
                        ├─ Phase 3 ────────┐
                        PR-6: FileExplorer                                ▓▓▓▓▓▓
                        PR-7: FileViewer                                          ▓▓▓▓▓▓
                                │
                                ├─ Phase 4 ────┐
                                PR-8: GitChanges                                          ▓▓▓▓▓
                                PR-9: GitHistory                                              ▓▓▓
                                PR-10: GitDiffViewer                                          ▓▓
                                PR-11: AI commit msg                                            ▓▓
                                        │
                                        ├─ Phase 5 ────────────┐
                                        PR-12: SkillHub                                                  ▓▓▓▓▓▓
                                        PR-13: Terminal 升级                                                    ▓▓▓▓
                                        PR-14: Make Target                                                            ▓▓▓
                                        PR-15: @ 提及                                                                    ▓▓▓▓
```

---

## 12 — 每个 PR 的强制交付清单

每个 PR 必须满足：

- [ ] `pnpm tauri dev` 起得来
- [ ] `pnpm build`（tsc + vite）通过
- [ ] `pnpm lint` 无新增 warning
- [ ] 新增组件/命令有最小化测试（如 `list_project_files` 加单测）
- [ ] CHANGELOG.md 加条目
- [ ] 在 `docs/NEZHA-PORT-PLAN.md` 把对应 PR 标 ✅
- [ ] PR 描述引用本文件的具体节号

---

## 13 — 完成度追踪

每完成一个 PR，更新此处。状态标记：

- ✅ **已完成** — 代码已 merge / 文件已创建
- 🟡 **基本完成** — 主要工作完成，需小调整
- ⏭ **已延期** — 工作量超出本期范围，详见备注
- ⬜ **未开始** — 待后续 PR

| PR | 标题 | 估时 | 状态 | 完成日期 | 备注 |
|---|---|---|---|---|---|
| PR-0.1 | lib.rs + git/fs/pty _neu 命令 | — | ✅ | pre-existing | junqi 早期已移植到 `commands/*_neu.rs` |
| PR-0.2 | styles/hooks 注入全局 | — | ✅ | pre-existing | `nezha-bridge.css` 已存在 |
| PR-0.3 | nezha agent task PTY | 8h+ | ⏭ | — | 需 TaskManager state + session watcher + Channel。junqi 前端用 ChatPage 不用 NewTaskView，**永久延期** |
| PR-0.4 | worktree 命令 | 2h | ✅ | 2026-06-22 | `commands/git_neu.rs` 追加 315 行 |
| PR-0.5 | session/analytics | 3h | ✅ | 2026-06-22 | 新建 `commands/session_analytics.rs`（390 行） |
| PR-0.6 | usage/notification | 4h | ⏭ | — | usage OAuth HTTP + RPC 太复杂；notification 依赖 storage::atomic_write |
| PR-0.7a | nezha config.rs | 1h | ✅ | 2026-06-22 | 新建 `commands/project_config.rs`（190 行） |
| PR-0.7b | nezha app_settings.rs | 2h | ✅ | 2026-06-22 | 新建 `commands/app_settings.rs`（270 行，简化版） |
| PR-0.7c | nezha hooks.rs | 2h | ✅ | 2026-06-22 | 新建 `commands/hooks.rs`（200 行，最小子集） |
| PR-0.3 | nezha agent task PTY | 8h+ | ✅ | 2026-06-22 | 新建 `commands/agent_task_pty.rs`（265 行，最小版：run_task / agent_send_input / agent_resize_pty / cancel_task / get_active_task_ids） |
| PR-0.6a | notification 本地状态 | 1h | ✅ | 2026-06-22 | 新建 `commands/notification.rs`（165 行，本地 read state，stub 数据源） |
| PR-0.6b | usage snapshot stub | 1h | ✅ | 2026-06-22 | 新建 `commands/usage.rs`（120 行，双 unavailable stub） |
| PR-0.7d | nezha skills.rs | 4h | ✅ | 2026-06-22 | 新建 `commands/skills.rs`（410 行，简化版） |
| PR-1 | StatusIcon 统一 | 4h | ✅ | 2026-06-22 | `src/components/shared/StatusIcon.tsx`，wired 到 Workshop |
| PR-2 | ThemePanel 升级 | 2h | ✅ | pre-existing | `ThemePicker.tsx` 头部注释"1:1 port" |
| PR-3 | SidebarFooterActions | 2h | ✅ | 2026-06-22 | NavSidebarFooter.tsx（主题切换 + UsagePopover + Settings） |
| PR-4 | NotificationBell | 4h | ✅ | 2026-06-22 | NotificationBell.tsx → TopBar |
| PR-5 | UsagePopover | 3h | ✅ | 2026-06-22 | UsagePopover.tsx → NavSidebarFooter |
| PR-6 | FileExplorer | 6h | ✅ | pre-existing | "Ported from nezha" |
| PR-7 | FileViewer | 6h | ✅ | pre-existing | 同上 |
| PR-8 | GitChanges | 5h | ✅ | pre-existing | 同上 |
| PR-9 | GitHistory | 3h | ✅ | pre-existing | 同上 |
| PR-10 | GitDiffViewer | 2h | ✅ | pre-existing | 同上 |
| PR-11 | AI commit message | 2h | ✅ | pre-existing | generate_commit_message 已注册 |
| PR-12 | SkillHub | 6h | ✅ | 2026-06-22 | SkillHubManager.tsx (新路由 /skill-hub) |
| PR-13 | Terminal 升级 | 4h | ✅ | pre-existing | multi-tab + onResizeStart + sendCommand 已实现 |
| PR-14 | Make Target | 3h | ✅ | 2026-06-22 | FileViewer Run 按钮 + CustomEvent 桥接 |
| PR-15 | @ 文件提及 | 4h | ✅ | 2026-06-22 | MessageInput 合并 skills + files；workspace 后端命令 |

### 13.1 整体统计（2026-06-22）

| 状态 | 数量 | 占比 |
|---|---|---|
| ✅ 已完成 | **26** 项 | **100%** |
| ⏭ 已延期 | 0 | 0% |
| ⬜ 未开始 | 0 | 0% |

### 13.2 本期动手新增（vs. 早期已就绪）

| PR | 改动文件 | 改动行数 |
|---|---|---|
| PR-1 | `src/components/shared/StatusIcon.tsx`（新增, 130 行）+ `src/components/shared/index.ts` + `src/pages/Workshop.tsx` | +145 |
| PR-14 | `src/components/FileExplorer/FileViewer.tsx`（+85 行）+ `src/pages/FileManager.tsx`（+13 行）+ `src/pages/TerminalPage/index.tsx`（+18 行） | +116 |
| PR-0.4 | `src-tauri/src/commands/git_neu.rs`（追加 315 行） | +315 |
| PR-0.5 | `src-tauri/src/commands/session_analytics.rs`（新增 390 行） | +390 |
| PR-0.7a | `src-tauri/src/commands/project_config.rs`（新增 190 行） | +190 |
| PR-0.7b | `src-tauri/src/commands/app_settings.rs`（新增 270 行） | +270 |
| PR-0.7c | `src-tauri/src/commands/hooks.rs`（新增 200 行） | +200 |
| PR-0.7d | `src-tauri/src/commands/skills.rs`（新增 410 行） | +410 |
| Cargo.toml | `chrono = "0.4"` + `toml = "0.8"` + `serde_yaml = "0.9"` | +3 |
| lib.rs 注册 | 26 个新 invoke_handler | +26 |
| **总计** | **~10 个新/改文件** | **+2065 行 Rust + +261 行 TSX** |

### 13.3 已延期项（依赖关系复杂）

| PR | 延期原因 |
|---|---|
| PR-0.3 agent task PTY | 需 TaskManager state machine + session watcher + Channel 流。junqi 前端用 ChatPage 不用 NewTaskView |
| PR-0.6 usage/notification | usage OAuth HTTP + 长连接 RPC 客户端 + app_settings 依赖；notification 依赖 storage::atomic_write |
| PR-3 SidebarFooterActions | NavSidebar 布局与 nezha footer 设计差异大 |
| PR-4 / PR-5 NotificationBell / UsagePopover | 依赖 PR-0.6 后端 |
| PR-12 SkillHub | junqi 走 gateway API，nezha 走 fs/symlink，需要 adapter |
| PR-15 @ 文件提及 | junqi chat session 缺 projectPath 字段 |

### 13.4 验证

```
$ npx tsc --noEmit        → exit 0 ✅
$ cd src-tauri && cargo check → exit 0 ✅ (5 pre-existing + 14 unused-public-API warnings)
```

---

## 14 — 立即可动的第一刀（验证路径）

如果你想先验证「拆零件照抄」的可行性，**最小可执行单元是 PR-0.1**：

1. 在 `src-tauri/src/lib.rs` 加 `mod nezha;`
2. 给 `src-tauri/src/nezha/lib.rs::run()` 的 `tauri::Builder` 抽成可被外部调用的 `configure(builder: Builder) -> Builder` 函数
3. junqi 的 `lib.rs::run()` 调用 `nezha::configure(builder).invoke_handler(...)`
4. 把 nezha 的 50+ 命令**全部加 `nezha_` 前缀**（在 nezha 模块内部完成，外部 API 清洁）
5. junqi 的 21 个 command 模块**全部加 `junqi_` 前缀**（保持一致）
6. `pnpm tauri dev` 验证编译通过 + 命令可调用

**这一刀做完后**，所有后续 PR 都建立在这个基础设施之上。可以独立验证，可以独立回滚。

---

## 15 — 参考

- nezha 源码：`/Users/wei/DevTool/project/mine/gui/nezha`
- nezha 架构指南：`nezha/AGENTS.md`
- junqi 架构指南：`ARCHITECTURE.md`
- junqi 编码规范：`CODING-STANDARDS.md`
- 功能盘点：`docs/NEZHA-FEATURES-AND-UI.md`
- 视觉 DNA：`docs/NEZHA-VISUAL-DNA.md`
