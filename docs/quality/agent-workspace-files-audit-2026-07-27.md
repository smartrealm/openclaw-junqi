# 智能体工作区文件预览、编辑与目录菜单审计

日期：2026-07-27

范围：`src/pages/AgentWorkspace`、`src/components/FileExplorer`、`src-tauri/src/commands/fs_neu.rs`

## 结论

当前代码并非完全没有文件预览、编辑或右键菜单，而是存在接入和可发现性断点：文件树菜单仍在可裁剪的组件层级内渲染；菜单缺少重命名；目录变更后已打开标签不会同步；普通文本的编辑与延时自动保存没有明确模式和立即保存入口。用户看到的结果等同于能力缺失或不可依赖。

整体等级：A。问题跨越 React 工作区状态、共享文件组件与 Tauri 文件命令，需要一起修复并做路径边界回归。

## 证据链

### BUG-AW-FILE-01：浮层仍受工作区 DOM 层级影响

等级：A

- `FileExplorerContextMenu` 与 `FileViewer` 标签菜单在调用组件内部使用 `position: fixed`。
- 智能体工作区内容由 Framer Motion scene 包裹，scene 会建立 transform containing block；相关父组件还使用 `overflow: hidden`。
- 菜单没有挂载到 `document.body`，因此其 fixed 定位和可见区域仍可能被祖先 containing block、overflow 与 stacking context 影响。
- 文件树菜单也与窄右侧栏的生命周期耦合，切换面板时会直接卸载。

目标：所有文件树和标签右键菜单通过 React Portal 挂载到 `document.body`，按实际菜单尺寸限制到 viewport，并在 Escape、窗口 resize/blur、外部 pointerdown 时关闭。

### BUG-AW-FILE-02：目录右键操作不完整

等级：A

- 当前菜单只有新建文件、新建目录、复制路径、系统中显示和删除。
- 缺少标准文件管理操作“重命名”。Rust `fs_neu` 也没有对应 command。
- 新建和删除失败仅写调试日志，没有用户可见反馈。
- 删除已打开文件或目录后，中心编辑标签仍保留失效路径。

目标：新增受项目根目录约束的 `rename_path` command；禁止重命名项目根、`.git`、`.junqi`，禁止路径分隔符、保留名称与目标覆盖。文件树显示操作错误，并把重命名/删除结果通知智能体工作区和文件管理页同步打开标签。

### BUG-AW-FILE-03：预览与编辑状态不可发现，保存存在时间窗口

等级：A

- Markdown 默认进入 CodeMirror，只有右上角一段纯文本按钮能切换预览。
- 普通文本没有“编辑中”状态；用户首次输入后只会短暂看到延时保存状态。
- 仅有 1.5 秒延时自动保存，没有立即保存按钮。组件在计时器触发前卸载会清除计时器，最后修改可能丢失。

目标：Markdown 首次打开默认预览，使用带图标的预览/编辑切换；普通文本明确显示编辑状态；提供保存按钮和 `Ctrl/Cmd+S`；卸载含未保存内容的 pane 时提交最后内容。

### BUG-AW-FILE-04：浅色主题下文件正文不可见，Markdown 预览未定义排版

等级：A

- 2026-07-28 桌面候选包截图显示 `DREAMS.md` 只剩行号，正文完全不可见；实际文件包含 1,580 行、102,056 字节内容，读取并未失败。
- 文件管理页调用 `FileViewer` 时没有传入当前主题，因此浅色应用仍选择默认的 `githubDark` CodeMirror 主题。
- 智能体详情里的“打开工作区文件”并不复用 `FileViewer`，而是由 `WorkspacePanel` 维护第二套 CodeMirror。桌面候选包实测 `AGENTS.md` 同样只显示行号；该实现只选择 GitHub 明暗主题，没有应用项目自己的正文、光标和 gutter 基础主题，因此前一处修复无法覆盖用户截图对应的入口。
- `editorBaseTheme` 把 `--aegis-text` 等 RGB 三元组变量直接当作 CSS 颜色使用；`var(--aegis-text)` 展开为 `23 27 36`，不是有效的 `<color>`，无法覆盖深色编辑器的前景色。
- `.md-preview-scroll` 与 `.md-preview` 只有类名，没有任何样式定义；即使默认进入预览，也没有稳定的滚动、正文宽度、标题、代码块、表格或图片规则。

目标：文件管理页显式传递解析后的应用主题；文件管理页与 `WorkspacePanel` 复用同一个 CodeMirror 基础主题；所有 RGB 颜色变量使用 `rgb(var(...))`；为安全渲染后的 Markdown 增加主题无关、可滚动且适配窄视口的正文排版。编辑与预览必须在浅色、护眼、深色和午夜主题下都保持可读。

