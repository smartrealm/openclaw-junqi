# Nezha 功能与 UI 交互详解

> **Status**: feature inventory（功能盘点）
> **Source**: hanshuaikang/nezha
> **Target**: openclaw-junqi（用于功能对比与移植决策）
> **Branch**: `feat/port-nezha-fullsuite`
>
> **See also**: 视觉设计系统（颜色 / 间距 / 排版）见 [`NEZHA-VISUAL-DNA.md`](./NEZHA-VISUAL-DNA.md)。

本文档逐项列出 Nezha 已交付的功能模块、用户可触发的 UI 交互以及对应的实现位置（`nezha/path/to/file.tsx`），作为 openclaw-junqi 在「功能覆盖度」维度的对标基准。视觉相关的细节请参考 `NEZHA-VISUAL-DNA.md`。

> **文档分工**：
> - 本文档负责**功能模块与 UI 交互盘点**（含覆盖度矩阵）。
> - `NEZHA-VISUAL-DNA.md` 负责**视觉设计系统**（颜色、间距、排版、六维设计纪律）。
> 两者职责互不重叠，PR 同时涉及视觉与功能时应在两份文档中分别引用。

---

## 0 — 项目定位

Nezha 是面向 AI 编程智能体（Claude Code、Codex）的**桌面任务管理器**：

- 技术栈：Tauri 2 + React 19 + TypeScript（前端）/ Rust（后端）+ xterm.js + Shiki
- 跨平台：macOS / Windows / Linux，安装包 ~7MB
- 设计哲学：**Agent-First**——人写的代码越来越少，AI 写的越来越多，Nezha 把多项目管理、任务生命周期、终端、Skill 管理、Git 工作流整合进同一个界面

> 核心口号：「三头六臂，并发编程」——同时跟踪多个项目的多个 Agent 会话。

---

## 1 — 顶层架构

### 1.1 状态管理

- **不引入外部状态库**（无 Redux/Zustand），跨项目/跨面板的核心状态集中在 `App.tsx` 并通过 props 透传
- 组件内短生命周期 UI 状态保留在各自组件内
- 异步更新通过 **Tauri Channel / 事件总线** 推送到前端

### 1.2 后端通信通道

| 通道 | 用途 | 实现位置 |
|---|---|---|
| `tauri::ipc::Channel<String>` | agent 任务输出 | `run_task` / `resume_task` 的 `onOutput`（绕过事件总线全局广播，直投 `useTerminalManager`） |
| `task-status` 事件 | `{ task_id, status }` 生命周期变更 | `pty.rs` |
| `task-session` 事件 | `{ task_id, session_id, session_path }` 会话发现 | `session.rs` |
| `shell-output` 事件 | `{ shell_id, data }` 嵌入 Shell 字节流 | `pty.rs` |

### 1.3 持久化（基于文件，非 localStorage）

```
~/.nezha/projects.json                              # Project[]
~/.nezha/projects/<projectId>/tasks.json            # Task[]
~/.nezha/settings.json                              # 应用级 agent 路径与版本
<project>/.nezha/config.toml                        # 项目级 agent 默认值 + git 配置
<project>/.nezha/attachments/<taskId>/             # 图片附件
```

### 1.4 任务状态机

```
todo → pending → running ↔ input_required → done | failed | cancelled
                        ↘ interrupted → resume
                        ↘ detached → reconnect
```

---

## 2 — 顶层导航与多项目工作区

### 2.1 WelcomePage（首页 / 项目选择页）

**入口位置**：`src/components/WelcomePage.tsx`

- **三视图切换侧栏**（`Layers` / `Clock` / `Blocks` 图标）：
  - `Projects`：项目列表（默认）
  - `Timeline`：跨项目时间线
  - `Skill Hub`：技能集
