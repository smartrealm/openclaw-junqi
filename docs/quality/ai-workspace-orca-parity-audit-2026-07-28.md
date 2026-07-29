# AI 工作台 Orca 对照审计

日期：2026-07-28

范围：`src/pages/AgentWorkspace`、`src/components/Git` 及 Orca 本地源码中的工作区右侧栏和 Source Control

## 结论

JunQi 已经具备 Orca 工作区的核心布局：项目/任务导航、中间任务或编辑视图、右侧文件/Git/能力活动栏和底部终端。继续复制 Orca 的 Electron runtime、Monaco 编辑器、插件面板、PR Checks 或远程主机模型会破坏 JunQi 当前 Tauri/OpenClaw 边界，不适合直接迁移。

适合迁移的是 Orca Source Control 的状态原则：只展示有真实依据的数据；筛选控件必须可操作；窗口不可见时停止轮询；可见时自动恢复；跨 IPC 的刷新不得无限并发。

## 当前问题

### BUG-AW-ORCA-01：伪“当前任务”变更范围

`GitChanges` 接收 `currentTaskCreatedAt`，界面声称可以查看“当前任务”，实际实现却只是 `changes.filter(change => change.staged)`。Git status 没有文件修改时间，也没有任务归属字段，因此该页签把“已暂存”错误描述成“当前任务”。

目标：删除 `currentTaskCreatedAt`、任务页签及相关状态。工作树任务已经通过 `currentGitPath` 指向独立 worktree；本地任务只能诚实显示整个项目工作区的变更。

### BUG-AW-ORCA-02：筛选按钮没有行为

变更面板工具栏渲染 Filter 图标，但没有 `onClick`、输入框或筛选状态。这是不可操作控件。

目标：提供按仓库相对路径进行的不区分大小写筛选；筛选启用时保持明确选中态、可清空，并区分“工作区无变更”和“没有匹配项”。

### BUG-AW-ORCA-03：智能体写文件后变更面板保持陈旧

面板仅在挂载和用户执行 stage/discard/commit 后刷新。智能体或外部工具继续修改文件时，已打开的变更面板不会更新。

目标：采用 Orca 的 visible-window interval 语义。面板可见时立即刷新并定时检查，窗口隐藏时停止，重新可见时立即恢复。刷新使用单航班队列，慢 IPC 期间的新刷新请求只合并为一次后续刷新。

### BUG-AW-ORCA-04：Git 面板持有独立英文词典

`GitChanges` 和 `GitFileBrowser` 绕过应用 i18n，英文 fallback 与硬编码 tooltip 分散在组件内部，中文界面会混入英文。

目标：文案进入三套当前启用的应用 locale；组件只使用 `useTranslation`，删除私有词典和无用移植注释。

### BUG-AW-ORCA-05：命令面板渲染 Lucide 图标时崩溃

桌面走查使用 `Cmd+K` 打开命令面板时，React 抛出 `throwOnInvalidObjectType`。`PaletteCommand.icon` 同时允许 React 节点和组件，渲染时又用 `typeof icon === 'function'` 区分；Lucide 的 `forwardRef` 图标在运行时是对象，因此被错误地作为普通 React 子节点渲染。

目标：命令图标只接受 `LucideIcon`，统一通过组件语义渲染；删除快速 Agent 配置中从未使用的 Phosphor 图标节点，并增加能在旧实现上触发同类异常的渲染回归测试。

### BUG-AW-ORCA-06：智能体展开工作区绕过共享文件预览器

`WorkspacePanel` 独立维护单文件读取、CodeMirror、保存和只读预览。该分支没有 Markdown 默认预览、Source/Preview 切换、目录、操作菜单、文件页签和共享磁盘同步，因此 `.md` 会直接显示为只有行号的空白源码视图，其他文件格式也与文件管理页行为不一致。

目标：删除智能体工作区的重复文件管线，统一复用 `FileViewer`；工作区只负责目录树、根目录生命周期和页签状态。重命名、删除、切换根目录和关闭工作区前必须通过共享预览器刷新待保存内容。

## Orca 依据

- `src/renderer/src/components/right-sidebar/index.tsx`：右侧活动栏按工作区能力展示 Explorer、Source Control 等稳定工具，而不是把它们混进任务正文。
- `src/renderer/src/components/right-sidebar/SourceControl.tsx`：Source Control 对 Git 状态使用显式刷新流程，路径筛选是实际交互。
- `src/renderer/src/lib/window-visibility-interval.ts`：窗口可见时启动刷新，隐藏时停止，重新可见时立即执行一次。

这些是行为参考，不是代码复制目标。JunQi 继续使用现有 Tauri commands、CodeMirror、Zustand 和 Aegis 主题。

