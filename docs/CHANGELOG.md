# JunQi Desktop — 最近修改汇总

## 0. Nezha 拆零件移植（2026-06-22）

详见 `docs/NEZHA-PORT-PLAN.md`。本轮主要改动：

**前端**

- **StatusIcon 统一**：`src/components/shared/StatusIcon.tsx`（新建, 130 行）。统一 nezha 风格的 lucide 图标集合，支持 nezha TaskStatus + junqi 现有 bootSequenceStore / chatStore / workshopStore 全部 status 词汇。接入到 `Workshop` 列头与卡片（`src/pages/Workshop.tsx`）。

- **Make Target 一键运行**：FileViewer 检测 Makefile / `*.mk` / `*.make`，正则解析 top-level target，最多 32 个，悬浮高亮 Run 按钮。点击通过 `window.dispatchEvent('junqi:run-terminal-command')` 跨页面发送到 TerminalPage，由 TerminalPage 的 `useEffect` 监听并 `panelRef.sendCommand('make <target>\n')`。
  - 改动文件：`src/components/FileExplorer/FileViewer.tsx`（+85 行：`isMakefile` / `parseMakeTargets` / Run 按钮 UI + `onRunMakeTarget` prop）、`src/pages/FileManager.tsx`（+13 行：派发 CustomEvent）、`src/pages/TerminalPage/index.tsx`（+18 行：监听 CustomEvent + 转发到 panelRef）。

**后端**

- **session/analytics 命令移植**（PR-0.5）：新建 `src-tauri/src/commands/session_analytics.rs`（~390 行）。包含 `read_session_metrics`（Claude/Codex JSONL token / tool_calls / duration / 文件大小 / 上下文占用，带 mtime 缓存）和 `read_session_messages`（解析 JSONL 输出结构化 SessionMessage[]）。改 nezha 的 `parking_lot::Mutex` / `once_cell::sync::Lazy` → 标准库 `std::sync::Mutex` + `std::sync::OnceLock`。`Cargo.toml` 加 `chrono = "0.4"`。

- **worktree 命令移植**（PR-0.4）：在 `src-tauri/src/commands/git_neu.rs` 追加 ~315 行。包含 `create_task_worktree` / `merge_task_worktree` / `remove_task_worktree` / `worktree_diff_stats` + 路径安全校验 `ensure_path_under_worktrees_root`（canonicalize 防目录遍历）+ 分支名 sanitize `task_worktree_branch_name` + numstat 解析 `accumulate_numstat`。已注册到 `lib.rs::invoke_handler!`。

**Cargo check 结果**

```
Finished `dev` profile [unoptimized + debuginfo] target(s) in 10.88s
```

19 warnings（5 pre-existing pty_neu.rs + 14 unused-public-API from new modules，frontend 后续接入会自动消除）。

**后续补充改动（2026-06-22 当日内多次循环继续推进）**

- **PR-0.7a nezha config.rs 移植**：新建 `src-tauri/src/commands/project_config.rs`（~190 行）。6 个命令：`init_project_config` / `read_project_config` / `write_project_config` / `get_agent_config_file_path` / `read_agent_config_file` / `write_agent_config_file`。`Cargo.toml` 加 `toml = "0.8"`。

- **PR-0.7b nezha app_settings.rs 简化移植**：新建 `src-tauri/src/commands/app_settings.rs`（~270 行）。3 个 tauri 命令：`load_app_settings` / `save_app_settings` / `detect_agent_paths`。内联 `atomic_write` + `detect_path` + `login_shell_path`（junqi 无对应 platform 模块）。跳过 nezha 的 Windows-specific codex vendor 解析。

- **PR-0.7c nezha hooks.rs 最小子集**：新建 `src-tauri/src/commands/hooks.rs`（~200 行）。仅暴露 frontend 调用的 `get_hook_readiness` Tauri 命令（返回 `[HookAgentReadiness; 2]`）。跳过 nezha 的 hook 脚本注入 + settings.json 标记 mutation + config.toml 区域包裹。stub 接口保留 API surface。

- **PR-0.7d nezha skills.rs 简化移植**：新建 `src-tauri/src/commands/skills.rs`（~410 行）。7 个 tauri 命令：`get_skill_hub_config` / `set_skill_hub_path` / `clear_skill_hub` / `list_skills` / `list_skill_installations` / `install_skill` / `delete_skill`。手写 frontmatter 解析（literal/folded block scalar 支持）。`Cargo.toml` 加 `serde_yaml = "0.9"`。

**总累计改动（2026-06-22 全天）**：10 个新/改文件，+2065 行 Rust + +261 行 TSX + 3 个 Cargo 依赖。`npx tsc --noEmit` 和 `cargo check` 均通过。

---

## 1. 文件去重修复

**问题**: AI 回复中的文件显示两次 — 一次是 MessageBubble 从 `📎 file:` 文本解析的 FileCard,一次是 ChatView render block 的 FileResultCard。

