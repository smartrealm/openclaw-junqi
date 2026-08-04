# Orca 文件目录与预览对齐审查

日期：2026-08-04
审查范围：本机 `gui/orca` 文件目录、文件打开、预览页签、编辑器渲染和刷新稳定性；JunQi 的智能体工作区、文件管理器、聊天文件预览及 Agent Hub 树/网格视图。
源码依据：Orca `473442865`，JunQi `b266510c`。两份源码均以本机工作树的实际内容为准，不以截图或模型记忆推断协议。

## 结论

Orca 的实现不是一个孤立的 Markdown 组件，也不是“点击文件后直接把文本塞进编辑器”。它由四个相互独立但有明确契约的边界组成：

1. 目录树缓存和刷新状态，保证重新读取时旧列表继续可见，避免列表和滚动位置跳动。
2. 文件打开会话，区分一次性预览页签和固定页签；单击预览，双击固定。
3. 文件能力解析，根据语言和文件状态决定源码、富预览、浏览器预览或只读媒体预览。
4. 共享渲染器和工具栏，统一源码/预览切换、操作按钮、快捷键和多语言提示。

JunQi 已经有 `resolveWorkspacePreview`、`ManagedFilePreview`、`FileViewer` 和文档生命周期服务，这些是正确的基础。审查基线中的工作区链路尚未完全复用这套边界：

- 工作区只有 Markdown 能在工具栏切换 Source/Preview；JSON 被分类为普通 editor，不能进入格式化预览。
- `ManagedFilePreview` 已经是聊天和只读文件结果的共享入口，但工作区的 Markdown 仍直接渲染 `MarkdownPreview`，形成两个 UI 入口。
- Orca 的单击预览/双击固定页签语义尚未在 JunQi 的 `WorkspaceFileTree` 和 `fileViewerTabsState` 中建模。
- 工作区刷新按钮通过 `key={\`${root}:${treeKey}\`}` 重挂载整棵树，直接丢失目录展开状态；这正是 Orca 通过目录缓存解决的闪动问题。
- Orca 文件目录右上角的视图切换实际是 “Names / Contents”（按文件名或内容搜索），不是 Tree/Grid。JunQi Agent Hub 的 Tree/Grid 是另一块页面布局，不能声称来自 Orca 原生能力。

目标不是复制 Orca 的 Electron/Monaco 源码，而是复制其行为契约，并把这些行为落到 JunQi 已有的共享文件平台中。这样工作区、文件管理器、终端入口和聊天文件结果才能使用同一个能力解析和预览渲染边界。

## Orca 实现证据

### 目录树不是一次性读取

`src/renderer/src/components/right-sidebar/useFileExplorerTree.ts` 是目录状态的核心：

- `dirCache` 按目录保存子项和 `loading` 状态（第 39-53 行）。
- 强制刷新时保留旧 `children`，只把目录标记为 loading（第 65-78 行）。旧列表不会先被清空，因此虚拟列表高度和滚动位置不发生瞬时变化。
- `createFileExplorerDirLoadTracker` 为每次读取分配 token，迟到结果通过 `isCurrent` 丢弃（第 80-97、99-113 行）。
- 刷新前记录需要重新验证的展开目录，根目录成功后并发刷新展开分支；没有把整个树重置成空对象（第 158-215 行）。

`FileExplorer.tsx` 进一步使用 `@tanstack/react-virtual` 的稳定行投影（第 1-4、193-218、418 行附近）。这不是视觉动画，而是数据投影稳定性：刷新期间旧行仍然存在，读取完成后按路径替换。

### 单击预览，双击固定

`src/renderer/src/components/right-sidebar/useFileExplorerHandlers.ts` 的 `activateFileExplorerNode` 对文件调用：

```ts
openFile(file, {
  preview: true,
  focusEditor: true,
  suppressActiveRuntimeFallback: fileRuntimeEnvironmentId === null
})
```

