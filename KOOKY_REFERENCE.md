# KOOKY 设计参考文档

> kooky — macOS Swift 原生终端 APP（SwiftUI + SwiftTerm）。
> openclaw-junqi — Tauri 2 + React 18 + xterm.js 跨平台桌面终端。
> 本文档记录 kooky 功能清单、已完成 / 待移植功能、UI 设计语言对照及文件改动速查。

---

## 一、功能清单与移植状态对照表

| # | kooky 功能 | kooky 源文件 | 移植状态 | junqi 实现位置 | 备注 |
|---|-----------|-------------|---------|---------------|------|
| 01 | TerminalView (xterm 容器) | `TerminalSessionView.swift` | ✅ 已完成 | `ShellTerminalPanel.tsx` | xterm.js + FitAddon + WebGL |
| 02 | TabBarView (多 Tab 标签条) | `TabBarView.swift` | ✅ 已完成 | `TabShellItem` 组件 | 右键菜单、关闭、重命名 |
| 03 | PaneHierarchyView (分屏树) | `PaneHierarchyView.swift` | ✅ 已完成 | `PaneTreeView.tsx` | 递归 Split/Leaf |
| 04 | TerminalFontSize / Theme | `Settings/TerminalSettingsView.swift` | ✅ 已完成 | `_nezha-types.ts` + `terminalShared.ts` | 字体大小、主题切换 |
| 05 | AgentRunView (Agent 面板) | `Agent/AgentRunView.swift` | ✅ 已完成 | `AgentOverviewPanel.tsx` | claude/codex/pi |
| 06 | **PaneStatusBar** (底部状态栏) | `PaneStatusBar.swift` | ✅ 本次移植 | `PaneStatusBar.tsx` | Git 分支、diff、Composer 切换 |
| 07 | **PaneComposerBar** (内嵌 Prompt) | `PaneComposerBar.swift` | ✅ 本次移植 | `PaneComposerBar.tsx` | ⌘L 触发、Return 发送 |
| 08 | **WorkspaceSidebar** (工作区侧栏) | `SidebarView.swift` | ✅ 本次移植 | `TerminalPage/index.tsx` | 三态 full/compact/hidden |
| 09 | **TopStrip** (顶部工具条) | `TopStripView.swift` | ✅ 本次移植 | `TerminalPage/index.tsx` | 侧栏切换 + 搜索胶囊 + 铃铛 |
| 10 | **CommandPalette** (命令面板) | `CommandPaletteWindowController.swift` | ✅ 本次移植 | `TerminalPage/index.tsx` | ⌘P 工作区搜索 |
| 11 | **InboxBell** (通知收件箱) | `AgentInbox/InboxView.swift` | ✅ 本次移植 | `TerminalPage/index.tsx` | ⌘⇧I 通知列表 |
| 12 | Files sidebar | `FilesSidebarView.swift` | ⏳ 待规划 | - | 文件树侧栏 |
| 13 | Git sidebar | `GitSidebarView.swift` | ⏳ 待规划 | - | Git Changes/History |
| 14 | Settings window | `Settings/*.swift` | ⏳ 待规划 | - | 设置面板 |
| 15 | Profile / persona switching | `ProfileSwitcherView.swift` | ⏳ 待规划 | - | 多身份切换 |

---

## 二、已完成功能说明

### 2.1 TerminalView
- xterm.js 5.x + WebGL 渲染
- FitAddon 自适应容器大小
- PTY resize 自动同步后端
- 主题 / 字体大小 / 等宽字体 实时切换
- Mac WebKit Shift+字母输入修复
- Linux IME 修复
- 智能复制 (选中即复制)

### 2.2 TabBarView (Tab 标签条)
- 高度 32px (kooky 对齐)
- 活动 Tab: chromeActive 背景 + 主色文字
- 非活动 Tab: 60% 透明度
- 悬停显示关闭按钮
- 右键菜单: Close / Close Others / Close All / Rename
- 右侧 Split 按钮 (水平 / 垂直分屏)

### 2.3 PaneTreeView (分屏树)
- 递归渲染 Split (方向 + 比例) 和 Leaf (终端/Agent)
- 拖拽分隔条调整比例
- PaneNode 持久化到 localStorage (`workspace:v1`)

### 2.4 AgentOverviewPanel
- Agent 进程管理 (claude / codex / pi)
- 模式切换: full / compact
- 流式输出展示

