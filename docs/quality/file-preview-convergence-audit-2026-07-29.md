# 文件预览收敛审计

日期：2026-07-29

范围：工作台、智能体工作区、文件管理器、聊天文件结果、终端文件树及记忆详情。

## 结论

工作台、智能体工作区和文件管理器目录模式已经共用 `FileViewer`。仍然各自为阵的是托管输出/上传文件与聊天文件结果：两者读取相同的本地文件，却分别维护格式集合、加载状态和 Markdown/媒体/HTML 渲染。终端文件树则绕过应用内预览，直接交给系统默认应用。

记忆详情、聊天正文和生成式 artifact 是领域内容，不是可定位、可保存的工作区文件。它们不能伪装成 `FileViewer` 文档；其中 Markdown 可以复用安全渲染器，HTML artifact 必须继续使用无脚本 sandbox。

## 已确认问题

### BUG-PREVIEW-01：聊天文件结果维护独立 Markdown 渲染器

等级：B

`ResultMarkdownPreview` 直接使用 `ReactMarkdown`，没有复用工作台的 `MarkdownPreview`。标题锚点、HTML 跳过策略、链接处理和样式因此与工作台不一致。

目标：删除独立渲染器，真实 Markdown 文件统一进入共享 `MarkdownPreview`。

### BUG-PREVIEW-02：托管文件和聊天文件结果重复实现格式预览

等级：A

文件管理器分别维护 binary、HTML 和 text 三组状态与 effect；聊天文件结果维护另一套 HTML、image、Markdown 和 text 分支。PDF、音频和视频只在文件管理器可预览，聊天结果对同一文件报告不支持。

目标：服务层只保留一个文件预览联合类型和一个加载入口；只读 UI 只保留一个共享渲染组件。HTML 的交互/静态降级、截断提示、媒体和 Markdown 都从该组件呈现。

### BUG-PREVIEW-03：终端文件树没有接入应用内文件预览

等级：A

`TerminalWorkspaceFiles` 已提供 `onFileOpen`，但终端页面没有传入。双击和右键“打开”最终调用系统默认应用，无法获得工作台的 Markdown、源码、PDF、页签和磁盘同步能力。

目标：终端打开文件时导航到文件管理器目录模式，并携带受项目根目录约束的文件路径；文件管理器通过共享 `FileViewer` 打开文件。

### BUG-PREVIEW-04：文件管理器的预览路由参数没有形成行为契约

等级：A

文件管理器读取 `?path=` 作为根目录，但初始视图仍固定为 outputs，也不支持指定要打开的文件。注释声明的 Browse 行为与实际行为不一致。

目标：集中解析和生成文件预览路由；`view=tree`、`path` 和 `file` 同步决定目录模式、根目录和活动页签，拒绝根目录外的文件参数。

### BUG-PREVIEW-05：打包 WebView 中源码编辑器 gutter 与正文纵向堆叠

2026-07-29 的 macOS 本地包截图显示 Markdown 源码模式先绘制整列 `1..12`，随后才显示正文。
直接读取截图中的 `IDENTITY.md` 证明磁盘文件没有这些数字；它们来自 CodeMirror gutter。
CodeMirror 上游要求 `.cm-scroller` 横向 flex、gutter 不收缩，但应用此前只依赖运行时注入的基础样式，
应用静态 CSS 没有维护这一结构不变量。当前证据能确认打包窗口中的布局结果，尚未确认运行时样式缺失的具体 WebView 时序原因。

目标：所有共享 `FileViewer` 源码编辑器使用稳定 class，并在应用静态 CSS 中保留 CodeMirror 的最小结构契约；
即使运行时主题尚未生效，行号、折叠栏和正文也必须处于同一横向滚动容器。

## 统一边界

- 可编辑工作区文件：继续使用 `FileViewer`、typed Tauri IPC 和保存冲突保护。
- 只读托管文件：复用统一加载联合类型和 `ManagedFilePreview`，不赋予编辑/保存语义。
- HTML 文件：只允许短期 scoped URL 的 `allow-scripts`，静态 fallback 保持空 sandbox。
- 生成式 HTML/SVG artifact：不是本地文件，继续使用空 sandbox。
- 记忆详情和聊天正文：不是文件预览，不增加文件工具栏或保存状态。