依据：第 128-153 行。目录点击只改变展开状态，符号链接先显式 `stat`，运行时 owner 无法匹配时拒绝打开并给出错误，不把运行时问题伪装成文件问题。

同一 Hook 的双击回调只调用 `makePreviewFilePermanent`（第 157-260 行），不会再次创建第二个页签。双击的语义是把刚才的临时预览升级为固定页签。

### 临时预览的替换范围是有边界的

`src/renderer/src/store/slices/editor.ts` 的 `openFile` 实现体现了 Orca 的页签契约：

- `isPreview` 由调用方显式传入（约第 1740-1765 行）。
- 临时预览只在同一 worktree 和目标 group 内替换（约第 1762、1833-1851 行）。
- 替换时原地保留页签位置，并统一清理草稿、光标和视图状态（约第 1839-1871 行）。
- 非预览打开会把已有文件固定下来（约第 1767-1770 行）。
- `makePreviewFilePermanent` 只修改预览标记，不重新读取文件（约第 2111-2133 行）。

因此 Orca 的“预览”不是一次性的 DOM 浮层，而是一个可被后续点击替换、也可以被双击固定的编辑器会话。

### 预览模式由文件能力决定

`src/renderer/src/components/editor/editor-panel-render-model.ts` 先解析语言和文件模式，再计算可用的 View Mode（第 87-105、151-184 行）。`EditorViewToggle.tsx` 用同一个分段控件展示 Source、Rich、Preview、Edit、Changes，并为每个图标提供多语言 Tooltip（第 18-24、29-67、97-149 行）。

`EditorContent.tsx` 的 Markdown Preview 分支从当前草稿或磁盘内容渲染，并单独处理目录、锚点、外部变更和二进制文件（第 687-727 行）。HTML 的“预览到右侧”不是把 HTML 字符串直接塞进页面，而是通过 `file-preview.ts` 创建受约束的 Browser Tab；当前 Orca 只允许本地 HTML，远程 worktree 会明确返回 unsupported（第 23-63、66-121 行）。

### Orca 没有原生 Tree/Grid 文件目录

`FileExplorerViewSwitch.tsx` 的选项只有 `files` 和 `search`，文案是 “Names” 和 “Contents”（第 24-43 行）。所以：

- JunQi Agent Hub 的 `tree/grid/activity` 是 JunQi 自己的页面布局，不能照搬成“Orca 文件目录的 Tree/Grid”。
- 但它仍应使用同一个稳定渲染原则：切换视图不应因为条件卸载、轮询 loading 或重新挂载导致整块内容闪烁。

## JunQi 当前实现对照

### 已经正确的部分

| 能力 | 当前位置 | 结论 |
| --- | --- | --- |
| 文件能力解析 | `src/workspace-files/services/previewResolver.ts` | 已有 policy、read/write/nativePreview 和大小门禁，继续作为唯一 authority。 |
| 只读共享渲染 | `src/components/FileExplorer/ManagedFilePreview.tsx` | 已统一 HTML、图片、音频、视频、PDF、Markdown、纯文本，聊天结果已经复用。 |
| 工作区编辑文档 | `src/components/FileExplorer/useWorkspaceFileDocument.ts`、`src/workspace-files/services/localEditorDocuments.ts` | 已有草稿、保存、外部变更、磁盘不可用和缺失文件关闭语义。 |
| 文件标签生命周期 | `src/components/FileExplorer/FileViewer.tsx` | 已保持所有 tab 的 pane 挂载，仅用 visibility 切换，方向正确。 |
| 安全边界 | `src/services/chat/filePreview.ts`、Rust `read_file_preview`/scoped preview | 已有 workspace root、媒体 URL 和 HTML sandbox 约束，不能退回直接 file URL。 |

### 与 Orca 的行为差异（审查基线）

下表记录审查开始时的 JunQi 行为，作为本次变更前的可追溯基线；本次落地结果和仍未覆盖的边界见文末“验证计划与边界”。