- **搜索框**：按项目名/路径模糊匹配（NFKC + 大小写归一化），Focus 时边框高亮 + 强调光环
- **项目卡片**：悬浮高亮（背景 + 边框 + avatar 阴影），显示项目名、缩短路径、当前 Git 分支徽章或 "Local" 标签
- **Pin / Unpin 按钮**：控制 `project.hiddenFromRail`，决定是否在 ProjectRail 常驻
- **删除按钮**：悬浮出现，点击后弹出系统确认
- **空状态**：
  - 无项目：引导打开项目文件夹（系统文件夹选择器）
  - 搜索无结果：提示「未找到匹配项目」

### 2.2 ProjectRail（左侧竖条）

**入口位置**：`src/components/ProjectRail.tsx`

- **常驻项目头像**（36×36）：点击切换项目，激活态 2px accent 描边
- **状态指示器**：
  - 绿色圆点：`running` / `pending`
  - 黄色数字角标（≤99 或 99+）：`input_required`（可切换为圆点模式）
- **wave 招手动画**：每次待确认任务数增加触发一次 3.6s Claude mascot 招手 gif
- **底部按钮**：
  - `>>` 展开 ProjectDrawer（搜索过滤 + 全部项目列表）
  - `+` 添加新项目（系统文件夹选择器）
- **singleProjectMode**：在 Skill Hub 内只显示一个项目，不显示 add/expand 按钮

### 2.3 TimelineView（跨项目时间线）

**入口位置**：`src/components/TimelineView.tsx`

- **时间桶分组**：`today` / `yesterday` / `earlier`（仅最近 7 天）
- **二级按项目分组**：每组内任务按时间倒序
- **任务行**：时间戳（HH:MM）、状态图标、标题、agent 类型、Diff 增删行数（`+N / -M`）
- **点击跳转**：跳转到任务所在项目的 ProjectPage，激活该任务
- 点击 hub 项目任务则自动进入 Skill Hub

---

## 3 — 项目视图（ProjectPage）

**入口位置**：`src/components/ProjectPage.tsx`

布局结构：`ProjectRail` | `TaskPanel` | `MainContent`（文件查看 / Diff / 任务视图 / 终端） | `RightToolbar`

### 3.1 TaskPanel（任务列表侧栏）

**入口位置**：`src/components/TaskPanel.tsx`

#### 折叠态
- 仅显示项目头像（24×24）、`+` 新建按钮、亮/暗切换按钮
- 有注意力任务时显示红点

#### 展开态
- **项目头部**：返回按钮、项目头像、项目名、折叠按钮
- **搜索框**：按任务名/提示词过滤
- **BranchBar**：Git 分支切换/创建
- **新建任务按钮**：高亮当前态
- **任务计数** + **Clear All** 按钮
- **TaskList**：
  - 星标置顶
  - 运行次数徽章
  - 状态图标 + 名称 + agent 类型 + permission 模式 + 时间
- **底部 SidebarFooterActions**：主题切换、字号、显示窗口、注意力角标开关

### 3.2 BranchBar（Git 分支切换/创建）

**入口位置**：`src/components/task-panel/BranchBar.tsx`

- 显示当前分支徽章
- 分支下拉：搜索过滤 + 远程/本地分组 + 点击切换
- 创建新分支按钮（弹出输入对话框）
- 拉取 / 推送 / 刷新操作

---

## 4 — 新建任务视图（NewTaskView）

**入口位置**：`src/components/NewTaskView.tsx`

### 4.1 顶部

- 动态 GIF 头图（`claude.gif` / `codex.gif`，随 agent 切换）
- **Missing CLAUDE.md / AGENTS.md 警告横幅**（项目级检测） + 一键初始化按钮（调用 agent 生成）

### 4.2 PromptEditor（富文本编辑器）

**入口位置**：`src/components/new-task/PromptEditor.tsx`

- **contenteditable 富文本**
- **@ 文件提及**：
  - `@` 触发弹窗（当前项目 8 条 + 其他项目 5 条候选）
  - `项目名/` 跨项目文件提及（懒加载目标项目文件列表）
  - 上下键导航，Enter 插入为带 `data-file-path` 属性的 chip
  - MentionPopover 浮层，含 loading / cross-mode / cross-loading 状态