### BUG-AW-FILE-05：打开文件不会跟随磁盘变更，脏草稿可能覆盖外部写入

等级：A

- `src-tauri/src/commands/fs_watcher.rs` 已提供带引用计数的非递归目录监听，并以 `{ dir }` 负载发送 `fs-changed`；此前只有文件树消费该事件，`FileViewer` 加载内容后不再检查磁盘。
- 智能体或外部编辑器修改已打开文件时，干净标签继续显示旧内容；有本地草稿时，1.5 秒自动保存还可能把新的磁盘内容静默覆盖。
- Orca 的 `ExternalFileChangeBanner` 和 `editor-autosave-controller` 证明其产品语义是：干净缓冲区自动刷新，脏缓冲区保留并暂停自动保存，由用户明确选择磁盘版本或本地版本。JunQi 不复制 Orca 的 store/telemetry/diff 架构，只采用这项冲突语义。

目标：活动文件单独持有父目录 watch；收到事件、窗口重新聚焦或原生 watcher 不可用时重新读取磁盘。最近一次成功写盘的事件回声忽略；干净缓冲区自动重载；脏缓冲区显示可访问的冲突横幅并暂停自动保存和卸载写回，直到用户选择“从磁盘重新加载”或“保留我的修改”。自动保存必须串行，通过 `write_file_content_if_unchanged` 对最近确认的磁盘基线做乐观并发检查，并在写后回读。外部删除或暂时不可读时暂停保存并保留内存草稿。图片预览在磁盘内容变化后自动刷新。

### BUG-AW-FILE-06：不同页面的文件树右键操作发生漂移

等级：A

- `AgentWorkspace` 和 `FileManager` 复用 `FileExplorer`，具备完整的根目录、目录和文件操作矩阵。
- 智能体详情 `WorkspacePanel` 使用独立的 `WorkspaceFileTree`，此前没有右键菜单。
- 终端页 `TerminalWorkspaceFiles` 维护另一套私有菜单，只提供系统打开、显示、复制和插入路径，缺少新建、重命名、`@` 路径和移到废纸篓。
- Orca 的 `FileExplorerRow` 与 `FileExplorerBackgroundMenu` 由统一资源管理器拥有菜单规则，页面专属能力作为附加动作；其 operation owner/generation 设计还表明异步文件操作不能脱离产生该行的工作区上下文。JunQi 当前只有本地工作区，不复制 Orca 的远程 owner 图，但保留 `projectPath` 安全边界和操作期间的路径同步。

目标：所有 JunQi 文件树使用 `contextMenuModel` 定义的同一命令矩阵，并由 `FileExplorerContextMenu` 统一渲染 Portal、viewport 定位、图标、分组和危险态。智能体详情与终端页通过 `useFileExplorerContextActions` 共用新建、重命名、复制、显示和删除语义；终端的“插入路径”仅作为共享菜单的附加动作。智能体详情在重命名或删除打开文件前保存相关脏内容，随后同步预览路径或关闭失效预览。空目录和加载失败区域的空白处右键仍作用于项目根。

### BUG-AW-FILE-07：文件格式分流依赖页面扩展名猜测

等级：A

- `FileViewer` 只把 `png/jpg/jpeg/gif/webp/bmp/svg` 送入图片命令，其余文件全部调用 UTF-8 文本读取；PDF 和未知二进制会直接报解码错误。
- `WorkspacePanel` 又维护一份更宽的图片集合，包含后端不支持的 `ico/avif/tiff`，因此同一文件在不同 JunQi 页面得到不同结果。
- 旧 IPC 分成 `read_file_content` 与 `read_image_preview`，前端必须先猜格式；错误分类的二进制还可能进入可保存编辑器。
- Orca 的本地与 runtime 文件读取先返回 `isBinary/isImage/mimeType`，专用二进制预览范围是 `png/jpg/jpeg/gif/svg/webp/bmp/ico/pdf`；编辑器再把 Markdown、Mermaid、CSV/TSV 和 Notebook 分流到各自视图，其他 UTF-8 文本进入通用代码编辑器，未知二进制只显示不可预览状态。

目标：JunQi 使用一个 `read_file_preview` IPC 返回严格的 `text/image/pdf/binary` 判别联合。所有工作区入口只允许 `text` 进入编辑和保存链路；图片与 PDF 共用只读渲染器；未知二进制显示大小和“使用系统应用打开”，不向前端发送其内容。对齐 Orca 的图片/PDF 范围；Mermaid、CSV/TSV、Notebook 当前稳定按源码文本打开，不虚构已迁移 Orca 的富编辑器。

