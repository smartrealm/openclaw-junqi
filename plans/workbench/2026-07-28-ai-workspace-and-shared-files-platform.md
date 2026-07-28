# JunQi AI 工作台与共享文件平台实施计划

> 日期：2026-07-28  
> 状态：待实施；当前仅完成前端方向验证，禁止把硬编码模拟数据当作正式实现  
> 范围：重写 `/ai-workspace`，建设可供 AI 工作台、文件管理器、Agent Hub 和 Chat 结果复用的 Workspace Files Platform  
> 明确排除：独立 `/terminal` 的 UI、Store、持久化键、PTY handoff、session registry 与生命周期

## 1. 背景与目标

JunQi 当前 `/ai-workspace` 是以 `AgentWorkspaceTask` 为中心的任务页。它把 Task ID 同时用于任务、进程和恢复，主区域在任务详情、文件、Diff 之间互斥，无法承载 Worktree、Unified Tabs、递归分屏、可恢复 Pane、Editor、Browser、Checks、AI Vault 和多 Host ownership。

同时，JunQi 内部已有多套文件访问和预览实现：

- `src/pages/FileManager.tsx` 与 `src/components/FileExplorer/**`：功能最完整的文件树、文件 Tab、CodeMirror、Markdown/图片预览和文件操作；
- `src/components/Workspace/WorkspacePanel.tsx` 与 `WorkspaceFileTree.tsx`：Agent Hub 内再次实现文件树、读取、图片预览、CodeMirror、Dirty 和保存；
- `src/services/chat/filePreview.ts` 与 Chat Result 组件：再次实现扩展名分类、文本/Markdown/HTML/图片/音视频/PDF 只读预览；
- `src/components/Terminal/TerminalWorkspaceFiles.tsx` 与 `src/services/workspaceFs.ts`：独立 Terminal 的严格路径、安全和 watcher 能力；
- Rust `fs_neu.rs`、`fs_watcher.rs`、`managed_files.rs`：存在 workspace-root 读写、managed read-only preview 和 watcher 等不同入口。

本计划的目标不是再为 AI 工作台复制一套 FileExplorer/FileViewer，而是完成两项互相配合的正式工程：

1. 把 `/ai-workspace` 重写为 JunQi 产品外壳内的 Worktree-centric AI 开发工作台；
2. 建设统一的 Workspace Files Platform，复用文件 authority、Host adapter、类型识别、预览、Document lifecycle 和 watcher，同时允许各页面保留不同布局。

## 2. 不可破坏约束

### 2.1 JunQi 产品连续性

`/ai-workspace` 必须位于 JunQi 原有 App Shell 内：

- 保留 `TopBar`；
- 保留 `TabBar`；
- 保留 JunQi 产品导航，工作台中使用紧凑 Rail；
- 保留全局 `StatusBar`；
- 使用 Aegis Theme Token、字体、焦点环、菜单和快捷键基础设施；
- Worktree Sidebar 是二级上下文导航，不能替代 JunQi 产品导航；
- 不再把 `/ai-workspace` 表现为跳入另一款应用的 drill-in 页面。

### 2.2 独立 `/terminal` 冻结边界

不得为了新工作台修改或复用以下 ownership：

```text
src/pages/TerminalPage/**
src/components/Terminal/**
src/stores/workspaceStore.ts
src/styles/terminal-kooky.css
```

尤其不得改变：

- `/terminal` 路由及视觉；
- Terminal Sidebar event namespace；
- Terminal 持久化键；
- `terminalPtyHandoff.ts`；
- `terminalSessionRegistry.ts`；
- `ShellTerminalPanel.tsx` lifecycle；
- `pty_neu.rs` 被独立 Terminal 使用的语义。

新 `/ai-workspace` 必须拥有独立的 Store、Session schema、Pane identity、PTY registry 和 Host adapter。可参考独立 Terminal 的 run generation、UTF-8 batch 和 handoff 算法，但不得共享 ownership 或改变旧生命周期。

### 2.3 Ownership 和异步安全

- FS、Git、PTY、Browser、Review 操作必须显式绑定 Host owner；
- Host capability 不可用时显示 unavailable/unknown，不得猜测；
- 请求必须携带 generation/revision，迟到结果不得写入 replacement Host、Worktree、Pane、文件或 PTY；
- destructive operation 必须 fail closed；
- hydration 完成前禁止 session writer 写回空状态；
- source-regex 测试不能替代真实异步行为测试。