- **图片粘贴**：从剪贴板粘贴，FileReader 转 dataURL，显示缩略图
- **大文本粘贴**（>2KB）：自动转为文本附件，避免大块文本阻塞编辑器
- **Hook 就绪软提示**：agent 版本过低 / 无 node / 未安装（不阻塞任务启动）
- **草稿恢复**：切换视图前缓存到 `ref`，返回时自动还原（含 promptHtml / agent / perm / 图片 / 文本 / 启动模式 / baseBranch）

### 4.3 工具栏（AgentPermSelector）

**入口位置**：`src/components/new-task/AgentPermSelector.tsx`

- **Agent 切换**：Claude Code / Codex（带 logo）
- **Permission Mode 切换**：
  - `ask` → `--permission-mode default`
  - `auto_edit` → `--permission-mode acceptEdits`（Codex 下显示 "Auto Mode"）
  - `full_access` → `--dangerously-skip-permissions`
- **Plan Mode 切换**：提交时附加 "Please use plan mode."
- **图片附件按钮**：打开系统文件选择器添加图片
- **Save as Todo 按钮** + **Send 按钮**

### 4.4 启动模式（LaunchModeSelector）

**入口位置**：`src/components/new-task/LaunchModeSelector.tsx`

- `local`：本地直接启动（默认）
- `worktree`（Git Worktree 模式）：
  - **Base branch 选择**：当前 / 所有本地 / 所有远程分支过滤
  - 验证分支存在
  - 发送按钮强制立即执行（不可保存为 todo）

### 4.5 附件行

- 图片缩略图：悬浮显示删除按钮
- 文本附件：显示字符数，悬浮删除

### 4.6 发送快捷键

- 自定义发送快捷键（从 `app_settings` 读取，默认 `Cmd/Ctrl+Enter`）
- 监听 `nezha:app-settings-changed` 事件实时更新
- 平台感知显示（macOS 显示 ⌘，Windows/Linux 显示 Ctrl）

---

## 5 — Todo 任务视图（TodoTaskView）

**入口位置**：`src/components/TodoTaskView.tsx`

- 卡片式展示提示词
- Agent + Permission 模式标签
- **编辑按钮** → TaskEditDialog（修改提示词、agent、permission）
- **Run Now 按钮** → 启动任务

---

## 6 — 运行中视图（RunningView）

**入口位置**：`src/components/RunningView.tsx`

### 6.1 头部信息栏

- **任务标题**：点击编辑、Sparkles 按钮调用 agent 生成名称
- **运行次数徽章**
- **状态指示**：
  - `pending` / `running` / `input_required`：实时终端
  - `detached`：终端断开提示 + Reconnect 按钮
  - `interrupted`：可恢复横幅
  - `done` / `failed` / `cancelled`：会话回放
- **Session 指标**（每 30s 轮询 `read_session_metrics`）：
  - 会话时长（自动格式化为 `Xd Yh Zm Ws`）
  - Token 用量（总数 + 上下文占用 + 上下文窗口）
  - 会话文件大小
- **Usage 内嵌窗口**：Claude Code / Codex 用量快照（5h / 7d 剩余百分比 + 重置时间，按百分比着色）
- **Worktree 操作**：
  - `Merge`：合并 worktree 回 base 分支（带 +N / -M 行数统计）
  - `Discard`：丢弃 worktree（标记 `worktreeDiscarded`，禁用后续 resume）
- **Export Session**：保存会话为 Markdown（文件名 slug 化 + 日期）
- **Cancel / Resume / Reconnect / Mark Done 按钮**

### 6.2 TerminalView（xterm.js 封装）

**入口位置**：`src/components/TerminalView.tsx`

- WebGL 渲染（动态加载 webgl addon，失败时降级到 DOM）
- 智能复制：选中即复制 OS 剪贴板
- IME 输入修复（Linux / macOS WebKit Shift 输入）
- 主题适配（5 种主题）
- 字体大小 / 字体族实时切换
- **快照保存**：每 500ms 保存当前 buffer 到 snapshot，避免切换任务后丢失内容

### 6.3 SessionView（会话消息查看器）

**入口位置**：`src/components/SessionView.tsx`