### BUG-AW-FILE-08：Markdown 预览与编辑器操作栏缺少一致结构

等级：A

- `FileViewer` 此前把 Markdown 渲染、模式按钮和状态操作混在单个大组件中；标签栏右侧只有语义不明确的动作，用户无法稳定区分源码与预览。
- 文件管理页 `FileMarkdownPreview` 另有一套 `react-markdown` 组件映射，表格、代码、链接和 HTML 安全策略与智能体工作区发生漂移。
- 标题没有可复用目录，长文档缺少定位入口；标签右键也只有关闭动作，缺少关闭其他/左右标签、复制相对路径和系统中显示。
- Orca 的 `EditorPanelHeader`、`EditorViewToggle`、`EditorPanelMarkdownActionsMenu`、`MarkdownPreview`、`MarkdownTableOfContentsPanel` 与 `EditorFileTabContextMenu` 提供了可核对的结构：标签栏下方使用稳定操作栏，源码/预览用图标分段控制，Markdown 目录独立成栏，通用动作进入更多菜单，标签菜单承载批量关闭与路径操作。

目标：JunQi 采用上述信息架构并保持自身 Tauri 边界。Markdown 默认预览，使用统一的 GFM React 渲染组件；原始 HTML 不进入 DOM；工作区内图片继续通过 `read_file_preview` 和根目录校验加载。标题生成可链接且处理重复项的稳定锚点，目录只在预览且存在标题时可用。源码模式保留 CodeMirror 行号与折叠栏，预览模式不显示编辑器装饰。标签栏下方增加固定高度操作栏，集中模式切换、目录、长行换行、路径复制和系统中显示；标签右键补齐批量关闭与路径操作。Orca 的 Mermaid、数学公式、搜索、批注和审阅能力不在本次范围。

## 官方文档依据

- React `createPortal`：Portal 可把浮层 DOM 放到组件 DOM 层级之外，同时保留 React context 与事件关系。<https://react.dev/reference/react-dom/createPortal>
- Tauri v2 commands：前端通过 `invoke` 调用已注册 command，默认参数对象使用 camelCase，command 错误通过 rejected Promise 返回。<https://v2.tauri.app/develop/calling-rust/>
- Tauri v2 events：`listen` 异步返回 `UnlistenFn`，SPA 组件卸载时必须释放监听；Rust event payload 通过 `event.payload` 读取。<https://v2.tauri.app/develop/calling-frontend/> <https://v2.tauri.app/reference/javascript/api/namespaceevent/>
- Tauri dialog：删除等破坏性动作继续使用官方 `confirm()` Promise API。<https://v2.tauri.app/plugin/dialog/>
- CodeMirror Styling：编辑器主题通过 `EditorView.theme` 扩展定义，`.cm-content`、`.cm-gutters` 等选择器在编辑器作用域内生效；语法高亮与编辑器 UI 主题分别控制。<https://codemirror.net/examples/styling/>
- React CodeMirror：`theme` 属性接收 CodeMirror theme extension，调用方必须传入与应用当前外观一致的主题。<https://github.com/uiwjs/react-codemirror>

## 非目标

- 不开放项目根目录之外的任意文件访问。
- 不允许通过重命名覆盖已有文件。
- 不把图片等二进制文件变成可编辑文本。
- 不把 Orca 的 Monaco、TipTap、Mermaid、CSV 和 Notebook 富编辑器整套迁入 JunQi。
- 不引入第二套文件树或编辑器。

## 验证要求

1. 前端纯函数测试覆盖文件/目录重命名后的标签路径映射与删除后的标签清理。
2. 源码回归测试覆盖 Portal、重命名菜单、Markdown 默认预览、显式保存和快捷键。
3. Rust 单元测试覆盖成功重命名、冲突、根目录保护、保留目录保护和路径逃逸。
4. 执行 TypeScript lint、前端全量测试、Rust `fs_neu` 测试与生产构建。
5. 源码回归覆盖文件管理页主题传递、两套编辑器复用基础主题、CodeMirror 有效 RGB 颜色和 Markdown 预览布局；桌面包分别检查智能体工作区编辑正文与文件管理页预览正文的可见性。
6. 纯状态回归覆盖加载、编辑、干净重载、脏草稿冲突、成功保存事件回声、磁盘内容已等于草稿、保留本地修改和写入期间继续编辑；Rust 行为回归覆盖 guarded write 成功与基线过期不写入。
7. Markdown 回归覆盖 GFM、原始 HTML 隔离、Unicode/重复标题锚点、代码围栏内标题忽略和本地资源根目录边界；生产构建不得重新出现循环分包或超限 chunk 警告。

