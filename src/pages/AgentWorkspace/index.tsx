import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bell,
  Browser,
  CaretDown,
  CheckCircle,
  ClockCounterClockwise,
  Code,
  DotsThree,
  FileCode,
  Files,
  GitBranch,
  GitDiff,
  MagnifyingGlass,
  Plus,
  Robot,
  SidebarSimple,
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
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useAgentWorkspaceStore } from '@/stores/agentWorkspaceStore';
import { projectLegacyTasksToWorkbench } from '@/workbench/session/legacyTaskMigration';
import { useWorkbenchStore } from '@/workbench/store/workbenchStore';
import { TabGroupLayout } from '@/workbench/components/TabGroupLayout';
import { WorkbenchTerminalPane } from '@/workbench/components/WorkbenchTerminalPane';
import { closeWorkbenchPtyTab, closeWorkbenchPtyTabs } from '@/workbench/pty/workbenchPtyClient';
import type { WorkbenchTab as DomainWorkbenchTab } from '@/workbench/domain/types';
import { FileExplorer } from '@/components/FileExplorer/FileExplorer';
import { FileViewer, type OpenFileTab } from '@/components/FileExplorer/FileViewer';
import { GitChanges, GitDiffViewer } from '@/components/Git';
import { localWorkspaceFiles } from '@/workspace-files/adapters/localWorkspaceFiles';
import type { WorkspaceFileScope } from '@/workspace-files/domain/types';
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
  onAdd,
}: {
  worktrees: WorktreeItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  mode: WorkspaceSidebarMode;
  onToggle: () => void;
  onAdd: () => void;
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
          <IconButton label="打开本机项目" onClick={onAdd}><Plus size={15} /></IconButton>
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
      </footer>
    </aside>
  );
}

function WorkbenchTabBar({ tabs, activeTab, onSelect, onClose, onAdd, onSplit, onCloseGroup }: {
  tabs: WorkbenchTab[];
  activeTab: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  onSplit: () => void;
  onCloseGroup?: () => void;
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
        <IconButton label="拆分编辑器" onClick={onSplit}><SplitHorizontal size={15} /></IconButton>
        {onCloseGroup ? <IconButton label="关闭分组" onClick={onCloseGroup}><X size={14} /></IconButton> : null}
      </div>
    </div>
  );
}