- JSONL 回放：解析 `~/.claude/projects/` 或 `.codex/sessions/`
- **用户消息气泡**：右对齐、悬浮显示 Copy 按钮（点击后 1.5s 显示对勾）
- **助手消息**：
  - **thinking 块**：默认折叠，点击展开（斜体 + 引用线样式）
  - **text 块**：通过 `marked` 渲染 Markdown
  - **tool_use 块**：默认折叠，显示工具名 + 输入参数（max-height 280）
- 加载中 / 错误 / 空状态

---

## 7 — 右工具栏与右侧面板（RightToolbar）

**入口位置**：`src/components/RightToolbar.tsx`

### 7.1 顶部图标按钮（互斥单选）

- **Files**（文件浏览器）
- **Git Changes**（变更）
- **Git History**（历史）

### 7.2 中部

- **Terminal**（嵌入 Shell 终端，可独立开关）

### 7.3 搜索按钮

- 打开 FileSearchDialog：模糊搜索文件路径

### 7.4 设置按钮（齿轮）

- 打开 SettingsDialog（项目级）或 AppSettingsDialog（应用级，通过 `OPEN_APP_SETTINGS_EVENT` 触发）

---

## 8 — 文件浏览器（FileExplorer）

**入口位置**：`src/components/FileExplorer.tsx`

### 8.1 树形结构

- **虚拟滚动**（基于 `ROW_HEIGHT` + ResizeObserver）
- **自动刷新**：每 60s、窗口聚焦、`visibilitychange` 时刷新
- **Context Menu**（右键）：
  - 在系统文件夹中打开（`open_in_system_file_manager`）
  - 复制路径 / 复制 `@路径`
  - 新建文件 / 新建文件夹（内联输入行）
  - 删除（带系统确认）
  - 重命名（内联编辑）

### 8.2 顶部按钮

- 刷新按钮（点击 + 自动刷新）
- 折叠 / 展开全部

---

## 9 — 文件查看器（FileViewer）

**入口位置**：`src/components/FileViewer.tsx`

### 9.1 多 Tab 支持

- 标签栏：当前激活 tab、关闭按钮、右键菜单（关闭其他 / 右侧 / 左侧 / 全部）

### 9.2 Markdown 文件

- **双视图切换**：`Edit`（CodeMirror）/ `Preview`（渲染）
- **TOC 锚点**：右侧目录树，点击跳转
- DOMPurify 净化 + 自定义 heading id
- **大纲提取**单次渲染保证 HTML id 与 TOC 一致

### 9.3 代码文件

- **多语言高亮**（按需动态导入）：TS/JS、Rust、Python、Go、Java、C++、CSS、HTML、JSON、YAML、SQL、XML、Shell、TOML、Dockerfile、Ruby、Lua、Swift、Kotlin、C#、R
- **特殊文件名映射**：Dockerfile / Makefile / Vagrantfile / Procfile / .env / .gitignore 等
- 3 套主题（GitHub Dark / Light、solarizedLight）
- 文件颜色侧栏（基于扩展名）

### 9.4 图片文件

- ImagePreviewPane：缩放、适应窗口
- 支持 PNG / JPG / JPEG / GIF / WebP / BMP / SVG

### 9.5 Make 目标集成

- 检测 `Makefile` 中的目标，渲染 Run 按钮
- 点击 → 通过 Shell Terminal Panel 执行 `make <target>`（面板未显示则延迟到挂载后执行）

---

## 10 — Git 变更（GitChanges）

**入口位置**：`src/components/GitChanges.tsx`

### 10.1 视图切换

- **Task 模式**：仅显示自 `currentTaskCreatedAt` 以来 staged 的文件
- **All 模式**：全部未提交变更

### 10.2 列表分组

- **Staged**（已暂存）
- **Unstaged**（未暂存）
- **Untracked**（未跟踪）
- 每组可折叠 / 展开
- **GitFileBrowser**：树形 / 列表视图切换（持久化到 localStorage）

### 10.3 单文件操作

- 鼠标悬浮行：显示 Stage / Unstage、Undo
- 目录级 Stage All / Unstage All / Discard
- 文件过滤（Filter 输入框）