### 2.4 许可

如直接移植 Orca substantial React/TypeScript/算法代码：

- 保留 MIT License；
- 保留 `Copyright (c) 2026 Lovecast Inc.`；
- 更新 `THIRD_PARTY_NOTICES.md`；
- 记录来源文件、改动范围及 Electron 耦合替换方式。

## 3. 最终产品结构

```text
JunQi App Shell
├── TopBar
├── TabBar
├── JunQi Product Rail
├── /ai-workspace
│   ├── Worktree Sidebar
│   │   ├── Host groups
│   │   ├── Repository groups
│   │   ├── Worktrees
│   │   └── Agent/attention/status
│   ├── Unified Tab Group Workbench
│   │   ├── Agent Terminal Pane
│   │   ├── Editor Pane
│   │   ├── Diff Pane
│   │   ├── Browser Pane
│   │   ├── Conflict Review Pane
│   │   └── Check Details Pane
│   └── Right Sidebar
│       ├── Files
│       ├── Search
│       ├── Source Control
│       ├── Checks
│       ├── Ports
│       ├── AI Vault
│       └── Plugin Panels
└── Global StatusBar
```

布局基线：

- JunQi Product Rail：使用已有 mini 模式；
- Worktree Sidebar：默认约 280px，建议范围 220–500px；
- Right Sidebar：默认约 350px，最小 220px；
- Unified Group Tab Row：约 32px；
- 工作台局部状态栏：约 22–24px；
- 小窗口优先收起 Worktree Sidebar 或 Right Sidebar，不隐藏 Product Rail；
- Terminal/Browser 等高成本 Pane 采用 parking，不因 Tab 切换反复销毁。

## 4. 目标目录与模块边界

### 4.1 Workbench 前端

```text
src/workbench/
├── domain/
│   ├── ids.ts
│   ├── hosts.ts
│   ├── worktrees.ts
│   ├── tabs.ts
│   ├── panes.ts
│   ├── terminals.ts
│   └── sessions.ts
├── store/
│   ├── workbenchStore.ts
│   ├── slices/
│   │   ├── hosts.ts
│   │   ├── projects.ts
│   │   ├── worktrees.ts
│   │   ├── tabGroups.ts
│   │   ├── tabs.ts
│   │   ├── panes.ts
│   │   ├── terminals.ts
│   │   ├── agents.ts
│   │   ├── editor.ts
│   │   ├── browser.ts
│   │   ├── hostedReview.ts
│   │   └── ui.ts
│   └── selectors/
├── adapters/
│   ├── hostAdapter.ts
│   ├── localHostAdapter.ts
│   ├── sshHostAdapter.ts
│   └── runtimeHostAdapter.ts
├── session/
│   ├── schema.ts
│   ├── hydrate.ts
│   ├── normalize.ts
│   ├── writer.ts
│   └── migrations.ts
├── components/
│   ├── WorktreeSidebar/
│   ├── TabBar/
│   ├── TabGroup/
│   ├── panes/
│   ├── RightSidebar/
│   └── WorkbenchStatusBar/
└── lifecycle/
    ├── activation.ts
    ├── sleep.ts
    ├── wake.ts
    └── deletion.ts
```

### 4.2 共享 Workspace Files Platform

```text
src/workspace-files/
├── domain/
│   ├── types.ts
│   ├── fileKinds.ts
│   ├── paths.ts
│   ├── errors.ts
│   └── capabilities.ts
├── adapters/
│   ├── types.ts
│   ├── localWorkspaceFiles.ts
│   ├── managedFiles.ts
│   ├── sshWorkspaceFiles.ts
│   └── runtimeWorkspaceFiles.ts
├── services/
│   ├── previewResolver.ts
│   ├── editorDocumentManager.ts
│   ├── watchCoordinator.ts
│   └── fileOperations.ts
├── store/
│   ├── fileTreeStore.ts
│   ├── editorDocumentStore.ts
│   └── selectors.ts
├── hooks/
│   ├── useFileTree.ts
│   ├── useFileDocument.ts
│   ├── useFilePreview.ts
│   └── useFileWatch.ts
└── components/
    ├── FileTree/
    ├── FileEditor/
    ├── FilePreview/
    ├── FileTabs/
    └── FileOperationDialogs/
```