function AgentTerminal() {
  return (
    <section className="junqi-wb-pane junqi-wb-terminal-pane">
      <div className="junqi-wb-browser-empty">
        <TerminalWindow size={44} weight="thin" />
        <strong>Agent Provider 未连接</strong>
        <span>Workbench PTY 已可用；Provider claim、会话恢复和 Agent 状态解析完成后才能启动 Agent。</span>
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
  return <div className="junqi-wb-empty-panel">编辑器标签不可用：文件路径缺失</div>;
}

function WorkbenchDiff({ tab, projectPath, onClose }: { tab: DomainWorkbenchTab; projectPath: string; onClose: () => void }) {
  if (!tab.filePath) return <div className="junqi-wb-empty-panel">Diff 标签缺少文件路径</div>;
  return (
    <GitDiffViewer
      projectPath={projectPath}
      mode="file"
      filePath={tab.filePath}
      staged={tab.diffStaged === true}
      title={tab.title}
      onClose={onClose}
    />
  );
}

function DiffPreview() {
  return <div className="junqi-wb-empty-panel">Diff 标签不可用：文件路径缺失</div>;
}

function BrowserPreview() {
  return (
    <div className="junqi-wb-empty-panel">
      <Browser size={28} weight="thin" />
      <strong>Browser Pane 不可用</strong>
      <span>Tauri 隔离浏览器后端尚未实现；当前不会创建模拟页面或本机文件权限。</span>
    </div>
  );
}

function RightSidebar({ activePanel, onPanelChange, collapsed, onToggle, projectPath, projectName, onFileSelect, onDiffSelect }: {
  activePanel: RightPanel;
  onPanelChange: (panel: RightPanel) => void;
  collapsed: boolean;
  onToggle: () => void;
  projectPath: string | null;
  projectName: string;
  onFileSelect: (path: string, name: string) => void;
  onDiffSelect: (path: string, staged: boolean, label: string) => void;
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
      <RightPanelContent panel={activePanel} projectPath={projectPath} projectName={projectName} onFileSelect={onFileSelect} onDiffSelect={onDiffSelect} />
    </aside>
  );
}

function RightPanelContent({ panel, projectPath, projectName, onFileSelect, onDiffSelect }: {
  panel: RightPanel;
  projectPath: string | null;
  projectName: string;
  onFileSelect: (path: string, name: string) => void;
  onDiffSelect: (path: string, staged: boolean, label: string) => void;
}) {
  if (panel === 'source') return <SourceControlPanel projectPath={projectPath} onFileSelect={onDiffSelect} />;
  if (panel === 'checks') return <ChecksPanel />;
  if (panel === 'vault') return <VaultPanel />;
  if (panel === 'search') return <SearchPanel projectPath={projectPath} onFileSelect={onFileSelect} />;
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

function SourceControlPanel({ projectPath, onFileSelect }: {
  projectPath: string | null;
  onFileSelect: (path: string, staged: boolean, label: string) => void;
}) {
  if (!projectPath) return <div className="junqi-wb-empty-panel">选择本机 Worktree 后查看源代码管理</div>;
  return (
    <GitChanges
      projectPath={projectPath}
      currentTaskCreatedAt={null}
      onFileSelect={onFileSelect}
      width={350}
    />
  );
}

function ChecksPanel() {
  return <div className="junqi-wb-empty-panel">Checks 与 Hosted Review Adapter 尚未连接</div>;
}

function VaultPanel() {
  return <div className="junqi-wb-empty-panel">AI Vault Host-local scanner 尚未连接</div>;
}

function SearchPanel({ projectPath, onFileSelect }: {
  projectPath: string | null;
  onFileSelect: (path: string, name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    setResults([]);
    setStatus('idle');
  }, [projectPath]);

  useEffect(() => {
    const value = query.trim();
    if (!projectPath || !value) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const generation = ++generationRef.current;
    const timer = setTimeout(() => {
      const scope: WorkspaceFileScope = {
        hostId: 'local', hostRevision: 0, workspaceId: projectPath,
        rootPath: projectPath, rootRevision: 0, policy: 'workspace',
      };
      setStatus('loading');
      void localWorkspaceFiles.search(scope, { query: value, maxResults: 200 }).then((response) => {
        if (generation !== generationRef.current) return;
        setResults(response.paths);
        setStatus('idle');
      }).catch(() => {
        if (generation !== generationRef.current) return;
        setResults([]);
        setStatus('error');
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [projectPath, query]);

  return (
    <div className="junqi-wb-panel-content">
      <PanelTitle>搜索</PanelTitle>
      <label className="junqi-wb-search-input">
        <MagnifyingGlass size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="在当前 Worktree 中搜索文件" />
      </label>
      {!projectPath ? <div className="junqi-wb-empty-panel">选择本机 Worktree 后搜索</div> : null}
      {projectPath && status === 'loading' ? <div className="junqi-wb-empty-panel">正在搜索…</div> : null}
      {status === 'error' ? <div className="junqi-wb-empty-panel">搜索不可用</div> : null}
      {projectPath && status === 'idle' && query.trim() && results.length === 0 ? <div className="junqi-wb-empty-panel">没有匹配文件</div> : null}
      <div className="junqi-wb-search-results">
        {results.map((path) => (
          <button type="button" key={path} onClick={() => onFileSelect(path, pathLabel(path))}>
            <FileCode size={13} /><span>{pathLabel(path)}</span><small>{path}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkbenchContent({ activeTab, domainTab, projectPath, onClose }: {
  activeTab: WorkbenchTab | undefined;
  domainTab: DomainWorkbenchTab | undefined;
  projectPath: string | null;
  onClose: () => void;
}) {
  if (!activeTab) return <div className="junqi-wb-empty-panel">选择项目后新建 Shell，或从文件与 Git 面板打开标签</div>;
  if (activeTab.kind === 'editor' && domainTab && projectPath) return <WorkbenchEditor tab={domainTab} projectPath={projectPath} onMissing={onClose} />;
  if (activeTab.kind === 'editor') return <EditorPreview />;
  if (activeTab.kind === 'diff' && domainTab && projectPath) return <WorkbenchDiff tab={domainTab} projectPath={projectPath} onClose={onClose} />;
  if (activeTab.kind === 'diff') return <DiffPreview />;
  if (activeTab.kind === 'browser') return <BrowserPreview />;
  if (domainTab?.kind === 'terminal' && projectPath) return <WorkbenchTerminalPane tab={domainTab} cwd={projectPath} />;
  return <AgentTerminal />;
}

function presentationTab(tab: DomainWorkbenchTab): WorkbenchTab {
  const kind: WorkbenchTabKind = tab.kind === 'agent-terminal' || tab.kind === 'terminal'
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
  const hydrated = useWorkbenchStore((state) => state.hydrated);
  const writerReady = useWorkbenchStore((state) => state.writerReady);
  const hydrationError = useWorkbenchStore((state) => state.hydrationError);
  const worktreeRecords = useWorkbenchStore((state) => state.worktrees);
  const activeWorktree = useWorkbenchStore((state) => state.activeWorktreeId);
  const setWorktrees = useWorkbenchStore((state) => state.setWorktrees);
  const addWorktree = useWorkbenchStore((state) => state.addWorktree);
  const setActiveWorktree = useWorkbenchStore((state) => state.activateWorktree);
  const groups = useWorkbenchStore((state) => state.groups);
  const layout = useWorkbenchStore((state) => state.layout);
  const activeGroupId = useWorkbenchStore((state) => state.activeGroupId);
  const group = groups[activeGroupId];
  const tabRecords = useWorkbenchStore((state) => state.tabs);
  const openTab = useWorkbenchStore((state) => state.openTab);
  const activateTab = useWorkbenchStore((state) => state.activateTab);
  const closeStoreTab = useWorkbenchStore((state) => state.closeTab);
  const splitStoreGroup = useWorkbenchStore((state) => state.splitGroup);
  const resizeStoreSplit = useWorkbenchStore((state) => state.resizeSplit);
  const removeStoreGroup = useWorkbenchStore((state) => state.removeGroup);
  const rightPanel = useWorkbenchStore((state) => state.rightSidebarPanel as RightPanel);
  const setRightPanel = useWorkbenchStore((state) => state.setRightSidebarPanel);
  const sidebarMode = useWorkbenchStore((state) => state.sidebarMode);
  const setSidebarMode = useWorkbenchStore((state) => state.setSidebarMode);
  const rightCollapsed = useWorkbenchStore((state) => state.rightSidebarCollapsed);
  const setRightCollapsed = useWorkbenchStore((state) => state.setRightSidebarCollapsed);
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
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    const migration = projectLegacyTasksToWorkbench(legacyTasks);
    const current = useWorkbenchStore.getState().worktrees;
    const additions = migration.worktrees.filter((worktree) => !current[worktree.id]);
    if (additions.length > 0) setWorktrees([...Object.values(current), ...additions]);
  }, [hydrated, legacyTasks, setWorktrees]);

  useEffect(() => {
    const persisted = readAgentWorkspaceSidebarMode();
    if (!useWorkbenchStore.getState().hydrated) setSidebarMode(persisted);
  }, [setSidebarMode]);

  useEffect(() => {
    publishAgentWorkspaceSidebarMode(sidebarMode);
  }, [sidebarMode]);

  useEffect(() => {
    const toggle = () => {
      const mode = useWorkbenchStore.getState().sidebarMode;
      setSidebarMode(mode === 'full' ? 'compact' : mode === 'compact' ? 'hidden' : 'full');
    };
    window.addEventListener(AGENT_WORKSPACE_SIDEBAR_TOGGLE_EVENT, toggle);
    return () => window.removeEventListener(AGENT_WORKSPACE_SIDEBAR_TOGGLE_EVENT, toggle);
  }, []);
  const addLocalProject = async () => {
    const selected = await openDialog({ directory: true, multiple: false, title: '打开本机项目' });
    if (typeof selected !== 'string' || !selected) return;
    const id = `workbench:local:${selected}`;
    addWorktree({
      id,
      projectId: id,
      repositoryId: id,
      hostId: 'local',
      hostRevision: 0,
      path: selected,
      branch: null,
      lifecycle: 'active',
    });
  };

  const closeTab = async (groupId: string, id: string) => {
    const tab = tabRecords[id];
    try {
      if (tab?.kind === 'terminal') {
        if (!tab.ptyId || !tab.ptyRunId) throw new Error('Terminal 标签缺少 PTY identity');
        await closeWorkbenchPtyTab({ ptyId: tab.ptyId, runId: tab.ptyRunId });
      }
      closeStoreTab(groupId, id);
      setLifecycleError(null);
    } catch (reason) {
      setLifecycleError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const closeGroup = async (groupId: string) => {
    const ownedTabs = groups[groupId]?.tabIds.map((id) => tabRecords[id]).filter(Boolean) ?? [];
    try {
      const identities = ownedTabs.filter((tab) => tab.kind === 'terminal').map((tab) => {
        if (!tab.ptyId || !tab.ptyRunId) throw new Error('Terminal 标签缺少 PTY identity');
        return { ptyId: tab.ptyId, runId: tab.ptyRunId };
      });
      if (identities.length > 0) await closeWorkbenchPtyTabs(identities);
      removeStoreGroup(groupId);
      setLifecycleError(null);
    } catch (reason) {
      setLifecycleError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const openFile = (path: string, name: string) => {
    if (!group || !selectedWorktree) return;
    const id = `workbench:file:${path}`;
    openTab(group.id, {
      id,
      worktreeId: selectedWorktree.id,
      paneId: `workbench:pane:file:${path}`,
      kind: 'editor',
      title: name,
      preview: true,
      pinned: false,
      dirty: false,
      filePath: path,
    });
  };

  const openDiff = (path: string, staged: boolean, label: string) => {
    if (!group || !selectedWorktree) return;
    const id = `workbench:diff:${staged ? 'staged' : 'working'}:${path}`;
    openTab(group.id, {
      id,
      worktreeId: selectedWorktree.id,
      paneId: `workbench:pane:${id}`,
      kind: 'diff',
      title: label,
      preview: true,
      pinned: false,
      dirty: false,
      filePath: path,
      diffStaged: staged,
    });
  };

  const addTab = (groupId: string) => {
    if (!groups[groupId] || !selectedWorktree) return;
    const id = crypto.randomUUID();
    openTab(groupId, {
      id: `workbench:tab:${id}`,
      worktreeId: selectedWorktree.id,
      paneId: `workbench:pane:${id}`,
      kind: 'terminal',
      title: `Shell · ${pathLabel(selectedWorktree.path)}`,
      preview: false,
      pinned: false,
      dirty: false,
      ptyId: `workbench:pty:${id}`,
      ptyRunId: `workbench:run:${crypto.randomUUID()}`,
      ptyCreatePending: true,
    });
  };

  return (
    <div className={`junqi-workbench is-sidebar-${sidebarMode}`} data-testid="junqi-ai-workbench">
      {hydrated && !writerReady ? (
        <div className="junqi-wb-storage-gate" role="alert">
          <WarningCircle size={16} />
          <span><strong>工作台会话存储不可用</strong>{hydrationError ?? '请重新启动后重试'}</span>
        </div>
      ) : lifecycleError ? (
        <div className="junqi-wb-storage-gate" role="alert">
          <WarningCircle size={16} />
          <span><strong>无法关闭工作台资源</strong>{lifecycleError}</span>
        </div>
      ) : null}
      <WorktreeSidebar
        worktrees={worktrees}
        activeId={activeWorktree}
        onSelect={setActiveWorktree}
        mode={sidebarMode}
        onToggle={() => setSidebarMode(sidebarMode === 'full' ? 'compact' : 'full')}
        onAdd={() => { void addLocalProject(); }}
      />

      <main className="junqi-wb-main">
        <header className="junqi-wb-workspace-header">
          <div className="junqi-wb-workspace-identity">
            <StateDot state={selectedWorktree ? 'done' : 'idle'} />
            <strong>{selectedWorktree ? pathLabel(selectedWorktree.path) : 'AI 工作台'}</strong>
            <span><GitBranch size={12} />{selectedWorktree?.branch ?? '选择项目或迁移旧任务'}</span>
          </div>
          <div className="junqi-wb-inline-actions">
            <span className="junqi-wb-header-status"><Robot size={13} weight="fill" />Agent Provider 未连接</span>
            <span className="junqi-wb-header-status"><Bell size={13} />本机 Shell PTY 可用</span>
          </div>
        </header>

        <div className="junqi-wb-content">
          <TabGroupLayout
            node={layout}
            onResize={resizeStoreSplit}
            renderGroup={(groupId) => {
              const targetGroup = groups[groupId];
              const targetTabs = (targetGroup?.tabIds ?? []).flatMap((id) => tabRecords[id] ? [presentationTab(tabRecords[id])] : []);
              const targetActiveId = targetGroup?.activeTabId ?? null;
              const targetActive = targetTabs.find((tab) => tab.id === targetActiveId);
              const targetDomainTab = targetActiveId ? tabRecords[targetActiveId] : undefined;
              const targetWorktree = targetDomainTab ? worktreeRecords[targetDomainTab.worktreeId] : undefined;
              return (
                <section className={`junqi-wb-tab-group${groupId === activeGroupId ? ' is-active' : ''}`}>
                  <WorkbenchTabBar
                    tabs={targetTabs}
                    activeTab={targetActiveId ?? ''}
                    onSelect={(id) => activateTab(groupId, id)}
                    onClose={(id) => { void closeTab(groupId, id); }}
                    onAdd={() => addTab(groupId)}
                    onSplit={() => {
                      const id = crypto.randomUUID();
                      splitStoreGroup(groupId, `workbench:group:${id}`, `workbench:split:${id}`, 'horizontal');
                    }}
                    onCloseGroup={Object.keys(groups).length > 1 ? () => { void closeGroup(groupId); } : undefined}
                  />
                  <div className="junqi-wb-group-content">
                    <WorkbenchContent
                      activeTab={targetActive}
                      domainTab={targetDomainTab}
                      projectPath={targetWorktree?.path ?? null}
                      onClose={() => { if (targetActiveId) void closeTab(groupId, targetActiveId); }}
                    />
                  </div>
                </section>
              );
            }}
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
        onPanelChange={(panel) => setRightPanel(panel)}
        collapsed={rightCollapsed}
        onToggle={() => setRightCollapsed(!rightCollapsed)}
        projectPath={selectedWorktree?.path ?? null}
        projectName={selectedWorktree ? pathLabel(selectedWorktree.path) : 'Workspace'}
        onFileSelect={openFile}
        onDiffSelect={openDiff}
      />
    </div>
  );
}