### 10.4 提交区

- **Commit Message** 多行输入框
- **AI 生成按钮**（Sparkles）：调用 agent 基于 diff 生成提交信息（带超时，配置项 `commit_message_timeout_secs`）
- **Commit 按钮**：执行 `git commit`

### 10.5 文件点击

- 触发 GitDiffViewer 显示该文件的 diff
- **联动折叠 TaskPanel**（自动给 diff 留出空间）

---

## 11 — Git 历史（GitHistory）

**入口位置**：`src/components/GitHistory.tsx`

### 11.1 顶部

- **分支下拉**（搜索过滤，远程 / 本地分支）
- **Ahead / Behind 计数** + Push / Pull 按钮
- **刷新按钮**
- **搜索框**（按 commit message / 作者 / hash 过滤）

### 11.2 Commit 列表

- 显示 hash（短）、作者、相对时间、message、refs（标签 / 分支）
- 选中后右侧展开详情

### 11.3 Commit 详情

- 文件列表（status、+N / -M）
- **整体 diff**（点击 "View diff"）→ GitDiffViewer
- **单文件 diff** → GitDiffViewer（commit-file 模式）

---

## 12 — Diff 查看器（GitDiffViewer）

**入口位置**：`src/components/GitDiffViewer.tsx`

### 12.1 三种模式

- `commit`：整个 commit 的 diff
- `commit-file`：commit 中的单个文件
- `file`：工作树单文件（staged / unstaged）

### 12.2 视图模式

- **Unified**（单列）
- **Split**（双列对比）
- 持久化到 localStorage

### 12.3 内容

- 解析 unified diff → 文件块
- 每行着色：新增（绿）、删除（红）、上下文
- 显示文件级 +N / -M

---

## 13 — 嵌入 Shell 终端（ShellTerminalPanel）

**入口位置**：`src/components/ShellTerminalPanel.tsx`

### 13.1 多 Tab

- 同时最多 **5 个** shell 会话
- `+` 创建新 shell，标签名 `Terminal 1-5`
- 关闭按钮

### 13.2 底层

- 基于 xterm.js + PTY
- 监听 `shell-output` 事件（`{ shell_id, data }`）
- 暴露 `sendCommand(cmd)` API（用于 Run Make Target 等联动）

### 13.3 调整

- 顶部拖拽手柄调整高度
- 字体大小 / 字体族实时切换
- 主题切换

---

## 14 — 项目设置（SettingsDialog）

**入口位置**：`src/components/SettingsDialog.tsx`

- **Agent 默认值**：默认 agent + 默认 permission mode
- **Prompt Prefix**：自动拼接到每个任务提示词
- **Git Commit Prompt**：生成 commit 信息的提示模板
- **Commit Message Timeout**（1-120 秒）
- 保存到 `.nezha/config.toml`

---

## 15 — 应用设置（AppSettingsDialog）

**入口位置**：`src/components/AppSettingsDialog.tsx`

按分组（application / agents / community / about）：

### 15.1 General（通用）

- **应用语言**：English / 中文
- **任务显示窗口**：最近 3 / 7 / 15 / 30 天 / 全部
- **注意力角标开关**：是否在项目头像上显示数字角标

### 15.2 Theme（主题）

- **Follow System**（带 Monitor 图标开关）
- 4 种手动主题（每种带实时预览缩略图）：
  - **Dark**（深色）
  - **Midnight**（午夜黑）
  - **Light**（浅色）
  - **Eyecare**（护眼米色）
- 支持键盘导航（ArrowKeys / Home / End）

### 15.3 Fonts（字体）

- UI 字体选择器（带预览）
- Mono 字体选择器（带预览，平台默认提示）

### 15.4 Shortcuts（快捷键）

- **发送快捷键**自定义（`Cmd/Ctrl+Enter` 等）
- 平台感知显示

### 15.5 Hooks（Hook）

- 显示 agent 的 hook 就绪状态
- 版本要求、node 检测、未安装警告

### 15.6 Skills（技能集）