### 4.3 Tauri 模块

```text
src-tauri/src/workbench/
├── mod.rs
├── session_store.rs
├── pty_registry.rs
├── pty_protocol.rs
├── agent_process.rs
└── worktree_lifecycle.rs

src-tauri/src/workspace_files/
├── mod.rs
├── authority.rs
├── paths.rs
├── read.rs
├── write.rs
├── operations.rs
├── preview.rs
├── search.rs
└── watcher.rs
```

开始时可由新模块调用现有 `fs_neu.rs` 原语，确认所有消费者迁移后再决定是否移动代码；不得在迁移前大规模重命名 Rust command。

## 5. Workbench 身份与状态模型

### 5.1 稳定身份

```ts
type HostId = string;
type ProjectId = string;
type RepositoryId = string;
type WorktreeId = string;
type TabGroupId = string;
type TabId = string;
type PaneId = string;
type PtyId = string;
type PtyRunId = string;
type ProviderId = string;
type ProviderSessionId = string;
```

禁止继续用 `AgentWorkspaceTask.id` 同时表示 Task、Pane、PTY 和 Provider Session。

### 5.2 Host 与 Worktree

```ts
interface WorkbenchHost {
  id: HostId;
  kind: 'local' | 'ssh' | 'runtime';
  revision: number;
  connectionState: 'connected' | 'connecting' | 'offline' | 'error';
  capabilities: WorkbenchHostCapabilities;
}

interface WorkbenchWorktree {
  id: WorktreeId;
  projectId: ProjectId;
  repositoryId: RepositoryId;
  hostId: HostId;
  hostRevision: number;
  path: string;
  branch: string | null;
  lifecycle: 'active' | 'sleeping' | 'waking' | 'deleting' | 'unavailable';
}
```

### 5.3 Tab 与递归 Group

```ts
type WorkbenchTab =
  | AgentTerminalTab
  | EditorTab
  | DiffTab
  | BrowserTab
  | ConflictReviewTab
  | CheckDetailsTab;

type TabGroupLayoutNode =
  | { type: 'group'; groupId: TabGroupId }
  | {
      type: 'split';
      direction: 'horizontal' | 'vertical';
      ratio: number;
      first: TabGroupLayoutNode;
      second: TabGroupLayoutNode;
    };
```

Split 比例限制在 15%–85%。删除空 Group 后必须归一化只剩一个子节点的 Split。

### 5.4 Agent Pane 身份

Agent Pane 至少保存：

- `paneId`；
- `ptyId`；
- `ptyRunId`；
- `providerId`；
- `providerSessionId`；
- `worktreeId`；
- `hostId` 与 `hostRevision`；
- `launchToken`；
- resume identity；
- `viewMode`；
- sleeping/attention/status metadata。

## 6. 共享文件平台设计

### 6.1 File Scope 与策略

```ts
interface WorkspaceFileScope {
  hostId: HostId;
  hostRevision: number;
  workspaceId: string;
  rootPath: string;
  rootRevision: number;
  policy: 'workspace' | 'terminal-strict' | 'managed-readonly';
}
```

Rust 对应：

```rust
pub enum FileAccessPolicy {
    WorkspaceReadWrite,
    TerminalStrict,
    ManagedReadOnly,
}
```

策略含义：

- `WorkspaceReadWrite`：AI Workspace、FileManager、Agent Hub Workspace；
- `TerminalStrict`：独立 Terminal，保持不跟随外部 symlink 等现有约束；
- `ManagedReadOnly`：Chat 附件、历史结果、Native media preview，禁止写入。

### 6.2 统一 Adapter

```ts
interface WorkspaceFilesAdapter {
  capabilities(scope: WorkspaceFileScope): Promise<FileCapabilities>;
  listDirectory(scope: WorkspaceFileScope, path: string, options?: ListDirectoryOptions): Promise<FileEntry[]>;
  readText(scope: WorkspaceFileScope, path: string, options?: ReadTextOptions): Promise<TextFileSnapshot>;
  readBinaryPreview(scope: WorkspaceFileScope, path: string): Promise<BinaryPreviewDescriptor>;
  writeText(scope: WorkspaceFileScope, request: WriteTextRequest): Promise<FileWriteResult>;
  createFile(scope: WorkspaceFileScope, path: string): Promise<void>;
  createDirectory(scope: WorkspaceFileScope, path: string): Promise<void>;
  rename(scope: WorkspaceFileScope, from: string, to: string): Promise<void>;
  delete(scope: WorkspaceFileScope, path: string): Promise<void>;
  search(scope: WorkspaceFileScope, request: FileSearchRequest): Promise<FileSearchResult>;
  watch(scope: WorkspaceFileScope, request: WatchRequest): Promise<FileWatchHandle>;
}
```