---

## 三、待实现功能规划

| 功能 | 优先级 | 预计工作量 | 技术要点 |
|------|--------|-----------|---------|
| Files 侧栏 | P1 | 3d | Tauri `read_dir` + 虚拟滚动 |
| Git Changes 面板 | P1 | 2d | Tauri `git_diff` + diff 着色 |
| Git History 面板 | P2 | 2d | Tauri `git_log` + 时间线 UI |
| 设置窗口 | P2 | 5d | 字体 / 主题 / 快捷键 / 外观 |
| Profile 切换 | P3 | 3d | 多配置目录 / persona 隔离 |
| 会话恢复 (resume) | P2 | 4d | JSONL 回放 + Agent 上下文恢复 |

---

## 四、UI 设计语言对照

### 4.1 颜色 Token

| 用途 | kooky 原文 | junqi CSS 变量 |
|------|-----------|---------------|
| 终端背景 | `terminalBackground` (dark #0d1117) | `var(--terminal-bg)` |
| 面板背景 | `chromeBackground` | `var(--aegis-elevated)` |
| 主文字 | `primaryForeground` | `rgb(var(--aegis-text))` |
| 次要文字 | `secondaryForeground` (60% opacity) | `rgb(var(--aegis-text-dim))` |
| 禁用文字 | `tertiaryForeground` (40% opacity) | `rgb(var(--aegis-text-muted))` |
| 主色 | `tintColor` (accent blue) | `rgb(var(--aegis-primary))` |
| 悬停背景 | `foreground.opacity(0.06)` | `rgb(var(--aegis-overlay)/0.06)` |
| 活动背景 | `foreground.opacity(0.10)` | `rgb(var(--aegis-overlay)/0.10)` |
| 面板边框 | `foreground.opacity(0.07)` | `rgb(255 255 255 / 0.07)` |
| 输入边框 | `foreground.opacity(0.12)` | `rgb(255 255 255 / 0.12)` |
| 错误 / 红点 | `systemRed` | `rgb(239 68 68)` |
| 蓝色强调 | `systemBlue` | `rgb(59 130 246)` |

### 4.2 字体规范

| 场景 | 字号 | 字重 | 字体族 |
|------|------|------|--------|
| 终端内容 | 13 (默认) | 400 | `"JetBrains Mono", monospace` |
| Tab 标题 | 12 | 400 | `"JetBrains Mono", monospace` |
| 状态栏 pill | 11 | 400 | `"JetBrains Mono", monospace` |
| 侧栏标签 | 12 | 400 | `"JetBrains Mono", monospace` |
| 提示文字 | 10 | 400 | `"JetBrains Mono", monospace` |
| 搜索输入 | 13 | 400 | `"JetBrains Mono", monospace` |

### 4.3 分隔线规范 (chromeHairline)

所有面板分隔线统一使用：
```css
border-bottom: 1px solid rgb(255 255 255 / 0.07);
```
或等效 React 内联样式：
```tsx
<div style={{ height: 1, background: 'rgb(255 255 255 / 0.07)', flexShrink: 0 }} />
```

### 4.4 圆角规范

| 元素 | 圆角 |
|------|------|
| Tab pill | 6px |
| TopStrip 按钮 | 5px |
| 状态栏 pill | 4px |
| 输入框 | 6px |
| 弹出面板 (Palette / Inbox) | 10px |
| 工具栏图标按钮 | 8px |

---

## 五、文件改动速查表

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `KOOKY_REFERENCE.md` | **新增** | 本文档 |
| `src/components/Terminal/PaneStatusBar.tsx` | **新增** | 底部状态栏 (GitBranch / GitDiff / ComposerToggle) |
| `src/components/Terminal/PaneComposerBar.tsx` | **新增** | 内嵌 Prompt 输入框 (⌘L) |
| `src/components/Terminal/ShellTerminalPanel.tsx` | **修改** | 挂载 PaneStatusBar + PaneComposerBar；⌘L 快捷键；Tab 高度 32px |
| `src/pages/TerminalPage/index.tsx` | **修改** | WorkspaceSidebar 三态；TopStrip 重构；CommandPalette；InboxBell+InboxPanel |
| `src/components/Terminal/index.ts` | **修改** | 导出 PaneStatusBar 和 PaneComposerBar |