- Skill 软链管理（参见 Skill Hub 部分）

### 15.7 Claude Code / Codex

- 直接编辑 `~/.claude/settings.json` 或 `~/.codex/config.toml`
- JSON / TOML 语法高亮

### 15.8 Community / About / Thanks

- 微信群链接、致谢面板

---

## 16 — Skill Hub（技能集）

### 16.1 设置

- 在 AppSettingsDialog 中**指定一个项目作为 Hub**（保存到 `skillHubConfig`）
- Hub 内的 `skills/` 目录被识别为 Skill 源

### 16.2 WelcomePage → Skill Hub 视图

**入口位置**：`src/components/skill-hub/SkillHubView.tsx`

- 空状态：引导用户去 App Settings 设置 Hub
- 配置后：显示所有 Skill 列表
  - Skill 名（frontmatter 的 name / 目录名）
  - 描述
  - 安装状态（已安装到几个项目）
  - 操作按钮：管理、删除（带确认）

### 16.3 SkillManageDialog

- 显示该 Skill 在所有项目中的安装情况
- **安装**：通过软链安装到指定项目指定 agent 的 skills 目录
- **冲突处理**：
  - detect / skip / overwrite / cancel
  - 检测 broken / diverged 健康状态
- **删除**：批量移除所有软链

### 16.4 进入 Skill Hub 项目

- 进入 singleProjectMode 的 ProjectPage
- 任务列表中可以看到该项目的任务
- 右侧 TaskPanel 的 backTitle 改为「返回 Skill Hub」

---

## 17 — 通知系统（NotificationBell）

**入口位置**：`src/components/NotificationBell.tsx`

### 17.1 触发

- 任务需要人工介入（input_required / detached / interrupted）
- 应用 badge 自动更新（macOS）

### 17.2 弹窗

- 显示通知列表（info / warning / error 三级图标）
- 支持中英双标题 / 正文
- 未读高亮（accent 背景）
- 单条标记已读 / 一键全部已读
- 点击带 URL 的通知打开外部链接
- 加载 / 错误 / 空状态

---

## 18 — Agent 用量（UsagePopover）

**入口位置**：`src/components/UsagePopover.tsx`

### 18.1 数据源

- Claude Code：5h / 7d 用量窗口
- Codex：primary（5h）/ secondary（7d）

### 18.2 显示

- Activity 图标触发 Popover
- 按用量百分比着色（绿 / 黄 / 红）
- 显示重置时间
- unavailable 时显示原因

---

## 19 — 错误边界与提示

### 19.1 ErrorBoundary

- 包裹主内容区、文件浏览器、Git 变更、Git 历史
- 错误时显示带 Retry / 返回任务视图按钮的友好提示

### 19.2 Toast

- 全局 toast 系统
- 类型：info / warning / error
- 用于操作反馈（加载项目文件失败、复制成功等）

### 19.3 StatusIcon

- 统一的状态图标（按 `TaskStatus` 渲染）

---

## 20 — 关键交互细节速查

| 操作 | 触发位置 |
|---|---|
| 搜索文件 | 全局搜索按钮 / FileSearchDialog |
| 切换项目 | ProjectRail 点击 / WelcomePage 卡片点击 |
| 折叠任务面板 | TaskPanel 头部折叠按钮 |
| 切换主题 | TaskPanel 折叠态底部按钮 / AppSettings → Theme |
| 发送任务 | 自定义快捷键（默认 `Cmd/Ctrl+Enter`） |
| Stage / Unstage | GitChanges 鼠标悬浮 |
| 关闭 diff | GitDiffViewer 头部 X |
| 关闭 tab | FileViewer 标签右键菜单 |
| 切换 right panel | RightToolbar 单击（toggle） |
| 标记任务已读 | NotificationBell 单条 / 全部已读 |
| Worktree 操作 | RunningView 头部 Merge / Discard |
| 恢复中断任务 | RunningView 头部 Resume |

---

## 21 — 关键设计亮点（移植参考）