组件不得继续直接散落调用：

```text
read_dir_entries
read_file_content
read_image_preview
write_file_content
watch_dir
unwatch_dir
managedFiles.read
managedFiles.createPreview
```

过渡期允许旧 wrapper 委托新 Adapter；全部迁移前不得一次删除旧 API。

### 6.3 统一文件类型

唯一事实来源：

```ts
type WorkspaceFileKind =
  | 'code'
  | 'text'
  | 'markdown'
  | 'html'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'binary'
  | 'unsupported';

interface FileKindDescriptor {
  kind: WorkspaceFileKind;
  languageId?: string;
  mimeType?: string;
  editable: boolean;
  previewable: boolean;
  requiresNativeUrl: boolean;
  maxInlineBytes?: number;
}
```

迁移并删除 `workspaceFs.ts`、`filePreview.ts`、`FileViewer.tsx` 等处重复的扩展名集合；保留一个集中契约测试，覆盖大小写、无扩展名、复合扩展名、Windows 路径和 `file://` 路径。

### 6.4 统一 Preview Resolver

支持：

- Code/Text source；
- Markdown source/rendered；
- HTML static/interactive；
- Image；
- Audio/Video；
- PDF；
- Binary metadata；
- Too large；
- Unsupported；
- unavailable/error。

输入：

```ts
interface FilePreviewRequest {
  scope: WorkspaceFileScope;
  path: string;
  mode: 'readonly' | 'editable';
  preference?: 'source' | 'rendered';
}
```

HTML interactive、媒体和 PDF 必须通过 Native scoped preview URL，不允许页面直接读取任意原始文件 URL。`ManagedReadOnly` 只能读已登记路径。

### 6.5 Editor Document Manager

```ts
interface EditorDocument {
  key: string;
  scope: WorkspaceFileScope;
  path: string;
  loadGeneration: number;
  writeGeneration: number;
  diskContent: string;
  draftContent: string;
  diskRevision?: string;
  lastWriteOperationId?: string;
  status: 'loading' | 'clean' | 'dirty' | 'saving' | 'saved' | 'conflicted' | 'deleted' | 'error';
}
```

实现要求：

1. 每个文件独立串行写入，文件 A 不阻塞文件 B；
2. 新 load generation 建立后，旧读取结果不得覆盖；
3. 旧 write generation 的完成不得清除新 Draft 的 Dirty 状态；
4. watcher 事件携带 `operationId` 时识别 self-write echo；
5. 无 operation identity 时读取磁盘 revision/content 再判断，不能盲目忽略；
6. Dirty + 外部变化进入 `conflicted`，禁止自动覆盖任意一侧；
7. delete 进入 tombstone，不允许后续自动保存重建文件；
8. rename 原子迁移 Tab、Document、Draft、watch subscription 和 active path；
9. Preview Tab 编辑后转为 Permanent；
10. Draft 纳入 Workbench durable session 和 shutdown checkpoint。

### 6.6 Watch Coordinator

新事件协议：

```ts
interface WorkspaceFileEvent {
  watchId: string;
  scopeId: string;
  hostId: HostId;
  hostRevision: number;
  sequence: number;
  kind: 'created' | 'changed' | 'deleted' | 'renamed' | 'overflow';
  path: string;
  oldPath?: string;
  operationId?: string;
}
```

Coordinator 必须负责：

- 相同 scope/path 的 watch 合并和引用计数；
- generation/revision fence；
- sequence gap 检测；
- self-write operation 分发；
- overflow 后标记 stale 并全量 rescan；
- Host 断线后注销或暂停；
- 页面隐藏时按能力降级；
- Tree 和 Editor 共享订阅，避免各自注册 Native watcher。

迁移期间同时支持旧 `fs-changed { dir }` 和新事件；所有非 Terminal 消费者迁移后再删除旧协议。Terminal watcher 不在本次强制迁移范围内。

