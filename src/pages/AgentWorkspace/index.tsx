import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Pulse,
  ArrowsOutSimple,
  Bell,
  Browser,
  CaretDown,
  CaretRight,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  Code,
  Command,
  Copy,
  DotsThree,
  File,
  FileCode,
  FileText,
  Files,
  GitBranch,
  GitCommit,
  GitDiff,
  GitPullRequest,
  HardDrives,
  MagnifyingGlass,
  Monitor,
  Plus,
  Robot,
  SidebarSimple,
  Sparkle,
  SplitHorizontal,
  TerminalWindow,
  TreeStructure,
  User,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import {
  AGENT_WORKSPACE_SIDEBAR_TOGGLE_EVENT,
  publishAgentWorkspaceSidebarMode,
  readAgentWorkspaceSidebarMode,
} from '@/components/Layout/agentWorkspaceSidebarEvents';
import type { WorkspaceSidebarMode } from '@/components/Layout/workspaceSidebarChannel';
import { useAgentWorkspaceStore } from '@/stores/agentWorkspaceStore';
import { projectLegacyTasksToWorkbench } from '@/workbench/session/legacyTaskMigration';
import { useWorkbenchStore } from '@/workbench/store/workbenchStore';
import type { WorkbenchTab as DomainWorkbenchTab } from '@/workbench/domain/types';
import { FileExplorer } from '@/components/FileExplorer/FileExplorer';
import { FileViewer, type OpenFileTab } from '@/components/FileExplorer/FileViewer';
import './workbench.css';

type WorktreeState = 'running' | 'attention' | 'idle' | 'done';
type WorkbenchTabKind = 'terminal' | 'editor' | 'diff' | 'browser';
type RightPanel = 'files' | 'search' | 'source' | 'checks' | 'vault';

interface WorktreeItem {
  id: string;
  label: string;
  branch: string;
  detail: string;
  state: WorktreeState;
  agent?: string;
  unread?: number;
}

interface WorkbenchTab {
  id: string;
  label: string;
  kind: WorkbenchTabKind;
  dirty?: boolean;
}

const rightPanels: Array<{ id: RightPanel; label: string; icon: ReactNode; badge?: number }> = [
  { id: 'files', label: '文件', icon: <Files size={16} weight="regular" /> },
  { id: 'search', label: '搜索', icon: <MagnifyingGlass size={16} /> },
  { id: 'source', label: '源代码管理', icon: <GitBranch size={16} />, badge: 7 },
  { id: 'checks', label: '检查', icon: <CheckCircle size={16} /> },
  { id: 'vault', label: 'AI Vault', icon: <ClockCounterClockwise size={16} /> },
];

function TabIcon({ kind }: { kind: WorkbenchTabKind }) {
  if (kind === 'terminal') return <TerminalWindow size={14} />;
  if (kind === 'editor') return <FileCode size={14} />;
  if (kind === 'diff') return <GitDiff size={14} />;
  return <Browser size={14} />;
}

function StateDot({ state }: { state: WorktreeState }) {
  return <span className={`junqi-wb-state-dot is-${state}`} aria-label={state} />;
}