## 验证要求

1. 行为测试覆盖统一格式分类、托管预览分支和 Markdown 安全渲染。
2. 路由测试覆盖 tree 根目录、目标文件、根目录外拒绝和 URL 编码。
3. 源码回归确认独立 Markdown 组件和文件管理器并行预览状态已删除。
4. 执行定向测试、`pnpm lint`、`pnpm test`、`pnpm build` 和 `git diff --check`。
5. 真机检查终端打开 Markdown/PDF、聊天文件结果和文件管理器托管文件；未执行时必须明确标记。

## 实施结果

- 新增 `ManagedFilePreview`，托管输出、上传文件和聊天文件结果共用 HTML、Markdown、text、image、audio、video 与 PDF 渲染分支。
- `loadLocalFilePreview` 成为托管文件唯一加载入口；格式集合、scoped URL 和文本 fallback 不再由页面重复维护。
- 删除 `ResultMarkdownPreview` 与 `FileMarkdownPreview`；Markdown 统一复用 `MarkdownPreview`，并支持根目录约束下的相对图片和本地链接。
- 文件管理器把三组 effect 收敛为路径绑定的 `loading/ready/failed` 状态，快速切换文件不会闪现上一文件内容。
- HTML 交互预览继续使用短期 scoped URL 与 `allow-scripts`；静态 fallback 和生成式 artifact 保持空 sandbox。
- 聊天文件结果补齐 PDF、音频和视频，与文件管理器使用相同的可预览判断。
- 终端文件树通过 `view=tree&path=...&file=...` 进入文件管理器，共享 `FileViewer`；路由拒绝根目录之外的目标文件。
- 清理文件管理器重复加载 effect、过期 Electron IPC 文案和两个废弃预览组件。
- `FileViewer` 从 1265 行的混合实现拆为编排器、文档生命周期 Hook、预览面板、状态栏、标签栏、能力解析和公共类型；核心文件均不超过 226 行。
- 工作区格式解析只依赖 `workspace-files/domain/fileKinds.ts` 与 `previewResolver.ts`；本地 Adapter 统一通过 typed `read_file_preview` IPC，不再调用已注销的 `read_file_content`/`read_image_preview`。
- 文件管理器和工作台都向共享预览器提供缺失文件关闭回调；磁盘暂时不可读时保留草稿、暂停全部保存入口并允许重试。
- 共享源码编辑器新增静态结构样式兜底；删除基础主题中无效的嵌套 `.cm-editor` 选择器。

## 验证结果

- 定向回归通过，覆盖格式分类、安全 Markdown、HTML sandbox、媒体渲染、缺失文件、磁盘异常、保存竞态与终端预览路由。
- `pnpm lint`：通过，模块边界检查覆盖 614 个文件。
- `pnpm test`：通过，前端 1829 项、脚本 223 项，零失败。
- `pnpm build`：通过；最大 JavaScript chunk 为 513.31 kB，低于 550 kB 门禁，没有循环 chunk 或超限警告。
- `cargo fmt -- --check`、`cargo check --lib`、`cargo test --lib`：通过；Rust 648 项通过、3 项明确忽略。
- `git diff --check`：通过。
- macOS ARM64 本地 DMG 已重建并只读挂载核验；镜像内应用版本为 `1.4.17`，Mach-O 为 `arm64`，应用与 DMG 的 ad-hoc 签名及镜像校验均通过。最终 SHA-256 为 `2e70709380da7dd9fc7e0777b430b2af35b69d22a8a6f52abff9b86cee0563d7`。
- 未启动 Tauri 真机窗口；终端跳转、scoped PDF WebView、音视频播放及托管 Markdown 本地资源仍需桌面走查。
- BUG-PREVIEW-05 的源码结构回归、TypeScript 检查与修复后打包均通过；当前自动化浏览器环境没有可用窗口，gutter 与正文的实际并排效果仍需在 Tauri 窗口确认。