## 7. 各消费场景的组合方式

| 场景 | 文件树 | 编辑 | Tab | 预览 | Watch | 策略 |
|---|---:|---:|---:|---:|---:|---|
| AI Workspace | 是 | 是 | Unified Tabs | 完整 | 是 | Worktree owner |
| FileManager | 是 | 是 | 文件 Tab | 完整 | 是 | Workspace root |
| Agent Hub Panel | 是 | 是 | 单文档/紧凑 | 精简 | 是 | Agent workspace |
| Chat Result | 否 | 否 | 否 | 内嵌只读 | 可选 | Managed read-only |
| Terminal | 保持现有 | 保持现有 | 保持现有 | 保持现有 | 保持现有 | Terminal strict |

统一的是 authority、Adapter、类型、Document、Preview 和 watcher 协议，不是强制所有页面使用同一个巨型组件。

## 8. Durable Workbench Session

### 8.1 持久化内容

- Host partitions；
- Active Host/Worktree；
- Tab Group tree 与 split ratio；
- 每个 Group 的 Tab 顺序和 active Tab；
- Pane metadata；
- Editor open files 和 Draft；
- Browser pages；
- PTY identifiers 和 sleeping agent metadata；
- Right Sidebar panel；
- 左右栏模式；
- Sidebar filter/reveal；
- Schema version。

### 8.2 Hydration gates

```text
storageLoaded
→ hostPartitionsLoaded
→ worktreesLoaded
→ sessionLoaded
→ sessionValidated
→ storeHydrated
→ writerReady
```

`writerReady` 前禁止写入。load 失败或损坏恢复未完成时 writer fail closed，不能用空 Store 覆盖磁盘。

### 8.3 Rust durability

新专属存储不得继续写入旧 `AgentWorkspaceTask[]` 文件。要求：

- temp file；
- file `sync_all`；
- atomic rename；
- directory fsync；
- write generation fence；
- normalized hash no-op；
- 最多五槽滚动备份；
- 损坏文件隔离；
- 从最近有效备份恢复；
- Host partition；
- schema migration 结果记录。

### 8.4 Shutdown checkpoint

```text
window close requested
→ 同步 fence 新 session mutation
→ flush per-file write queues
→ capture normalized workbench snapshot
→ durable session checkpoint
→ checkpoint 成功或明确用户决策
→ allow exit
```

不能只依赖 React unmount 的 best-effort async flush。

## 9. Workbench 功能实施详情

### 9.1 Unified Tabs 和 Split

实现：

- Preview/Permanent/Dirty/Pinned Tab；
- 创建、关闭、关闭其他、关闭右侧；
- Tab reorder 和跨 Group 移动；
- 水平/垂直递归 Split；
- 15%–85% resize；
- Group 最大化/恢复；
- 空 Group 清理和树归一化；
- 键盘 Group 导航；
- Pane focus restoration；
- Terminal/Browser parking。

### 9.2 Worktree Sidebar

实现：

- Local/SSH/Runtime Host 分组；
- Repository/Worktree 分组；
- branch、dirty、ahead/behind；
- Agent running/attention/sleeping；
- 搜索、过滤、虚拟化、多选、键盘；
- active reveal；
- full/compact/hidden；
- Worktree lineage；
- owner unavailable 状态。

激活链：

```text
sidebar action
→ resolve host owner
→ capture host revision
→ activate worktree
→ hydrate/reconcile worktree session
→ restore active group/tab/pane
→ attach parked resources
→ focus pane
```

任一步 ownership 变化必须终止旧链，不得把旧结果画入新 Worktree。

### 9.3 新 Workbench PTY

不得将 `agent_task_pty` 作为新 PTY Host。新协议支持：

- create/attach/detach/input/resize/stop/dispose/status；
- `PaneId → PtyId → PtyRunId → launchToken → provider session claim`；
- output sequence；
- gap detection；
- bounded snapshot + snapshot sequence；
- resync；
- replacement run isolation；
- create reconciliation；
- physical process stop；
- renderer reload 后重新 attach。

Remote PTY 后续必须使用 multiplex、ACK credit、bounded inflight、snapshot/resync，不得退化为逐条 RPC 或盲重试。

`agent_send_input` 对不存在目标静默成功的旧语义不得进入新协议。