| 领域 | JunQi 当前行为 | Orca 行为 | 需要收敛的目标 |
| --- | --- | --- | --- |
| 文件点击 | `WorkspaceFileTree` 的文件点击直接 dispatch `open`，没有 preview 标记。 | 单击 `preview: true`，双击固定。 | 在 `OpenFileTab` 和 reducer 中显式建模 `isPreview`，单击预览、双击 promotion。 |
| 预览替换 | 相同路径复用，新的文件会不断追加 tab。 | 同一 worktree/group 的临时预览原地替换，保留 tab 位置。 | 把替换范围、位置和状态清理集中到 `fileViewerTabsState`，页面不自行拼接。 |
| Markdown | `FilePreviewPane` 直接分支到 `MarkdownPreview`。 | 由 editor render model 决定 view mode，预览与源码共享同一文件会话。 | 保留 Markdown 专用目录功能，但渲染入口统一走共享 preview contract。 |
| JSON | `resolveWorkspacePreview` 将 code/text 统一为 editor；CodeMirror 只提供语法色彩。 | Orca 也没有 JSON 富预览，只有 JSON language tokenization。 | JunQi 在共享 preview contract 中增加严格 JSON pretty view；JSONC/JSONL 不得误判为单一 JSON 文档。 |
| HTML | 工作区能力已能返回 isolated/static HTML，但 `FileViewerToolbar` 只有 Markdown 的模式切换。 | HTML 可通过 Browser Tab 侧开，远程路径明确不支持。 | 增加按能力显示的 Preview/Source 控件；浏览器侧开仍走 scoped URL 和 runtime owner。 |
| 树刷新 | `WorkspacePanel` 使用 `key={\`${root}:${treeKey}\`}`，刷新会重挂载树。 | `dirCache` 保留旧 children，token 丢弃迟到响应。 | 刷新只递增版本号，不重挂载同一 root 的树；加载期间保留旧行。 |
| Agent Hub 视图 | `loading` 时用 spinner 替换全部 Tree/Grid/Activity，条件渲染会反复挂载。 | 文件目录通过缓存和稳定虚拟行避免替换。 | 首次无数据才显示全屏 loading；已有数据刷新用轻量状态；视图切换保持 pane 挂载或使用稳定 view shell。 |

## JunQi 目标抽象

### 1. 共享 Preview Contract

保留 `src/workspace-files/services/previewResolver.ts` 作为能力解析 authority，扩展其结果而不是在页面中增加扩展名判断：

```ts
type WorkspacePreviewMode =
  | 'editor'
  | 'markdown'
  | 'json'
  | 'static-html'
  | 'isolated-html'
  | 'scoped-media'
  | 'scoped-pdf'
  | 'native-only'
  | 'unsupported'
```

`ManagedFilePreview` 继续是只读 renderer 的唯一联合类型。JSON 预览应携带原始文本和截断标记，由共享组件负责 `JSON.parse`、两格缩进格式化和 invalid fallback；不能在保存前改写草稿，也不能把解析失败静默成空对象。

建议文件能力矩阵：

| 文件 | 工作区默认面 | 只读/聊天面 | 规则 |
| --- | --- | --- | --- |
| `.md`/`.mdx` | Markdown Preview，可切 Source | Markdown | 复用同一个安全 Markdown renderer。 |
| `.json` | JSON Preview，可切 Source | JSON | 严格 RFC JSON；非法内容展示原文并提示。 |
| `.jsonc` | Source | Text | 注释语法不能被 `JSON.parse` 错误吞掉；后续如需格式化必须引入显式 JSONC parser。 |
| `.jsonl` | Source | Text | 每行独立记录，不能按单一 JSON 文档解析。 |
| `.html`/`.htm` | Scoped Preview 和 Source | Interactive/Static HTML | 只允许受控 URL 和 sandbox。 |
| 图片/音频/视频/PDF | 只读媒体面 | 同一 ManagedFilePreview | Native preview 不可用时明确失败，不降级到任意路径。 |
| 其他文本/代码 | Source | Text | 继续使用 CodeMirror 和语言扩展。 |

