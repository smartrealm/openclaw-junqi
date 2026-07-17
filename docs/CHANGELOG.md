# JunQi Desktop — 最近修改汇总

## 未发布（2026-07-17）

**会话生命周期闭环**

- 删除会话时统一清理消息、草稿、附件、发送队列、模型与主题偏好，并用删除墓碑阻止迟到的历史记录、流式事件和旧列表响应把会话恢复出来。
- 对应用内删除、OpenClaw 外部删除和会话列表刷新采用同一状态收敛流程；删除当前会话后自动切换到可用标签页，主会话始终禁止删除。
- 会话重命名按会话串行执行，严格识别网关的失败响应，并保证连续重命名以最后一次用户意图为准。
- 会话重置改为远端成功后再清理本地状态；确认弹窗支持异步等待、重复操作去重和执行中禁用，避免双击导致并发请求。
- 统一会话键生成与主会话识别逻辑，增强同毫秒创建唯一性，并修复同一路由重复新建会话失效的问题。
- 固定状态持久化到本地偏好，明确记录固定和取消固定，重启后保持一致。
- 删除或重置后的上传、输出和语音制品采用有界清理，单项失败只记录日志，不会反向破坏已成功的网关操作。

**质量检查**

- 前端应用测试 844 项、发布脚本测试 27 项全部通过。
- Rust 361 项通过、2 项忽略；Clippy、Rust 格式、模块边界、类型检查、差异检查和生产构建全部通过。

## 1.2.10（2026-07-17）

本次版本补齐 Windows/macOS 安装引导的国内网络闭环，并保留大夏发行分支独有的萌宠可读性优化。

**安装引导与运行时自修复**

- Node.js 校验不再请求 `nodejs.org`，改为并行读取多个国内镜像，并要求至少两个独立来源返回相同 SHA256 后才允许安装。
- Node.js 可用但 npm 缺失或损坏时执行强制修复，避免重复检测却不实际恢复 npm 的死循环。
- 已安装 OpenClaw 的包元数据或 Gateway 命令损坏时，改用目标版本契约继续修复并自动执行事务重装。
- macOS 从国内镜像下载官方 Node.js `.pkg`，在应用内显示真实下载进度，并调用系统安装器完成标准位置安装；缺少 Git 时直接打开 Apple 命令行工具安装器。
- macOS/Unix 的 OpenClaw 安装改为独立目录暂存、完整性验证、原子替换；激活失败或进程中断时恢复原版本。
- Windows Node.js/Git 系统安装器通过原生 UAC 请求管理员权限，等待真实退出码并区分取消、超时和安装失败。
- Node.js/Git 下载改为流式写盘，日志和 UI 显示下载源、已下载大小、总大小及真实百分比。
- 安装进度事件增加结构化翻译参数，避免后端提示语调整后界面退回英文；可选步骤跳过后按“已处理”计入完成状态。

**萌宠**

- 同步复杂桌面背景采样与文字反差策略，按背景亮度选择前景色、描边、阴影和半透明底色。
- 在高纹理背景上提高气泡底色强度，提升 Windows/macOS 透明萌宠窗口中的状态文字可读性。
- 保留萌宠窗口、拖放反馈、番茄钟、皮肤切换、自定义萌宠包与内置 `hatch-pet` 技能的完整入口。

**质量检查**

- 前端应用测试 830 项、发布脚本测试 27 项全部通过。
- Rust 361 项通过，2 项环境依赖测试忽略；Clippy、格式、模块边界、类型检查和生产构建通过。

## 1.2.2（2026-07-16）

本次版本面向国内网络环境，统一 Windows/macOS 的 OpenClaw 运行时来源、安装策略和状态语义，并缩减线上安装包体积。

**运行时安装与迁移**

- 将 Node.js、Git 的下载地址和平台制品信息聚合到统一配置，版本不再散落写死在平台安装逻辑中。
- Windows 使用应用托管的 Node.js/Git，可从已核验的国内源下载和更新；迁移时重新绑定应用管理路径，避免误用旧系统路径。
- macOS 按 Intel/Apple Silicon 下载应用托管的 Node.js；Git 保持使用系统工具，界面不会提供无效的自定义 Git 操作。
- 运行时来源统一为 `system`、`managed`、`custom`，平台能力由集中策略模型输出；后端拒绝更新可用的系统工具，前端同步隐藏无效按钮。
- 国内源不可用时返回明确错误与下载日志，不再默认请求 GitHub、nodejs.org 或 winget。

**安装包与发布**

- Windows WebView2 改为安装时下载微软引导程序，由引导程序按系统架构安装运行时；安装包不再内置引导程序或完整离线运行时。
- macOS 改为 ARM64、x64 分架构打包，Windows 保持 x64、ARM64 独立制品，减少用户单次下载体积。
- Rust 发布配置启用 LTO、符号裁剪和极致体积优化，ZIP 解压仅编译 Node.js/MinGit 制品实际使用的 Deflate 支持。
- Windows 的 NSIS/中英文 MSI、macOS 的 DMG/updater 分开上传，用户无需下载同架构的全部格式。
- 更新清单生成器支持分架构 macOS 制品，避免不同架构互相覆盖。

**质量检查**

- Rust：335 项通过，2 项忽略。
- 前端与脚本：817 项通过；TypeScript、Rust 格式、生产构建及差异检查通过。

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