### 9.4 Agent lifecycle

实现：

- data-driven Provider/Agent 选择；
- model、permission、plan；
- provider session claim；
- resume/continue in new session；
- sleeping/wake/hibernation；
- OSC/Bell/status parsing；
- attention；
- launch token 和迟到结果 fence。

旧 `AgentWorkspaceTask` 仅作为 migration/AI Vault 数据源，不再是 authority。

### 9.5 Git、Diff、Checks 和 Hosted Review

基于 `git_neu.rs` Adapter 提供 status、branch、history、diff、stage、unstage、discard、commit、publish、sync、conflict 和 operation state。

Hosted Review 支持 GitHub、GitLab、Bitbucket、Azure DevOps、Gitea，并实现：

- owner-aware cache identity；
- 60 秒 TTL；
- inflight 合并；
- generation fence；
- stale-while-revalidate；
- 瞬时错误保留可信结果；
- merged/review HEAD 漂移拒绝旧结果；
- bounded timeout。

Right Sidebar 隐藏时停止高成本 polling，但保留组件必要状态。

### 9.6 Browser Pane

Tauri 不能照搬 Electron BrowserView。实施前验证：

1. Tauri child webview 的嵌入、位置同步和生命周期；
2. cookie/session partition；
3. popup、download、certificate、navigation policy；
4. pointer passthrough、focus、resize、z-order；
5. parking/crash recovery；
6. Remote screencast 边界。

能力不满足时明确降级为外部浏览器打开，不得伪装为完整内嵌 Pane。

### 9.7 AI Vault

扫描身份为 `Host + Agent + Session ID + Transcript Path`。实现 Host-local scan、limit、parse concurrency、增量 cache、持久化 parse cache、去重、scope generation 和 inflight 合并。

Resume 前重新验证：

- transcript 存在且含真实对话；
- Host owner 一致；
- Worktree 存在；
- Provider 支持；
- Session 未被其他 Pane claim；
- Pi 等 Provider 的 transcript path identity 一致。

### 9.8 Worktree sleep/wake/delete

Sleep：

```text
fence active worktree
→ hide visible worktree
→ non-rendering sleep intent
→ park/close Browser
→ detach/shutdown PTY and preserve identity/snapshot
→ persist provider session/layout
→ optional runtime suspend
→ mark sleeping
```

Wake 恢复 Session、Group、PTY snapshot/resync、Browser、Agent 和焦点。

Delete 必须校验：主 checkout、根目录、home、repo ancestor、嵌套注册 Worktree、Git lock、dirty、orphan proof、Host owner、operation generation 和 PTY physical stop。只有后端成功后才能清理前端 Tabs、Panes、Drafts、Browser、Git cache 和 Sidebar row。

## 10. 分阶段实施顺序

### Phase 0 — 边界与测试基线

1. 移除硬编码原型数据，保留确认后的视觉 token 和结构；
2. 建立 `/terminal` 源码、路由、持久化键、事件 namespace 和 lifecycle 契约测试；
3. 把 `/ai-workspace` 保持在 JunQi Product Rail 内；
4. 用新结构/行为测试替换旧 `AgentWorkspace/index.test.ts` 中已经失效的 Task-centric 源码正则断言；
5. 记录当前 FileManager、Agent Hub、Chat、Terminal 的行为基线。

**完成条件**：没有 Demo/preview route；旧 Terminal 无 diff；构建、边界和基线测试通过。

### Phase 1 — 纯领域模型和共享文件分类

1. 建立 Workbench ID、Host、Worktree、Tab、Pane 类型；
2. 建立 `WorkspaceFileScope`、policy、capability 和统一 error；
3. 合并扩展名/MIME/preview kind；
4. 为 Windows/macOS/Linux 路径、URL、大小写和 unsupported 类型补单元测试。

**完成条件**：不改变现有 UI；所有消费者可通过兼容导出使用统一 file kind。

### Phase 2 — Workspace Files Adapter

1. 包装现有 `fs_neu`、`managed_files` command；
2. 建立 Local adapter；
3. 定义 SSH/Runtime adapter 接口并对 unsupported capability fail closed；
4. 旧 `workspaceFs.ts` 和 `filePreview.ts` 暂时成为兼容 facade；
5. 禁止新增页面直接调用文件 `invoke`。