## 非目标

- 不引入 Electron IPC、Orca runtime RPC、Monaco 或插件系统。
- 不声称能够把本地模式下的文件变更归属到某个任务。
- 不在本轮增加 commit/push/PR 的新后端协议。
- 不重写已经可用的任务运行、文件预览、Git diff 和终端。

## 验证要求

1. 纯函数回归覆盖路径筛选、大小写、空查询和 staged/unstaged 双记录。
2. 可见窗口刷新工具回归覆盖启动、隐藏、恢复和卸载清理。
3. 源码回归证明 `currentTaskCreatedAt` 和私有英文词典已删除。
4. 执行定向测试、全量测试、lint、生产构建和 `git diff --check`。
5. 实际 Tauri 窗口检查智能体修改文件后的自动刷新、筛选和 stage/discard 后状态。

## 实施结果

- 删除伪“当前任务”页签及 `currentTaskCreatedAt`，变更面板明确表示当前项目或 worktree 的完整工作区状态。
- Filter 控件已接入完整相对路径筛选、清空、Escape 关闭及独立空状态。
- `git_status` 采用可见窗口 3 秒刷新和合并式串行执行；项目切换时丢弃旧路径结果，状态查询错误与用户操作错误分别管理。
- stage、unstage、discard、commit 和提交信息生成均绑定发起时的项目路径；项目切换会重置操作态，旧操作结果和错误不会污染新面板。
- 树形/列表模式的 Hook 顺序保持稳定；目录级 stage/unstage/discard 使用已有批量 command，原先未消费的滚动上下文、自动折叠参数和树节点字段已删除。
- `GitChanges`、`GitFileBrowser`、`GitHistory`、`GitDiffViewer` 和 `DiffFileBlock` 已移除私有英文词典与硬编码提示，统一使用三套当前启用的应用 locale。
- Git diff 请求在文件或提交快速切换后忽略失效结果，旧 IPC 不再覆盖当前选择。
- Git 历史、分支和提交详情使用独立请求序号，项目、分支、搜索或提交快速切换后不接受旧结果；pull/push 会等待刷新收敛后再结束忙碌态。
- `GitChanges` 与 `GitHistory` 共用一个卸载安全的 Tauri invoke hook。
- 命令面板图标契约收紧为 `LucideIcon` 并统一组件化渲染，删除未消费的快速 Agent 图标字段和 Phosphor imports。
- 智能体展开工作区删除了独立 CodeMirror、文件读取、保存和只读预览分支，所有格式统一进入共享 `FileViewer`；Markdown 默认预览、Source/Preview、目录、操作菜单、页签和磁盘变更处理与文件管理页一致。
- 页签开关、左右/其他页签关闭、目录重命名和删除路径迁移集中到纯 reducer，工作区不再复制路径状态算法。

## 验证结果

- 2026-07-28 文件预览收敛补充验证：定向 TypeScript 与 23 条文件/Gateway 回归通过；`pnpm lint`、`pnpm test`、`pnpm build` 和 `git diff --check` 通过。
- 新的 macOS ARM64 本地包完成 DMG 挂载、版本、Mach-O 架构和 ad-hoc 签名完整性检查；没有替换或中断用户当前运行中的正式应用，因此智能体工作区真实 Markdown 点击仍标记为待手工验收。
- `pnpm lint`：通过，模块边界检查覆盖 570 个文件，TypeScript 无错误。
- 定向回归：10 条通过，覆盖筛选、可见窗口 interval、刷新合并、Git 三个视图的三语言键集合及命令面板 `forwardRef` 图标渲染。
- `pnpm test`：通过，前端测试 1672 条、脚本测试 217 条，零失败。
- `pnpm build`：通过，collaboration bundle 合约验证、TypeScript 和 Vite 生产构建均成功。
- `cargo fmt -- --check`、`cargo check --lib`、`cargo test --lib`：通过；Rust library 626 条通过、3 条环境依赖测试按预期忽略。
- `git diff --check`：通过；遗留接口与私有 Git 英文词典扫描为空。
- 桌面走查复现了命令面板崩溃，修复后的同一窗口截图确认命令面板及 Lucide 图标可正常渲染。之后因调试实例复用同名应用窗口状态可能干扰现有会话，已按用户要求停止，临时 WebKit `LocalStorage` 已恢复原备份。因此 AI 工作台的真实 Git 自动刷新、筛选和操作仍标记为未验证。
- 构建仍输出仓库既有的循环 chunk、超大 chunk、Radix SSR 和 Node loader 弃用警告，本轮未把这些警告误报为已解决。