## 验证结论

2026-07-27 已完成：`pnpm test`、`pnpm lint`、`pnpm build` 和 `cargo test --lib` 全部通过。Rust 结果为 624 通过、3 个环境依赖测试忽略；新增文件能力定向回归 7 项、重命名安全回归 2 项均通过。当前执行环境没有可用的应用内浏览器实例，因此未伪造截图结论；实际 Tauri 窗口交互仍需在桌面包中做人工走查。

2026-07-28 外部磁盘变更修复：定向状态与文件能力回归 8 项通过；`pnpm test` 共 1,876 项通过；`pnpm lint` 与 562 个模块边界检查通过；Rust `fs_watcher` 引用计数定向测试 1 项通过；`pnpm build` 通过，保留既有循环 chunk 与体积提示。未启动实际 Tauri 桌面窗口，因此干净文件自动刷新、脏草稿冲突横幅和图片热刷新仍需桌面交互走查，不把源码与自动化结果描述为桌面实测。

2026-07-28 健壮性收口：文件同步改为纯状态机与单一文档 hook；自动保存、立即保存和卸载保存统一进入串行队列；新增基线受保护写入、写后回读、文件不可用暂停与恢复。文件能力定向回归 14 项通过；`pnpm test` 共 1,879 项通过（前端 1,662、脚本 217）；`pnpm lint` 与 566 个模块边界检查通过；`cargo fmt -- --check`、`cargo check --lib`、`cargo test --lib` 通过，Rust 结果为 626 通过、3 项环境依赖测试忽略；`pnpm build` 与 `git diff --check` 通过。生产构建仍报告既有循环 chunk 与大 chunk 提示。未启动实际 Tauri 桌面窗口，文本冲突操作、文件删除后恢复和图片热刷新仍标记为待桌面交互验收。

2026-07-28 跨页面右键一致性：增加共享命令矩阵、名称输入对话框和路径操作控制器；智能体详情与终端文件树已移除各自缺失或私有的菜单分支并接入共享菜单。定向行为与接入回归 15 项通过，四份 locale JSON 可解析；`pnpm test` 共 1,894 项通过（前端 1,677、脚本 217）；`pnpm lint` 与 573 个模块边界检查、`pnpm build`、`git diff --check` 通过。Apple Silicon 本地 `.app` 使用显式 ad-hoc identity 完成资源封装签名；Tauri 内置 DMG Finder 美化脚本在本机退出后，以其已生成的临时映像完成压缩和 ad-hoc 签名。最终 DMG、源码 `.app` 和 DMG 内 `.app` 均通过严格 codesign，`hdiutil verify` 通过。该包没有 Developer ID、notarization 或 Gatekeeper 接受结论；尚未在实际 Tauri 窗口逐页右键走查。

2026-07-28 文件格式分流：定向 TypeScript 回归 13 项通过；`pnpm test`、`pnpm lint`（575 个模块边界检查）、`pnpm build`、`cargo fmt -- --check`、`cargo check --lib` 和 `git diff --check` 通过；`cargo test --lib` 为 627 项通过、3 项环境依赖测试忽略。重新生成的 Apple Silicon `.app` 与 DMG 均通过严格 codesign，DMG 校验和有效；挂载后确认应用版本 `1.4.14`、架构 `arm64`、签名类型为 ad-hoc。未启动实际 Tauri 窗口，图片、PDF、未知二进制及源码格式仍需桌面交互走查；该制品未做 Developer ID 签名或 notarization。

2026-07-28 Markdown 预览与操作栏：用统一 GFM React 渲染器替换 `FileViewer` 的字符串 HTML 注入和文件管理页的重复渲染器；标题目录由标准 Markdown AST 生成，工作区本地图片仍经过前端路径规范化与 Rust IPC 根目录门禁。Markdown、跨平台路径、工作区源码接入和文件管理页接入定向回归 14 项通过；`pnpm test` 共 1,932 项通过（前端 1,709、脚本 223）；`pnpm lint` 与 582 个模块边界检查、`pnpm build`、locale JSON 解析和 `git diff --check` 通过。最大 JavaScript chunk 为 513.31 kB，低于 550 kB 门禁，构建没有循环 chunk 或超限提示。应用内浏览器控制技能已尝试连接，但当前会话没有可用浏览器实例；未把源码检查描述成实际 Tauri 窗口验收，长文档目录、模式切换、更多菜单、标签右键和本地图片仍需桌面走查。