**修复**: MessageBubble.tsx — 助理消息的 `📎 file:` 文本行不再渲染 inline FileCard,保留 ChatView 的 FileResultCard(含 Open/Reveal/Copy 按钮)。

**文件**: `src/components/Chat/MessageBubble.tsx` (L483)

---

## 2. 历史加载 limit 提升

**问题**: 会话历史只加载最近 200 条,长会话被截断,显示无效 banner。

**修复**: `HISTORY_LIMIT: 200 → 1000`,一次加载 5 倍历史。

**文件**: `src/components/Chat/ChatView.tsx` (L24)

---

## 3. 切会话自动滚到底

**问题**: 切 tab 后新会话停在顶部,不会自动滚到底(因为 scrollLockedRef 跨 session 残留)。

**修复**: 当 `activeSessionKey` 变化时重置 `scrollLockedRef.current = false`。

**文件**: `src/components/Chat/ChatView.tsx` (L131)

---

## 4. 排队消息系统

### chatStore

- `messageQueue: Record<string, Array<{id, text, timestamp}>>` — 每个 session 独立队列
- `drainQueue(key)` — AI 回复完成后自动取队首发下一条
- `clearQueue(key)` — 清空队列,标记消息 status='cancelled'
- `queueSize(key)` — 返回队列长度

**文件**: `src/stores/chatStore.ts`

### MessageInput

- 排队拦截: typingBySession 为 true 时新消息入队而非发送
- QueueStrip 组件: 3 行叠加排队条,含编辑/删除确认/清空确认
- Stop 按钮: abort 当前 + 清空队列
- Drain effect: 监听 typingBySession→false 自动排下一条

**文件**: `src/components/Chat/MessageInput.tsx`

### MessageBubble

- 排队消息 indicator: ⏳ 图标 + "排队中" 文案

**文件**: `src/components/Chat/MessageBubble.tsx`

---

## 5. 文件管理(Tauri IPC)

新增 `managed_files.rs` Tauri 命令:

- `managed_file_open(path)` — 默认 app 打开文件
- `managed_file_reveal(path)` — Finder 显示
- `managed_file_exists(path)` — 检查文件存在

**文件**: `src-tauri/src/commands/managed_files.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, `src/api/tauri-adapter.ts`

---

## 6. 滚动锁定

**问题**: 翻看历史消息时新消息一直抢滚到底。

**修复**: scrollLockedRef + atBottomStateChange + followOutput 条件化 + CSS scroll-behavior:smooth。

**文件**: `src/components/Chat/ChatView.tsx`

---

## 7. 语音录制优化

- Canvas RMS 包络波形(180 buffer)
- 静音检测(平线)
- Pause/Resume + 计时器冻结
- 自适应噪点门限

**文件**: `src/components/Chat/VoiceRecorder.tsx`

---

## 8. Session Context Bar 重设计

- agent 名称(从 agents 列表查)
- token % + 消息数 + 会话开始~最后活跃时间(右侧)

**文件**: `src/components/Chat/SessionContextBar.tsx`

---

## 9. 其它

- TopBar: 多个 agent 同时工作时显示全部 agent 名称
- Settings: OpenClaw 版本检查 + 更新 badge
- 编辑/重新发送: handleResend 带 prevId 替换原消息(不再出两条)
- 编辑框: min-h 60→100px
- i18n: 三语(queue/refresh history 等 key)

---

## 10. 应用图标规格(dock 图标核对结论)

**问题**: `tauri dev` 调试构建在 macOS dock 里图标显得偏大/异常,疑为图标被改。

**核对结论**: 图标文件**未被改动**(git 无记录,mtime 停在 6/11,早于本次开发),构图符合规范,无需调整。

**图标规格**(`src-tauri/icons/`):

- 源图 `icon.png`: 256×256
- `icon.icns`: 含 1024×1024 表示
- PNG 集: `32x32.png` (32)、`128x128.png` (128)、`128x128@2x.png` (256)
- 构图: 主体(黑色 "JQ" 方块)占画布中心 **~80%**,四周 **~10%** 边距;背景为撑满画布的圆角渐变矩形(橙→蓝→紫)——符合 macOS 应用图标规范
- `tauri.conf.json` `bundle.icon`: `["icons/32x32.png","icons/128x128.png","icons/128x128@2x.png","icons/icon.icns","icons/icon.ico"]`

**关键事实**:

- macOS dock 每个 app 图标格子大小一致,由系统「dock 大小」滑块控制,**app 无法让自己的 dock 图标比别的 app 大**。
- dock 图标显示异常仅出现在 `tauri dev` 调试构建;release `.app`(`/Applications/JunQi Desktop.app`)图标正常。
- 想要打磨过的 dock 图标,需 `npm run tauri build` 出 release 包。