1. **xterm 性能优化**：同时只挂载一个任务的 xterm 实例，其他任务用 snapshot 序列化卸载，避免 GPU 内存累积
2. **CJK IME 修复**：macOS WKWebView 下隐藏非激活项目（`display:none` 而非 `visibility:hidden`），避免中文 IME 拖选触发 NSTextInputClient hit-test 风暴
3. **PTY 输出批处理**：Channel + RAF 批量写入，避免每条输出触发 setState
4. **会话自动发现**：监听 Claude Code（`~/.claude/projects/`）和 Codex（`.codex/sessions/`）的 JSONL 新文件，按项目路径 / 提示词 / 时间戳匹配
5. **Worktree 任务**：独立 worktree 路径，独立 commit，结束时统计相对 baseBranch 的 +N / -M，支持 Merge / Discard
6. **持久化防丢失**：草稿缓存到 ref，切换视图不丢未发送内容
7. **CSS-in-JS 模块化**：`src/styles/` 下按 layout / panels / task / terminal / dialogs / common 拆分，禁止引入 Tailwind 等框架
8. **路径安全**：所有 Tauri 命令验证路径必须位于项目目录内，防目录遍历
9. **任务列表虚拟滚动**：`TaskListItem` memo + 长列表虚拟化，避免 5000+ 消息卡顿
10. **AI 生成名称 / Commit Message**：调用 agent 的 hook，未就绪时降级为轮询

---

## 22 — 功能覆盖度矩阵（openclaw-junqi 对标参考）

> 此节用于本项目自身评估——每行打勾表示已实现 / 待实现 / 不计划。

| 模块 | Nezha | openclaw-junqi |
|---|---|---|
| 多项目工作区 | ✅ | TBD |
| 任务状态机 | ✅ | TBD |
| xterm 实时终端 | ✅ | TBD |
| 会话自动发现 | ✅ | TBD |
| 多 agent 切换（Claude/Codex） | ✅ | TBD |
| 权限模式（ask/auto_edit/full_access） | ✅ | TBD |
| Git Worktree 任务 | ✅ | TBD |
| Git Changes / History / Diff | ✅ | TBD |
| Makefile 一键运行 | ✅ | TBD |
| 文件浏览器（虚拟滚动） | ✅ | TBD |
| 文件查看器（多 Tab） | ✅ | TBD |
| Markdown 编辑器（预览 + TOC） | ✅ | TBD |
| 多语言代码高亮 | ✅ | TBD |
| 嵌入 Shell 终端（多 Tab） | ✅ | TBD |
| 5 套主题（dark / midnight / light / eyecare / system） | ✅ | TBD |
| 字体 / 快捷键 / 语言设置 | ✅ | TBD |
| 多语言（EN / 中文） | ✅ | TBD |
| 通知系统 + 应用角标 | ✅ | TBD |
| Agent 用量面板 | ✅ | TBD |
| Skill Hub（软链管理） | ✅ | TBD |
| AI 生成任务名 / Commit Message | ✅ | TBD |
| 会话导出 Markdown | ✅ | TBD |
| 任务时间线（跨项目） | ✅ | TBD |
| Project Pin / Unpin | ✅ | TBD |
| 启动模式（local / worktree） | ✅ | TBD |
| 图片 / 文本附件 | ✅ | TBD |
| @ 文件提及（含跨项目） | ✅ | TBD |
| 草稿缓存 | ✅ | TBD |
| ErrorBoundary | ✅ | TBD |
| Toast 全局提示 | ✅ | TBD |
| 状态图标统一 | ✅ | TBD |

---

## 23 — 文件清单（按模块）

### 23.1 前端 React 组件