**完成条件**：现有页面行为不变，IO 进入统一 Adapter，路径越界测试通过。

### Phase 3 — Preview Resolver 和共享 UI primitive

1. 实现统一 Preview Model；
2. 提取 Code/Markdown/Image/HTML/Media/PDF/Unsupported renderer；
3. 先迁移 Chat Result 只读预览；
4. 再迁移 Agent Hub compact preview；
5. 再迁移 FileManager 完整 preview；
6. 各页面保留自身布局和 toolbar。

**完成条件**：类型判定无重复 authority；managed media 不暴露原始任意路径。

### Phase 4 — Document Manager 与 Watch Coordinator

1. 实现 per-file load/write generation；
2. 实现 per-file serialized write queue；
3. 实现 conflict/tombstone/rename；
4. Native 增加结构化 watch 事件；
5. 新旧 watcher 双协议过渡；
6. FileManager 接入作为完整回归基线；
7. Agent Hub 接入紧凑模式。

**完成条件**：自写 echo、外部修改、删除、rename、overflow 真实异步测试通过。

### Phase 5 — Workbench Store、Unified Tabs 与 Split

1. 建立独立 Workbench Zustand Store；
2. 实现递归 Group Tree 和 normalization；
3. 实现 Unified Tabs、Preview/Permanent/Dirty；
4. 实现 parking contract；
5. 接入共享 Editor/Preview；
6. 删除 `/ai-workspace` 中硬编码 content switch。

**完成条件**：多 Group session 可序列化；关闭/移动/最大化/恢复行为测试通过。

### Phase 6 — Durable Session

1. 建立新 schema、migration、Host partition；
2. Rust 实现原子写、fsync、备份、hash、generation；
3. 实现 hydration/writer gate；
4. 实现同步 shutdown checkpoint；
5. 旧 Task 只读迁移，不回写旧 authority。

**完成条件**：冷启动、强制退出、损坏恢复和旧 generation race 测试通过。

### Phase 7 — Worktree/Host 路由与真实文件工作流

1. 接入 Workspace Store 的 Project/Worktree 数据；
2. 实现 Local owner route；
3. 预留 SSH/Runtime route 并 fail closed；
4. 实现 Worktree Sidebar 与 activation/reconcile；
5. Files/Search/Editor 使用真实 scope。

**完成条件**：切换 Worktree 不串 Session/文件；迟到结果被 revision fence 拒绝。

### Phase 8 — Workbench PTY 与 Agent

1. 新建 Tauri Workbench PTY registry/protocol；
2. create/attach/snapshot/resync；
3. Provider launch claim；
4. Terminal Pane parking；
5. sleeping/resume/attention；
6. 迁移旧 Task session 为可选历史。

**完成条件**：replacement、gap、renderer reload、sleep/wake 和 physical stop 测试通过；`/terminal` 无回归。

### Phase 9 — Git、Diff、Checks、Review

接入 owner-routed Git，完成 Diff/Conflict/Checks/Hosted Review、cache fencing 和 Fix with AI。

### Phase 10 — Browser、Vault、Plugins、Status

依次完成 Browser capability spike、AI Vault、Tauri Plugin Host、共享命令/快捷键、Ports/Resource/Update Status。

### Phase 11 — Legacy 删除和跨平台验收

1. 删除确认无调用的旧 AgentWorkspace 表现层；
2. 删除重复 preview kind 和 IO 状态机；
3. 保留 legacy task reader 直到迁移窗口结束；
4. 更新 MIT NOTICE；
5. 完成 macOS/Windows/Linux 行为矩阵。

## 11. 文件级迁移清单

### 11.1 作为能力来源、逐步拆分

```text
src/components/FileExplorer/FileExplorer.tsx
src/components/FileExplorer/FileViewer.tsx
src/components/FileExplorer/TreeItem.tsx
src/components/FileExplorer/ContextMenu.tsx
src/components/FileExplorer/treeUtils.ts
src/pages/FileMarkdownPreview.tsx
src/services/chat/filePreview.ts
src/services/workspaceFs.ts
src-tauri/src/commands/fs_neu.rs
src-tauri/src/commands/fs_watcher.rs
src-tauri/src/commands/managed_files.rs
```

### 11.2 迁移为共享组件消费者