### 2. Preview Session Controller

新增一个小型、纯状态的 tab reducer 或 service，建议仍放在 `src/components/FileExplorer/fileViewerTabsState.ts` 领域边界内：

- `openPreview(tab)`：同 root/workspace scope 内替换现有临时页签，保留位置；同一路径只激活已有 tab。
- `openPermanent(tab)`：创建或激活固定 tab。
- `promote(path)`：将临时 tab 变成固定 tab，不重新读取文档。
- `close`、`closeOthers`、`closeToLeft/Right`：沿用现有保存屏障。
- `rebase`、`remove`：沿用路径安全辅助函数，并同步 preview/source 状态。

组件只发动作，不在 `WorkspacePanel`、`WorkspaceFileTree` 和 `FileViewer` 三处各自判断临时 tab。

### 3. Stable Directory Cache

JunQi 当前 `WorkspaceFileTree` 已有“旧 entries 保留到读取完成”的局部行为，但 root 级 `key` 会破坏它。目标是：

1. `WorkspacePanel` 用 `key={root}`，刷新只传 `refreshVersion`，不因按钮点击重挂载同一 root。
2. `WorkspaceFileTree` 保存 root entries、每个展开目录的 children、loading、error 和请求 token。
3. 强制刷新保留旧 children；成功后按路径提交新列表；失败保留旧列表并显示错误状态。
4. 迟到请求不得覆盖新 root、重命名或删除后的状态。
5. 只有首次读取且没有任何缓存时才显示空白 loading；刷新时显示 toolbar 的轻量 spinner。

### 4. Shared Preview Toolbar

`FileViewerToolbar` 应由能力结果驱动，而不是 `isMarkdown` 驱动：

- 所有可切换 source/preview 的能力使用同一个 `EditorViewToggle` 风格的 compact control。
- Markdown 额外提供 Outline；JSON 不显示 Outline。
- Copy path、Copy relative path、Reveal、Word wrap、Open external 等动作继续集中在工具栏，并且全部使用 locale key 和 Tooltip。
- HTML 侧开必须进入 scoped browser adapter，不直接把实现写进 toolbar。

## 树/网格闪动的明确修复边界

Agent Hub 的 `src/pages/AgentHub/index.tsx` 当前将 `loading.sessions || loading.agents` 直接映射为整页 spinner（约第 716、1294-1302 行），并通过 `viewMode === ...` 条件挂载三个视图（约第 1307-1327 行）。这会导致：

- 轮询请求开始时当前内容被卸载；
- Tree/Grid 切换时重建 `GlassCard` 和动画入口；
- 用户看到的闪动被误认为数据发生了变化。

应分成两个状态：

- `initialLoading`：没有任何成功快照且当前请求未完成时才显示全局 loading；
- `refreshing`：已有快照时只给刷新按钮和页面标题提供非阻塞状态。

三个视图需要由稳定的 view shell 保持挂载，用 `hidden`/`aria-hidden`/`pointer-events` 切换，或者由不带 enter animation 的容器包住。视图切换不应清空数据、重建请求或重新播放整页入场动画。

## 实施顺序

### Phase 1：先收敛模型和回归测试

1. 为 `OpenFileTab` 和 reducer 增加 preview/promotion 状态测试。
2. 为 `ManagedFilePreview` 增加 JSON valid、invalid、truncated 测试。
3. 为 `previewResolver` 增加 `.json`、`.jsonc`、`.jsonl` 的差异测试。
4. 为目录刷新增加“旧 children 可见、迟到响应被丢弃、root 切换隔离”的行为测试。

### Phase 2：迁移工作区交互