| 模块 | 入口 | 关键子组件 |
|---|---|---|
| 顶层 | `App.tsx` | — |
| 首页 | `WelcomePage.tsx` | `TimelineView.tsx`、`SkillHubView.tsx` |
| 项目页 | `ProjectPage.tsx` | `ProjectRail.tsx`、`TaskPanel.tsx`、`RightToolbar.tsx` |
| 新建任务 | `NewTaskView.tsx` | `new-task/PromptEditor.tsx`、`MentionPopover.tsx`、`ImageAttachments.tsx`、`TextAttachments.tsx`、`AgentPermSelector.tsx`、`LaunchModeSelector.tsx` |
| 运行中 | `RunningView.tsx` | `TerminalView.tsx`、`SessionView.tsx` |
| 文件 | `FileExplorer.tsx`、`FileViewer.tsx` | `file-explorer/{TreeItem,ContextMenu,CreateInputRow,SearchPanel,FileIcon}.tsx`、`file-viewer/ImagePreviewPane.tsx` |
| Git | `GitChanges.tsx`、`GitHistory.tsx`、`GitDiffViewer.tsx` | `git-view/GitFileBrowser.tsx`、`git-diff/{DiffFileBlock,parse}.ts(x)` |
| 终端 | `ShellTerminalPanel.tsx` | — |
| 设置 | `SettingsDialog.tsx`、`AppSettingsDialog.tsx` | `app-settings/{General,Theme,Font,Shortcuts,Hooks,Skills,AgentConfig,About,Thanks}Panel.tsx` |
| 通知 | `NotificationBell.tsx` | — |
| Skill Hub | `skill-hub/SkillHubView.tsx` | `skill-hub/{SkillInstall,SkillManage,SkillConflict}Dialog.tsx` |
| 通用 | `ErrorBoundary.tsx`、`Toast.tsx`、`StatusIcon.tsx`、`IconButton.tsx`、`ProjectAvatar.tsx`、`UsagePopover.tsx`、`SidebarFooterActions.tsx` | — |
| 任务面板 | `TaskPanel.tsx` | `task-panel/{BranchBar,TaskList,TaskListItem,TaskEditDialog}.tsx` |

### 23.2 后端 Rust 模块

| 模块 | 职责 |
|---|---|
| `lib.rs` | 注册所有 Tauri 命令 |
| `pty.rs` | 任务 / Shell 的 PTY 创建与读写（`run_task`、`resume_task`、`cancel_task`、`send_input`、`resize_pty`、`open_shell`、`kill_shell`） |
| `session.rs` | Claude & Codex 会话文件监听 + `read_session_messages` |
| `storage.rs` | 基于文件的持久化（`load_projects`、`save_projects`、`load_project_tasks`、`save_project_tasks`） |
| `fs.rs` | 文件系统命令（`read_dir_entries`、`read_file_content`、`read_image_preview`、`write_file_content`、`list_project_files`） |
| `git.rs` | 完整 Git 集成（status / branch / log / diff / stage / commit / push / pull / `generate_commit_message`） |
| `analytics.rs` | 解析会话 JSONL 获取 token / 工具调用指标（`read_session_metrics`） |
| `config.rs` | 项目级 `.nezha/config.toml` 管理 + agent 配置文件读写 |
| `app_settings.rs` | 应用级 agent 路径与版本管理（`load_app_settings`、`save_app_settings`、`detect_agent_paths`、`detect_agent_versions`） |

### 23.3 核心数据结构

```typescript
interface Task {
  id: string;
  projectId: string;
  name?: string;
  prompt: string;
  agent: "claude" | "codex";
  permissionMode: "ask" | "auto_edit" | "full_access";
  status: TaskStatus;  // todo/pending/running/input_required/detached/interrupted/done/failed/cancelled
  createdAt: number;
  attentionRequestedAt?: number;
  starred?: boolean;
  failureReason?: string;
  codexSessionId?: string;
  codexSessionPath?: string;
  claudeSessionId?: string;
  claudeSessionPath?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  baseBranch?: string;
  worktreeDiscarded?: boolean;
  additions?: number;
  deletions?: number;
}
```

---

## 24 — 参考资料

- **源码仓库**：`/Users/wei/DevTool/project/mine/gui/nezha`
- **README**：`nezha/README.md`、`nezha/README_EN.md`
- **架构指南**：`nezha/AGENTS.md`
- **类型定义**：`nezha/src/types.ts`
- **i18n 词条**：`nezha/src/i18n.tsx`
- **视觉 DNA**：`docs/NEZHA-VISUAL-DNA.md`（本仓库）