function IconButton({ label, children, active, onClick }: {
  label: string;
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`junqi-wb-icon-button${active ? ' is-active' : ''}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function WorktreeSidebar({
  worktrees,
  activeId,
  onSelect,
  mode,
  onToggle,
}: {
  worktrees: WorktreeItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  mode: WorkspaceSidebarMode;
  onToggle: () => void;
}) {
  if (mode === 'hidden') return null;
  if (mode === 'compact') {
    return (
      <aside className="junqi-wb-sidebar junqi-wb-sidebar-collapsed">
        <IconButton label="展开工作区" onClick={onToggle}><SidebarSimple size={17} /></IconButton>
        <div className="junqi-wb-collapsed-list">
          {worktrees.map((worktree) => (
            <button
              key={worktree.id}
              type="button"
              className={`junqi-wb-collapsed-worktree${worktree.id === activeId ? ' is-active' : ''}`}
              title={worktree.label}
              onClick={() => onSelect(worktree.id)}
            >
              <span>{worktree.label.slice(0, 2).toUpperCase()}</span>
              <StateDot state={worktree.state} />
            </button>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="junqi-wb-sidebar">
      <header className="junqi-wb-sidebar-header">
        <div>
          <span className="junqi-wb-kicker">AI WORKSPACE</span>
          <strong>工作区</strong>
        </div>
        <div className="junqi-wb-inline-actions">
          <IconButton label="新建工作区"><Plus size={15} /></IconButton>
          <IconButton label="收起工作区" onClick={onToggle}><SidebarSimple size={16} /></IconButton>
        </div>
      </header>

      <div className="junqi-wb-sidebar-filter">
        <MagnifyingGlass size={13} />
        <span>筛选工作区</span>
        <kbd>⌘K</kbd>
      </div>

      <div className="junqi-wb-worktree-scroll">
        <section className="junqi-wb-repo-group">
          <button type="button" className="junqi-wb-repo-heading">
            <CaretDown size={12} />
            <span className="junqi-wb-repo-mark"><TreeStructure size={13} /></span>
            <span className="junqi-wb-repo-title">本机工作区</span>
            <span className="junqi-wb-count">{worktrees.length}</span>
            <DotsThree size={15} />
          </button>

          <div className="junqi-wb-worktree-list">
            {worktrees.length === 0 ? <div className="junqi-wb-empty-panel">尚无可迁移的项目或 Worktree</div> : null}
            {worktrees.map((worktree) => (
              <button
                key={worktree.id}
                type="button"
                className={`junqi-wb-worktree${worktree.id === activeId ? ' is-active' : ''}`}
                onClick={() => onSelect(worktree.id)}
              >
                <span className="junqi-wb-worktree-rail" />
                <span className="junqi-wb-worktree-main">
                  <span className="junqi-wb-worktree-line">
                    <StateDot state={worktree.state} />
                    <strong>{worktree.label}</strong>
                    {worktree.unread ? <span className="junqi-wb-unread">{worktree.unread}</span> : null}
                  </span>
                  <span className="junqi-wb-worktree-branch"><GitBranch size={11} />{worktree.branch}</span>
                  {worktree.agent ? (
                    <span className="junqi-wb-agent-line">
                      <Robot size={12} weight="fill" />
                      <span>{worktree.agent}</span>
                      <span className={`junqi-wb-agent-status is-${worktree.state}`}>
                        {worktree.state === 'running' ? '执行中' : worktree.state === 'attention' ? '需要输入' : '空闲'}
                      </span>
                    </span>
                  ) : (
                    <span className="junqi-wb-worktree-detail">{worktree.detail}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>

      </div>

      <footer className="junqi-wb-sidebar-footer">
        <span className="junqi-wb-host-dot" />
        <span>本机</span>
        <span className="junqi-wb-muted">{worktrees.length} 个工作区</span>
        <IconButton label="主机与运行时"><HardDrives size={15} /></IconButton>
      </footer>
    </aside>
  );
}

function WorkbenchTabBar({ tabs, activeTab, onSelect, onClose, onAdd }: {
  tabs: WorkbenchTab[];
  activeTab: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="junqi-wb-tab-strip">
      <div className="junqi-wb-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeTab}
            className={`junqi-wb-tab${tab.id === activeTab ? ' is-active' : ''}`}
            onClick={() => onSelect(tab.id)}
          >
            <TabIcon kind={tab.kind} />
            <span>{tab.label}</span>
            {tab.dirty ? <span className="junqi-wb-dirty" /> : null}
            <span
              role="button"
              tabIndex={0}
              className="junqi-wb-tab-close"
              aria-label={`关闭 ${tab.label}`}
              onClick={(event) => { event.stopPropagation(); onClose(tab.id); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.stopPropagation();
                  onClose(tab.id);
                }
              }}
            >
              <X size={12} />
            </span>
          </button>
        ))}
        <IconButton label="新建标签" onClick={onAdd}><Plus size={14} /></IconButton>
      </div>
      <div className="junqi-wb-inline-actions junqi-wb-tab-actions">
        <IconButton label="拆分编辑器"><SplitHorizontal size={15} /></IconButton>
        <IconButton label="最大化组"><ArrowsOutSimple size={15} /></IconButton>
        <IconButton label="更多操作"><DotsThree size={17} /></IconButton>
      </div>
    </div>
  );
}

function AgentTerminal() {
  const [message, setMessage] = useState('');
  const [sentMessages, setSentMessages] = useState<string[]>([]);
  const send = () => {
    const value = message.trim();
    if (!value) return;
    setSentMessages((items) => [...items, value]);
    setMessage('');
  };

  return (
    <section className="junqi-wb-pane junqi-wb-terminal-pane">
      <header className="junqi-wb-pane-toolbar">
        <div className="junqi-wb-terminal-title">
          <span className="junqi-wb-state-dot is-running" />
          <strong>Claude Code</strong>
          <span className="junqi-wb-pill">Opus 4.1</span>
          <span className="junqi-wb-muted">Blues-Code/shrimp</span>
        </div>
        <div className="junqi-wb-inline-actions">
          <button type="button" className="junqi-wb-toolbar-action"><Monitor size={13} />Native Chat</button>
          <IconButton label="复制输出"><Copy size={14} /></IconButton>
          <IconButton label="终端操作"><DotsThree size={16} /></IconButton>
        </div>
      </header>

      <div className="junqi-wb-terminal-output">
        <div className="junqi-wb-command-line">
          <span className="junqi-wb-prompt">❯</span>
          <span>请审计新的 AI Workspace 前端边界，独立 Terminal 保持不变。</span>
        </div>
        <div className="junqi-wb-agent-block">
          <div className="junqi-wb-agent-block-header">
            <Sparkle size={14} weight="fill" />
            <strong>Claude</strong>
            <span>正在分析工作区结构</span>
          </div>
          <p>我会先核对路由、应用外壳和持久化 ownership，再只处理 <code>/ai-workspace</code> 的表现层。</p>
          <div className="junqi-wb-tool-call">
            <Check size={12} weight="bold" />
            <span>Read</span>
            <code>src/pages/AgentWorkspace/index.tsx</code>
            <span className="junqi-wb-muted">1,497 lines</span>
          </div>
          <div className="junqi-wb-tool-call">
            <Check size={12} weight="bold" />
            <span>Read</span>
            <code>src/components/Layout/AppLayout.tsx</code>
          </div>
          <p>现有页面是 Task-centric。新的前端骨架将改成 Worktree → Tab Group → Pane，并让 Terminal、Editor、Diff 和 Browser 成为平级标签。</p>
          <div className="junqi-wb-plan-list">
            <span><CheckCircle size={13} weight="fill" />构建 Worktree Sidebar</span>
            <span><CheckCircle size={13} weight="fill" />构建 Unified Tabs</span>
            <span className="is-running"><Pulse size={13} />绘制 Right Sidebar 与状态区域</span>
          </div>
        </div>
        {sentMessages.map((item, index) => (
          <div className="junqi-wb-command-line is-new" key={`${item}-${index}`}>
            <span className="junqi-wb-prompt">❯</span>
            <span>{item}</span>
          </div>
        ))}
      </div>

      <div className="junqi-wb-composer-shell">
        <div className="junqi-wb-composer">
          <textarea
            value={message}
            rows={2}
            placeholder="继续指示 Claude…"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
          />
          <div className="junqi-wb-composer-footer">
            <div>
              <button type="button" className="junqi-wb-composer-chip"><Plus size={13} />上下文</button>
              <button type="button" className="junqi-wb-composer-chip"><Robot size={13} />Claude Code</button>
              <button type="button" className="junqi-wb-composer-chip"><Command size={13} />Plan</button>
            </div>
            <button type="button" className="junqi-wb-send" onClick={send} disabled={!message.trim()}>
              <span>发送</span><span>↵</span>
            </button>
          </div>
        </div>
        <div className="junqi-wb-terminal-meta">
          <span>上下文 18%</span>
          <span>权限：自动编辑</span>
          <span>会话已保存</span>
        </div>
      </div>
    </section>
  );
}

function WorkbenchEditor({ tab, projectPath, onMissing }: {
  tab: DomainWorkbenchTab;
  projectPath: string;
  onMissing: () => void;
}) {
  if (!tab.filePath) return <div className="junqi-wb-empty-panel">编辑器标签缺少文件路径</div>;
  const file: OpenFileTab = { path: tab.filePath, name: pathLabel(tab.filePath) };
  return (
    <FileViewer
      tabs={[file]}
      activeFilePath={file.path}
      projectPath={projectPath}
      onSelectTab={() => undefined}
      onCloseTab={onMissing}
      onCloseOtherTabs={() => undefined}
      onCloseTabsToRight={() => undefined}
      onCloseTabsToLeft={() => undefined}
      onCloseAllTabs={onMissing}
      onFileMissing={onMissing}
      hideTabBar
    />
  );
}

function EditorPreview() {
  return (
    <section className="junqi-wb-pane junqi-wb-editor-pane">
      <header className="junqi-wb-breadcrumbs">
        <span>src</span><CaretRight size={10} /><span>pages</span><CaretRight size={10} /><span>AgentWorkspace</span><CaretRight size={10} /><strong>index.tsx</strong>
      </header>
      <div className="junqi-wb-code-editor" aria-label="代码编辑器预览">
        <ol>
          <li><span className="tok-keyword">import</span> {'{'} useState {'}'} <span className="tok-keyword">from</span> <span className="tok-string">'react'</span>;</li>
          <li><span className="tok-keyword">import</span> {'{'} WorktreeSidebar {'}'} <span className="tok-keyword">from</span> <span className="tok-string">'./WorktreeSidebar'</span>;</li>
          <li> </li>
          <li><span className="tok-keyword">export function</span> <span className="tok-fn">AgentWorkspacePage</span>() {'{'}</li>
          <li>  <span className="tok-keyword">const</span> [activeWorktree, setActiveWorktree] = <span className="tok-fn">useState</span>(<span className="tok-string">'shrimp'</span>);</li>
          <li> </li>
          <li>  <span className="tok-keyword">return</span> (</li>
          <li>    <span className="tok-tag">&lt;WorkbenchShell</span></li>
          <li>      <span className="tok-attr">worktree</span>=<span className="tok-string">{'{activeWorktree}'}</span></li>
          <li>      <span className="tok-attr">onActivate</span>=<span className="tok-string">{'{setActiveWorktree}'}</span></li>
          <li>    <span className="tok-tag">/&gt;</span></li>
          <li>  );</li>
          <li>{'}'}</li>
        </ol>
      </div>
    </section>
  );
}

function DiffPreview() {
  return (
    <section className="junqi-wb-pane">
      <header className="junqi-wb-pane-toolbar">
        <div className="junqi-wb-terminal-title"><GitDiff size={14} /><strong>Working Changes</strong><span className="junqi-wb-pill">7 files</span></div>
        <span className="junqi-wb-muted">+428 −1,126</span>
      </header>
      <div className="junqi-wb-diff-summary">
        <div className="junqi-wb-diff-file"><FileCode size={14} /><strong>src/pages/AgentWorkspace/index.tsx</strong><span className="junqi-wb-added">+286</span><span className="junqi-wb-removed">−1126</span></div>
        <pre><span className="diff-minus">- type RightPanel = 'files' | 'changes' | 'history';</span>{'\n'}<span className="diff-plus">+ type WorkbenchTabKind = 'terminal' | 'editor' | 'diff' | 'browser';</span>{'\n'}<span className="diff-plus">+ type RightPanel = 'files' | 'search' | 'source' | 'checks' | 'vault';</span></pre>
      </div>
    </section>
  );
}

function BrowserPreview() {
  return (
    <section className="junqi-wb-pane">
      <header className="junqi-wb-browser-bar">
        <button type="button">‹</button><button type="button">›</button>
        <div><span className="junqi-wb-host-dot" />localhost:1420/ai-workspace</div>
        <IconButton label="浏览器操作"><DotsThree size={16} /></IconButton>
      </header>
      <div className="junqi-wb-browser-empty"><Browser size={44} weight="thin" /><strong>Browser Pane</strong><span>Tauri Browser 后端接入后在这里显示真实页面。</span></div>
    </section>
  );
}

function RightSidebar({ activePanel, onPanelChange, collapsed, onToggle, projectPath, projectName, onFileSelect }: {
  activePanel: RightPanel;
  onPanelChange: (panel: RightPanel) => void;
  collapsed: boolean;
  onToggle: () => void;
  projectPath: string | null;
  projectName: string;
  onFileSelect: (path: string, name: string) => void;
}) {
  if (collapsed) {
    return (
      <aside className="junqi-wb-rightbar is-collapsed">
        <IconButton label="展开右侧栏" onClick={onToggle}><SidebarSimple size={17} /></IconButton>
        {rightPanels.map((panel) => (
          <IconButton key={panel.id} label={panel.label} active={panel.id === activePanel} onClick={() => { onPanelChange(panel.id); onToggle(); }}>{panel.icon}</IconButton>
        ))}
      </aside>
    );
  }

  return (
    <aside className="junqi-wb-rightbar">
      <header className="junqi-wb-right-header">
        <nav>
          {rightPanels.map((panel) => (
            <button
              key={panel.id}
              type="button"
              className={panel.id === activePanel ? 'is-active' : ''}
              aria-label={panel.label}
              title={panel.label}
              onClick={() => onPanelChange(panel.id)}
            >
              {panel.icon}
              {panel.badge ? <span>{panel.badge}</span> : null}
            </button>
          ))}
        </nav>
        <IconButton label="收起右侧栏" onClick={onToggle}><SidebarSimple size={16} /></IconButton>
      </header>
      <RightPanelContent panel={activePanel} projectPath={projectPath} projectName={projectName} onFileSelect={onFileSelect} />
    </aside>
  );
}

function RightPanelContent({ panel, projectPath, projectName, onFileSelect }: {
  panel: RightPanel;
  projectPath: string | null;
  projectName: string;
  onFileSelect: (path: string, name: string) => void;
}) {
  if (panel === 'source') return <SourceControlPanel />;
  if (panel === 'checks') return <ChecksPanel />;
  if (panel === 'vault') return <VaultPanel />;
  if (panel === 'search') return <SearchPanel />;
  return <FilesPanel projectPath={projectPath} projectName={projectName} onFileSelect={onFileSelect} />;
}

function PanelTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="junqi-wb-panel-title"><strong>{children}</strong><span>{action}</span></div>;
}

function FilesPanel({ projectPath, projectName, onFileSelect }: {
  projectPath: string | null;
  projectName: string;
  onFileSelect: (path: string, name: string) => void;
}) {
  if (!projectPath) return <div className="junqi-wb-empty-panel">选择一个本机 Worktree 后浏览文件</div>;
  return (
    <div className="junqi-wb-panel-content">
      <PanelTitle>资源管理器</PanelTitle>
      <FileExplorer
        projectPath={projectPath}
        projectName={projectName}
        onFileSelect={onFileSelect}
        width={350}
      />
    </div>
  );
}

function SourceControlPanel() {
  return (
    <div className="junqi-wb-panel-content">
      <PanelTitle action={<><IconButton label="提交"><Check size={14} /></IconButton><IconButton label="更多"><DotsThree size={16} /></IconButton></>}>源代码管理</PanelTitle>
      <div className="junqi-wb-commit-input">描述本次变更… <span>⌘↵</span></div>
      <button type="button" className="junqi-wb-primary-row"><GitCommit size={14} />提交 7 个文件</button>
      <div className="junqi-wb-change-heading"><CaretDown size={11} /><strong>更改</strong><span>7</span></div>
      {['src/pages/AgentWorkspace/index.tsx', 'src/pages/AgentWorkspace/workbench.css', 'src/AppRouteTree.tsx', 'package.json'].map((file, index) => (
        <div className="junqi-wb-change-row" key={file}><FileCode size={13} /><span title={file}>{file}</span><b className={index === 1 ? 'is-added' : ''}>{index === 1 ? 'U' : 'M'}</b></div>
      ))}
    </div>
  );
}

function ChecksPanel() {
  return (
    <div className="junqi-wb-panel-content">
      <PanelTitle action={<IconButton label="刷新检查"><Pulse size={14} /></IconButton>}>检查</PanelTitle>
      <div className="junqi-wb-review-card">
        <div><GitPullRequest size={16} /><strong>没有关联的 Pull Request</strong></div>
        <p>当前分支比 main 领先 2 个提交，可以发布并创建审阅。</p>
        <button type="button"><GitPullRequest size={13} />创建 Pull Request</button>
      </div>
      <div className="junqi-wb-check-list">
        <div><CheckCircle size={15} weight="fill" /><span><strong>Frontend tests</strong><small>1643 passed</small></span></div>
        <div><CheckCircle size={15} weight="fill" /><span><strong>Rust tests</strong><small>622 passed · 3 ignored</small></span></div>
        <div><Pulse size={15} /><span><strong>Boundary check</strong><small>正在检查模块边界</small></span></div>
      </div>
    </div>
  );
}

function VaultPanel() {
  return (
    <div className="junqi-wb-panel-content">
      <PanelTitle action={<IconButton label="刷新会话"><Pulse size={14} /></IconButton>}>AI Vault</PanelTitle>
      <div className="junqi-wb-panel-search"><MagnifyingGlass size={13} />搜索 Agent 会话</div>
      <div className="junqi-wb-vault-group">今天 <span>3</span></div>
      {[
        ['Claude', '迁移 Orca 工作台到 JunQi', '12 分钟前'],
        ['Codex', '修复 CodeMirror 午夜主题', '48 分钟前'],
        ['Pi', '审计 Gateway 静默启动', '2 小时前'],
      ].map(([agent, title, time]) => (
        <button type="button" className="junqi-wb-vault-row" key={title}>
          <span className="junqi-wb-vault-icon"><Robot size={14} /></span>
          <span><strong>{title}</strong><small>{agent} · {time}</small></span>
          <CaretRight size={12} />
        </button>
      ))}
    </div>
  );
}

function SearchPanel() {
  return (
    <div className="junqi-wb-panel-content">
      <PanelTitle>搜索</PanelTitle>
      <div className="junqi-wb-search-input"><MagnifyingGlass size={14} /><span>在 shrimp 中搜索</span></div>
      <div className="junqi-wb-search-options"><button type="button">Aa</button><button type="button">ab</button><button type="button">.*</button></div>
      <div className="junqi-wb-empty-panel"><MagnifyingGlass size={28} weight="thin" /><span>输入关键词搜索当前工作区</span></div>
    </div>
  );
}

function WorkbenchContent({ activeTab, domainTab, projectPath, onMissing }: {
  activeTab: WorkbenchTab | undefined;
  domainTab: DomainWorkbenchTab | undefined;
  projectPath: string | null;
  onMissing: () => void;
}) {
  if (!activeTab) return <div className="junqi-wb-empty-panel">选择项目后新建 Agent、文件或 Diff 标签</div>;
  if (activeTab.kind === 'editor' && domainTab && projectPath) return <WorkbenchEditor tab={domainTab} projectPath={projectPath} onMissing={onMissing} />;
  if (activeTab.kind === 'editor') return <EditorPreview />;
  if (activeTab.kind === 'diff') return <DiffPreview />;
  if (activeTab.kind === 'browser') return <BrowserPreview />;
  return <AgentTerminal />;
}

function presentationTab(tab: DomainWorkbenchTab): WorkbenchTab {
  const kind: WorkbenchTabKind = tab.kind === 'agent-terminal'
    ? 'terminal'
    : tab.kind === 'editor'
      ? 'editor'
      : tab.kind === 'browser'
        ? 'browser'
        : 'diff';
  return { id: tab.id, label: tab.title, kind, dirty: tab.dirty };
}

function pathLabel(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return normalized || path;
}

export function AgentWorkspacePage() {
  const legacyTasks = useAgentWorkspaceStore((state) => state.tasks);
  const worktreeRecords = useWorkbenchStore((state) => state.worktrees);
  const activeWorktree = useWorkbenchStore((state) => state.activeWorktreeId);
  const setWorktrees = useWorkbenchStore((state) => state.setWorktrees);
  const setActiveWorktree = useWorkbenchStore((state) => state.activateWorktree);
  const group = useWorkbenchStore((state) => state.groups[state.activeGroupId]);
  const tabRecords = useWorkbenchStore((state) => state.tabs);
  const openTab = useWorkbenchStore((state) => state.openTab);
  const activateTab = useWorkbenchStore((state) => state.activateTab);
  const closeStoreTab = useWorkbenchStore((state) => state.closeTab);
  const [rightPanel, setRightPanel] = useState<RightPanel>('files');
  const [sidebarMode, setSidebarMode] = useState<WorkspaceSidebarMode>(readAgentWorkspaceSidebarMode);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const worktrees = useMemo<WorktreeItem[]>(() => Object.values(worktreeRecords).map((worktree) => ({
    id: worktree.id,
    label: pathLabel(worktree.path),
    branch: worktree.branch ?? '分支未知',
    detail: worktree.path,
    state: worktree.lifecycle === 'sleeping' ? 'idle' : 'done',
  })), [worktreeRecords]);
  const tabs = useMemo(() => (group?.tabIds ?? []).flatMap((id) => tabRecords[id] ? [presentationTab(tabRecords[id])] : []), [group, tabRecords]);
  const activeTabId = group?.activeTabId ?? null;
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const selectedWorktree = activeWorktree ? worktreeRecords[activeWorktree] : undefined;

  useEffect(() => {
    const migration = projectLegacyTasksToWorkbench(legacyTasks);
    setWorktrees(migration.worktrees);
  }, [legacyTasks, setWorktrees]);

  useEffect(() => {
    publishAgentWorkspaceSidebarMode(sidebarMode);
  }, [sidebarMode]);

  useEffect(() => {
    const toggle = () => setSidebarMode((mode) => (
      mode === 'full' ? 'compact' : mode === 'compact' ? 'hidden' : 'full'
    ));
    window.addEventListener(AGENT_WORKSPACE_SIDEBAR_TOGGLE_EVENT, toggle);
    return () => window.removeEventListener(AGENT_WORKSPACE_SIDEBAR_TOGGLE_EVENT, toggle);
  }, []);
  const closeTab = (id: string) => {
    if (group) closeStoreTab(group.id, id);
  };

  const openFile = (path: string, name: string) => {
    if (!group) return;
    const id = `workbench:file:${path}`;
    openTab(group.id, {
      id,
      paneId: `workbench:pane:file:${path}`,
      kind: 'editor',
      title: name,
      preview: true,
      pinned: false,
      dirty: false,
      filePath: path,
    });
  };

  const addTab = () => {
    if (!group || !selectedWorktree) return;
    const id = crypto.randomUUID();
    openTab(group.id, {
      id: `workbench:tab:${id}`,
      paneId: `workbench:pane:${id}`,
      kind: 'agent-terminal',
      title: `新 Agent · ${pathLabel(selectedWorktree.path)}`,
      preview: false,
      pinned: false,
      dirty: false,
    });
  };

  return (
    <div className={`junqi-workbench is-sidebar-${sidebarMode}`} data-testid="junqi-ai-workbench">
      <WorktreeSidebar
        worktrees={worktrees}
        activeId={activeWorktree}
        onSelect={setActiveWorktree}
        mode={sidebarMode}
        onToggle={() => setSidebarMode((mode) => mode === 'full' ? 'compact' : 'full')}
      />

      <main className="junqi-wb-main">
        <header className="junqi-wb-workspace-header">
          <div className="junqi-wb-workspace-identity">
            <StateDot state={selectedWorktree ? 'done' : 'idle'} />
            <strong>{selectedWorktree ? pathLabel(selectedWorktree.path) : 'AI 工作台'}</strong>
            <span><GitBranch size={12} />{selectedWorktree?.branch ?? '选择项目或迁移旧任务'}</span>
          </div>
          <div className="junqi-wb-inline-actions">
            <span className="junqi-wb-header-status"><Robot size={13} weight="fill" />1 个 Agent 运行中</span>
            <span className="junqi-wb-header-status"><Bell size={13} />需要关注 2</span>
            <IconButton label="工作区菜单"><DotsThree size={17} /></IconButton>
          </div>
        </header>

        <WorkbenchTabBar
          tabs={tabs}
          activeTab={activeTab?.id ?? ''}
          onSelect={(id) => { if (group) activateTab(group.id, id); }}
          onClose={closeTab}
          onAdd={addTab}
        />

        <div className="junqi-wb-content">
          <WorkbenchContent
            activeTab={activeTab}
            domainTab={activeTabId ? tabRecords[activeTabId] : undefined}
            projectPath={selectedWorktree?.path ?? null}
            onMissing={() => { if (activeTabId) closeTab(activeTabId); }}
          />
        </div>

        <footer className="junqi-wb-local-status">
          <span><GitBranch size={12} />{selectedWorktree?.branch ?? '无活动分支'}</span>
          <span><GitDiff size={12} />状态待 Git Adapter 刷新</span>
          <span><WarningCircle size={12} />0</span>
          <span className="junqi-wb-status-spacer" />
          <span><User size={12} />本机</span>
          <span><Code size={12} />TypeScript React</span>
          <span>UTF-8</span>
          <span>Ln 41, Col 7</span>
        </footer>
      </main>

      <RightSidebar
        activePanel={rightPanel}
        onPanelChange={setRightPanel}
        collapsed={rightCollapsed}
        onToggle={() => setRightCollapsed((value) => !value)}
        projectPath={selectedWorktree?.path ?? null}
        projectName={selectedWorktree ? pathLabel(selectedWorktree.path) : 'Workspace'}
        onFileSelect={openFile}
      />
    </div>
  );
}