```text
src/pages/FileManager.tsx
src/components/Workspace/WorkspacePanel.tsx
src/components/Workspace/WorkspaceFileTree.tsx
src/components/Chat/ResultCards.tsx
src/components/Chat/ResultMarkdownPreview.tsx
src/pages/AgentWorkspace/**
```

### 11.3 只允许底层兼容，不替换表现层

```text
src/pages/TerminalPage/**
src/components/Terminal/TerminalWorkspaceFiles.tsx
src/components/Terminal/ShellTerminalPanel.tsx
src/components/Terminal/terminalPtyHandoff.ts
src/components/Terminal/terminalSessionRegistry.ts
```

## 12. 测试与验证矩阵

### 12.1 每阶段必跑

```text
npm run lint
npm run build
前端全量测试
相关行为测试
Rust 全量测试
模块边界检查
git diff --check
```

如果仓库脚本名变化，以 `package.json` 现有脚本为准，不虚构不存在的脚本。

### 12.2 Files 行为测试

- 越界、symlink 和 policy；
- Local/SSH/Runtime owner route；
- 快速 A→B→A 打开与迟到读取；
- 同文件连续保存；
- 不同文件并行保存；
- save 中再次编辑；
- self-write echo；
- 外部修改 clean/dirty 两分支；
- delete tombstone；
- rename migration；
- watcher sequence gap/overflow；
- Host revision 变化；
- managed preview 未授权路径；
- 大文件、二进制、非法 UTF-8。

### 12.3 Workbench 行为测试

- Tab create/close/reorder/move；
- Preview 转 Permanent；
- Dirty close；
- recursive split normalization；
- Group focus；
- Worktree activation race；
- hydration writer gate；
- shutdown checkpoint；
- PTY replacement/attach/resync；
- sleep/wake/delete；
- Browser parking；
- Vault scope race；
- Hosted Review HEAD drift。

### 12.4 `/terminal` 回归保护

- 路由、截图或关键结构；
- PTY run generation；
- handoff；
- Terminal Sidebar mode；
- event namespace；
- persistent keys；
- tree watch；
- open/close/reload 生命周期。

## 13. 提交拆分

建议每个提交保持可构建、可回滚：

1. `测试：锁定独立终端与 JunQi 工作台外壳边界`
2. `重构：建立工作台领域身份和共享文件类型`
3. `重构：新增 Workspace Files Adapter 与权限作用域`
4. `重构：统一文件预览解析与只读渲染`
5. `重构：统一编辑文档和文件监听生命周期`
6. `功能：实现工作台独立 Store、Unified Tabs 与递归分屏`
7. `功能：实现工作台 durable session 与退出 checkpoint`
8. `功能：接入 Worktree Sidebar、Host 路由和真实文件工作流`
9. `功能：实现工作台专属 PTY 和 Agent 生命周期`
10. `功能：接入 Git、Diff、Checks 与 Hosted Review`
11. `功能：实现 Browser、AI Vault 与插件面板`
12. `完善：完成状态栏、性能、无障碍和跨平台回归`
13. `清理：删除旧 AI 工作台表现层和重复文件预览实现`
14. `文档：记录 Orca MIT 归属、迁移和降级边界`

不得把 Files Platform、PTY、Browser 和 legacy 删除混进单个无法审查的大提交。

## 14. 完成定义

只有同时满足以下条件才视为重写完成：

1. `/ai-workspace` 使用真实 Worktree、文件、Git、PTY 和 Session 数据，不含演示硬编码；
2. JunQi Product Rail、TopBar、TabBar 和 StatusBar 连续；
3. Files authority、类型、Preview、Document 和 watcher 已共享，非 Terminal 页面不再各自维护重复事实来源；
4. Local owner 完整工作，SSH/Runtime 要么完整实现，要么明确 unavailable；
5. PTY 具备 attach、sequence、snapshot/resync 和 replacement fence；
6. Session 具备 hydration gate、原子 durability、备份和 shutdown checkpoint；
7. Worktree sleep/wake/delete 满足 ownership 和 destructive safety；
8. 旧 Task 数据完成迁移或作为只读历史保留，不再是新 authority；
9. `/terminal` 的 UI、状态、持久化和生命周期无回归；
10. MIT 归属完整；
11. 全量 TypeScript、前端、Rust、边界和跨平台验收通过；
12. 不存在临时 preview HTML、截图专用入口或 Demo route。
