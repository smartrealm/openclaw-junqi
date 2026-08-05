# Orca 文件工作区体验规格

## 依据

- JunQi 现有 `search_project_files` Tauri command 已注册，并由本地工作区文件适配器调用。
- 该 command 在已验证的 Rust 实现中使用 Git 已跟踪文件列表，返回文件路径、文件名、所在目录与扩展名；结果上限为 200。
- Orca 的文件工作区提供快速打开、紧凑结果层级和多种编辑器视图。JunQi 不引入其 Electron、SSH、浏览器或编辑器运行时。
- Tauri command 仍保持既有注册和参数契约；本次不新增 Rust command，也不扩展 OpenClaw Gateway 协议。

## 当前行为

- 本地文件管理器与 Agent Workspace 文件面板共享 `FileExplorer`，但没有统一的快速打开入口。
- Agent Workspace 右侧搜索面板可调用本地适配器搜索，却仅保留路径字符串，不能忠实呈现原生命令返回的文件名和目录。
- 文件预览与编辑已由统一文件预览表面和本地文件查看器负责；它们不应被远程、浏览器或模拟数据替换。

## 目标行为

1. 仅在具有本机 Worktree 的 `FileExplorer` 中提供快速打开入口，工具栏和 Ctrl/Cmd+P 均可打开。
2. 查询为空时不发起扫描；输入后延迟查询，过期请求的结果不得覆盖当前查询。
3. 结果使用原生返回的文件名与目录，选择后沿用已有文件打开回调。
4. `terminal-strict`、OpenClaw Gateway 工作区、会话附件、工件与引导文件不获得本地快速搜索能力。
5. 文件标签和快速打开层使用现有 Aegis 色彩令牌，保持桌面工作台的紧凑布局、键盘交互和可访问标签。

## 验收条件

- `WorkspaceFileSearchResult` 明确包含原生返回的条目字段，调用方不再依赖丢失元数据的路径数组或推测性截断状态。
- 快速打开只通过 `localWorkspaceFiles.search` 调用既有 `search_project_files` 契约。
- Ctrl/Cmd+P 不在输入框、文本域或可编辑元素中劫持输入。
- Escape 关闭快速打开；上下方向键移动选择；Enter 打开当前结果。
- 本次相关单元测试、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs` 和 `git diff --check` 通过。

## 未验证边界

- 当前本地应用浏览器连接不可用，无法获取运行中桌面界面截图；视觉代码将通过静态构建和自动化验证，真机视觉验收待可用桌面运行时补充。
- Windows、CentOS、Ubuntu 的真机窗口、输入法和系统快捷键行为未在本次 macOS 开发环境实测。实现不依赖平台路径分隔符或平台专属 API。