1. `WorkspaceFileTree` 文件单击调用 `openPreview`，双击调用 `promote`。
2. `WorkspacePanel` 去除 refresh key 重挂载，传入 refresh version。
3. `FileViewer` 的 preview mode 改为由 `resolveWorkspacePreview` 统一决定。
4. JSON 进入共享 ManagedFilePreview；源码模式仍由 CodeMirror 提供编辑能力。

### Phase 3：统一只读入口和视图稳定性

1. Chat、artifact、workspace 三者只使用同一 `ManagedFilePreview` 联合类型和渲染组件。
2. Agent Hub 使用 `initialLoading`/`refreshing` 双状态和稳定 view shell。
3. 删除页面中重复的扩展名判断、重复的 JSON/Markdown 渲染分支和无效 loading 状态。

## 验收条件

### 文件目录和页签

- 单击文件只保留一个临时预览页签；继续单击其他文件时在同一 scope 原地替换，不改变 tab 位置。
- 双击文件或显式编辑操作后，当前预览页签固定；后续文件点击不会覆盖它。
- 切换 tab、刷新目录、重命名和删除不会把草稿写到错误路径。
- 刷新期间目录旧内容继续可见，展开状态、滚动位置和选择状态不跳变。
- root、runtime owner、远程路径和迟到响应均有明确失败边界。

### 文件格式

- JSON 合法时展示稳定的两格缩进结构；数组、空值、Unicode 和大数字不被静默改写。
- JSON 非法时展示原文和可翻译提示，不能展示空白或 `{}`。
- JSONC、JSONL 不被当作单一 JSON 文档格式化。
- Markdown、HTML、媒体、PDF、纯文本在工作区和聊天只读卡片中使用同一能力解析和渲染契约。

### 视图稳定性

- 首次没有数据时可以显示全局 loading；已有数据的轮询刷新不得替换当前视图。
- Tree/Grid/Activity 切换不触发整页淡入、卡片重新上浮或数据清空。
- 任何 loading 指示器都不能改变固定格式工具栏、目录行和预览面板的尺寸。

## 验证计划与边界

本次已落地的改动：

- 工作区文件单击使用临时预览页签，双击提升为固定页签，右键 Open 使用固定页签；预览页签在同一工作区内原地复用。
- `WorkspacePanel` 刷新改为版本信号，不再用 refresh key 重挂载同一个根目录；展开目录在刷新时保留旧内容，完成后再替换。
- `.json` 进入共享 `ManagedFilePreview` 做稳定两格缩进格式化，非法 JSON 保留原文并显示本地化提示；JSONC 仍保持源码编辑。
- Chat、artifact 和 workspace 的 JSON 识别都复用 `isJsonFileName`、`resolveWorkspacePreview` 与 `ManagedFilePreview` 契约。
- Agent Hub 将首次加载和已有快照后的刷新分开，Tree/Grid/Activity 视图保持挂载，仅通过稳定 shell 隐藏非当前视图，避免轮询和切换造成整块闪动。
- 相关回归测试覆盖 JSON 合法/非法内容、附件与 artifact 分类、预览页签替换/固定，以及工作区接线。

仍未完全等同 Orca 的边界：JunQi 当前目录树还没有 Orca 那样的跨展开生命周期目录缓存和虚拟化长列表；本次只先移除了同根目录刷新时的强制重挂载，并保留了旧内容。远程 workspace、HTML scoped browser 和媒体/PDF 的真实 Tauri 窗口验收仍需桌面环境验证。

代码修改后至少执行：

```bash
pnpm test -- src/components/FileExplorer src/components/Workspace src/services/chat src/utils
pnpm lint
pnpm build
git diff --check
```

需要桌面窗口额外确认：

- Tauri WebView 中 CodeMirror gutter 与正文仍保持横向布局；
- HTML scoped preview、PDF、音视频和远程 workspace 的失败提示；
- 单击/双击节奏、触控板双击和目录刷新时的实际视觉稳定性。

本文件是基于本机 Orca 和 JunQi 源码的审查、实施设计和本次落地记录；自动化测试通过不等同于目标平台真机验收。
