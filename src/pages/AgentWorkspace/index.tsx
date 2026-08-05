import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bell,
  Crosshair,
  Code,
  FileCode,
  Files,
  FolderSimple,
  GitBranch,
  GitDiff,
  MagnifyingGlass,
  Plus,
  Robot,
  SidebarSimple,
  SplitHorizontal,
  TerminalWindow,
  User,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import {
  AGENT_WORKSPACE_SIDEBAR_TOGGLE_EVENT,
  publishAgentWorkspaceSidebarMode,
  readAgentWorkspaceSidebarMode,
} from '@/components/Layout/agentWorkspaceSidebarEvents';
import {
  WorkspaceChromeIconButton as IconButton,
  WorkspaceSidebarHeader,
} from '@/components/Layout/WorkspaceChrome';
import type { WorkspaceSidebarMode } from '@/components/Layout/workspaceSidebarChannel';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useAgentWorkspaceStore } from '@/stores/agentWorkspaceStore';
import { projectLegacyTasksToWorkbench } from '@/workbench/session/legacyTaskMigration';
import { useWorkbenchStore } from '@/workbench/store/workbenchStore';
import { resetWorkbenchSession } from '@/workbench/session/storage';
import { probeWorkbenchProviders, type WorkbenchProviderCapability } from '@/workbench/provider/providerCapabilities';
import {
  checkpointLocalEditorDocuments,
  commitLocalEditorDocumentRelease,
  releaseLocalEditorDocument,
  type LocalEditorDocumentLease,
} from '@/workspace-files/services/localEditorDocuments';
import { TabGroupLayout } from '@/workbench/components/TabGroupLayout';
import { WorkbenchTerminalPane } from '@/workbench/components/WorkbenchTerminalPane';
import { closeWorkbenchPtyTab, closeWorkbenchPtyTabs } from '@/workbench/pty/workbenchPtyClient';
import type { WorkbenchTab as DomainWorkbenchTab } from '@/workbench/domain/types';
import { FileExplorer } from '@/components/FileExplorer/FileExplorer';
import { FileViewer, type OpenFileTab } from '@/components/FileExplorer/FileViewer';
import { GitChanges, GitDiffViewer } from '@/components/Git';
import { localWorkspaceFiles } from '@/workspace-files/adapters/localWorkspaceFiles';
import type { WorkspaceFileScope, WorkspaceFileSearchEntry } from '@/workspace-files/domain/types';
import { useFocusContextStore } from '@/stores/focusContextStore';
import { ActiveTabIndicator, AnimatedTabPanel } from '@/components/shared/TabMotion';
import './workbench.css';
import { openTerminalWorkspaceDirectory } from '@/api/tauri-commands';

type WorktreeState = 'idle' | 'active' | 'unavailable';
type WorkbenchTabKind = 'terminal' | 'editor' | 'diff';
type RightPanel = 'files' | 'search' | 'source';

interface WorktreeItem {
  id: string;
  label: string;
  branch: string;
  detail: string;
  state: WorktreeState;
}

interface WorkbenchTab {
  id: string;
  label: string;
  kind: WorkbenchTabKind;
  dirty?: boolean;
}

const rightPanels: Array<{ id: RightPanel; label: string; icon: ReactNode }> = [
  { id: 'files', label: '文件', icon: <Files size={16} weight="regular" /> },
  { id: 'search', label: '搜索', icon: <MagnifyingGlass size={16} /> },
  { id: 'source', label: '源代码管理', icon: <GitBranch size={16} /> },
];

function TabIcon({ kind }: { kind: WorkbenchTabKind }) {
  if (kind === 'terminal') return <TerminalWindow size={14} />;
  if (kind === 'editor') return <FileCode size={14} />;
  return <GitDiff size={14} />;
}

function StateDot({ state }: { state: WorktreeState }) {
  return <span className={`junqi-wb-state-dot is-${state}`} aria-label={state} />;
}

function WorktreeSidebar({
  worktrees,
  activeId,
  onSelect,
  mode,
  onToggle,
  onAdd,
  onForget,
}: {
  worktrees: WorktreeItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  mode: WorkspaceSidebarMode;
  onToggle: () => void;
  onAdd: () => void;
  onForget: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (mode === 'hidden') return null;
  if (mode === 'compact') {
    return (
      <aside className="junqi-wb-sidebar junqi-wb-sidebar-collapsed">
        <WorkspaceSidebarHeader
          compact
          actions={<IconButton label={t('agentWorkspace.expandWorkspaceSidebar')} onClick={onToggle}><SidebarSimple size={17} /></IconButton>}
        />
        <div className="junqi-wb-collapsed-list">
          {worktrees.map((worktree) => (
            <button
              key={worktree.id}
              type="button"
              className={`junqi-wb-collapsed-worktree${worktree.id === activeId ? ' is-active' : ''}`}
              title={worktree.label}
              aria-label={worktree.label}
              onClick={() => onSelect(worktree.id)}
            >
              <FolderSimple size={16} weight="regular" />
            </button>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="junqi-wb-sidebar">
      <WorkspaceSidebarHeader
        eyebrow={t('agentWorkspace.workspaceEyebrow')}
        title={t('agentWorkspace.workspaceList')}
        actions={(
          <>
          <IconButton label={t('agentWorkspace.addWorkspace')} onClick={onAdd}><Plus size={15} /></IconButton>
          <IconButton label={t('agentWorkspace.collapseWorkspaceSidebar')} onClick={onToggle}><SidebarSimple size={16} /></IconButton>
          </>
        )}
      />

      <div className="junqi-wb-worktree-scroll">
        {worktrees.length === 0 ? <div className="junqi-wb-empty-panel">{t('agentWorkspace.noWorkspaces')}</div> : null}
        <div className="junqi-wb-worktree-list">
          {worktrees.map((worktree) => (
            <div
              key={worktree.id}
              className={`junqi-wb-worktree${worktree.id === activeId ? ' is-active' : ''}`}
            >
              <button
                type="button"
                className="junqi-wb-worktree-select"
                title={worktree.detail}
                onClick={() => onSelect(worktree.id)}
              >
                <FolderSimple size={15} weight="regular" />
                <span>
                  <strong>{worktree.label}</strong>
                  <small><GitBranch size={11} />{worktree.branch}</small>
                </span>
              </button>
              <IconButton
                className="junqi-wb-worktree-forget"
                label={t('agentWorkspace.forgetWorkspace', { name: worktree.label })}
                onClick={() => onForget(worktree.id)}
              >
                <X size={13} />
              </IconButton>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function WorkbenchTabBar({ tabs, activeTab, indicatorId, onSelect, onClose, onAdd, onSplit, onCloseGroup }: {
  tabs: WorkbenchTab[];
  activeTab: string;
  indicatorId: string;
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
          <div
            key={tab.id}
            role="presentation"
            className={`junqi-wb-tab${tab.id === activeTab ? ' is-active' : ''}`}
          >
            {tab.id === activeTab ? (
              <ActiveTabIndicator
                layoutId={indicatorId}
                className="junqi-wb-tab-indicator"
              />
            ) : null}
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeTab}
              className="junqi-wb-tab-select"
              onClick={() => onSelect(tab.id)}
            >
              <TabIcon kind={tab.kind} />
              <span>{tab.label}</span>
              {tab.dirty ? <span className="junqi-wb-dirty" /> : null}
            </button>
            <button
              type="button"
              className="junqi-wb-tab-close"
              aria-label={`关闭 ${tab.label}`}
              onClick={() => onClose(tab.id)}
            >
              <X size={12} />
            </button>
          </div>
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

function WorkbenchEditor({ tab, projectPath, onMissing }: {
  tab: DomainWorkbenchTab;
  projectPath: string;
  onMissing: () => void;
}) {
  const setTabDirty = useWorkbenchStore((state) => state.setTabDirty);
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
      onDirtyChange={(_, dirty) => setTabDirty(tab.id, dirty)}
      hideTabBar
      documentOwnerPrefix={tab.id}
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

function RightPanelTabs({ activePanel, onPanelChange }: {
  activePanel: RightPanel;
  onPanelChange: (panel: RightPanel) => void;
}) {
  return (
    <nav role="tablist" aria-label="工作区辅助面板">
      {rightPanels.map((panel) => (
        <button
          key={panel.id}
          type="button"
          role="tab"
          aria-selected={panel.id === activePanel}
          className={panel.id === activePanel ? 'is-active' : ''}
          aria-label={panel.label}
          title={panel.label}
          onClick={() => onPanelChange(panel.id)}
        >
          {panel.id === activePanel ? (
            <ActiveTabIndicator
              layoutId="agent-workspace-right-panel-tab"
              className="junqi-wb-right-tab-indicator"
            />
          ) : null}
          {panel.icon}
        </button>
      ))}
    </nav>
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
        <RightPanelTabs activePanel={activePanel} onPanelChange={onPanelChange} />
        <IconButton label="收起右侧栏" onClick={onToggle}><SidebarSimple size={16} /></IconButton>
      </header>
      <AnimatedTabPanel transitionKey={activePanel} className="junqi-wb-panel-transition">
        <RightPanelContent panel={activePanel} projectPath={projectPath} projectName={projectName} onFileSelect={onFileSelect} onDiffSelect={onDiffSelect} />
      </AnimatedTabPanel>
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
  const searchFiles = (query: string) => {
    const scope: WorkspaceFileScope = {
      hostId: 'local', hostRevision: 0, workspaceId: projectPath,
      rootPath: projectPath, rootRevision: 0, policy: 'workspace',
    };
    return localWorkspaceFiles.search(scope, { query, maxResults: 200 });
  };
  return (
    <div className="junqi-wb-panel-content">
      <PanelTitle>资源管理器</PanelTitle>
      <FileExplorer
        projectPath={projectPath}
        projectName={projectName}
        onFileSelect={onFileSelect}
        onSearchFiles={searchFiles}
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
      onFileSelect={onFileSelect}
      width={350}
    />
  );
}

function SearchPanel({ projectPath, onFileSelect }: {
  projectPath: string | null;
  onFileSelect: (path: string, name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WorkspaceFileSearchEntry[]>([]);
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
        setResults(response.entries);
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
        {results.map((entry) => (
          <button type="button" key={entry.path} onClick={() => onFileSelect(entry.path, entry.name)}>
            <FileCode size={13} /><span>{entry.name}</span><small>{entry.directory || 'Worktree 根目录'}</small>
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
  let content: ReactNode;
  if (!activeTab) content = <div className="junqi-wb-empty-panel">选择项目后新建 Shell，或从文件与 Git 面板打开标签</div>;
  else if (activeTab.kind === 'editor' && domainTab && projectPath) content = <WorkbenchEditor tab={domainTab} projectPath={projectPath} onMissing={onClose} />;
  else if (activeTab.kind === 'editor') content = <EditorPreview />;
  else if (activeTab.kind === 'diff' && domainTab && projectPath) content = <WorkbenchDiff tab={domainTab} projectPath={projectPath} onClose={onClose} />;
  else if (activeTab.kind === 'diff') content = <DiffPreview />;
  else if (domainTab?.kind === 'terminal' && projectPath) content = <WorkbenchTerminalPane tab={domainTab} cwd={projectPath} />;
  else content = <div className="junqi-wb-empty-panel">当前标签无法在所选本机 Worktree 中恢复</div>;

  return (
    <AnimatedTabPanel
      transitionKey={activeTab?.id ?? 'empty'}
      className="junqi-wb-pane-transition"
    >
      {content}
    </AnimatedTabPanel>
  );
}

function presentationTab(tab: DomainWorkbenchTab): WorkbenchTab {
  const kind: WorkbenchTabKind = tab.kind === 'terminal'
    ? 'terminal'
    : tab.kind === 'editor'
      ? 'editor'
      : 'diff';
  return { id: tab.id, label: tab.title, kind, dirty: tab.dirty };
}

function localWorktreePath(worktree: { hostId: string; hostRevision: number; path: string } | undefined): string | null {
  return worktree?.hostId === 'local' && worktree.hostRevision === 0 ? worktree.path : null;
}

function pathLabel(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return normalized || path;
}

export function AgentWorkspacePage() {
  const { t } = useTranslation();
  const legacyTasks = useAgentWorkspaceStore((state) => state.tasks);
  const hydrated = useWorkbenchStore((state) => state.hydrated);
  const writerReady = useWorkbenchStore((state) => state.writerReady);
  const hydrationError = useWorkbenchStore((state) => state.hydrationError);
  const worktreeRecords = useWorkbenchStore((state) => state.worktrees);
  const activeWorktree = useWorkbenchStore((state) => state.activeWorktreeId);
  const forgottenLegacyWorktreeIds = useWorkbenchStore((state) => state.forgottenLegacyWorktreeIds);
  const setWorktrees = useWorkbenchStore((state) => state.setWorktrees);
  const addWorktree = useWorkbenchStore((state) => state.addWorktree);
  const forgetStoreWorktree = useWorkbenchStore((state) => state.forgetWorktree);
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
    state: worktree.lifecycle === 'sleeping'
      ? 'idle'
      : worktree.lifecycle === 'active'
        ? 'active'
        : 'unavailable',
  })), [worktreeRecords]);
  const selectedWorktree = activeWorktree ? worktreeRecords[activeWorktree] : undefined;
  const selectedLocalPath = localWorktreePath(selectedWorktree);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [resettingSession, setResettingSession] = useState(false);
  const resetInFlightRef = useRef(false);
  const [providerCapabilities, setProviderCapabilities] = useState<WorkbenchProviderCapability[] | null>(null);
  const beginResourceTransaction = useWorkbenchStore((state) => state.beginResourceTransaction);
  const endResourceTransaction = useWorkbenchStore((state) => state.endResourceTransaction);

  useEffect(() => {
    let alive = true;
    void probeWorkbenchProviders()
      .then((capabilities) => { if (alive) setProviderCapabilities(capabilities); })
      .catch(() => { if (alive) setProviderCapabilities([]); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const migration = projectLegacyTasksToWorkbench(legacyTasks);
    const current = useWorkbenchStore.getState().worktrees;
    const forgotten = new Set(useWorkbenchStore.getState().forgottenLegacyWorktreeIds);
    const additions = migration.worktrees.filter((worktree) => !current[worktree.id] && !forgotten.has(worktree.id));
    if (additions.length > 0) setWorktrees([...Object.values(current), ...additions]);
  }, [forgottenLegacyWorktreeIds, hydrated, legacyTasks, setWorktrees]);

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
  const forgetWorktree = async (worktreeId: string) => {
    const transactionToken = beginResourceTransaction('forget-worktree');
    if (!transactionToken) return;
    const ownedTabs = Object.values(tabRecords).filter((tab) => tab.worktreeId === worktreeId);
    try {
      const documentLeases = ownedTabs.flatMap<LocalEditorDocumentLease>((tab) => {
        if (tab.kind !== 'editor' || !tab.filePath) return [];
        const localPath = localWorktreePath(worktreeRecords[tab.worktreeId]);
        return localPath ? [{ rootPath: localPath, path: tab.filePath, ownerId: `${tab.id}:${tab.filePath}` }] : [];
      });
      await checkpointLocalEditorDocuments(documentLeases);
      const identities = ownedTabs.filter((tab) => tab.kind === 'terminal').map((tab) => {
        if (!tab.ptyId || !tab.ptyRunId) throw new Error('Terminal 标签缺少 PTY identity');
        return { ptyId: tab.ptyId, runId: tab.ptyRunId };
      });
      if (identities.length > 0) await closeWorkbenchPtyTabs(identities);
      commitLocalEditorDocumentRelease(documentLeases);
      forgetStoreWorktree(worktreeId, transactionToken);
      setLifecycleError(null);
    } catch (reason) {
      setLifecycleError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      endResourceTransaction(transactionToken);
    }
  };

  const addLocalProject = async () => {
    const transactionToken = beginResourceTransaction('add-worktree');
    if (!transactionToken) return;
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: '打开本机项目' });
      if (typeof selected !== 'string' || !selected) return;
      const resolved = await openTerminalWorkspaceDirectory(selected);
      if (!resolved.path) throw new Error('无法解析所选工作区目录');
      // Release the dialog transaction before the admitted ordinary Store mutation.
      if (!endResourceTransaction(transactionToken)) return;
      const id = `workbench:local:${resolved.path}`;
      addWorktree({
        id,
        projectId: id,
        repositoryId: id,
        hostId: 'local',
        hostRevision: 0,
        path: resolved.path,
        branch: null,
        lifecycle: 'active',
      });
    } catch (reason) {
      setLifecycleError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      endResourceTransaction(transactionToken);
    }
  };

  const closeTab = async (groupId: string, id: string) => {
    const transactionToken = beginResourceTransaction('close-tab');
    if (!transactionToken) return;
    const tab = tabRecords[id];
    try {
      if (tab?.kind === 'editor' && tab.filePath) {
        const owner = worktreeRecords[tab.worktreeId];
        const localPath = localWorktreePath(owner);
        if (localPath) await releaseLocalEditorDocument(localPath, tab.filePath, `${tab.id}:${tab.filePath}`);
      }
      if (tab?.kind === 'terminal') {
        if (!tab.ptyId || !tab.ptyRunId) throw new Error('Terminal 标签缺少 PTY identity');
        await closeWorkbenchPtyTab({ ptyId: tab.ptyId, runId: tab.ptyRunId });
      }
      closeStoreTab(groupId, id, transactionToken);
      setLifecycleError(null);
    } catch (reason) {
      setLifecycleError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      endResourceTransaction(transactionToken);
    }
  };

  const closeGroup = async (groupId: string) => {
    const transactionToken = beginResourceTransaction('close-group');
    if (!transactionToken) return;
    const ownedTabs = groups[groupId]?.tabIds.map((id) => tabRecords[id]).filter(Boolean) ?? [];
    try {
      const documentLeases = ownedTabs.flatMap<LocalEditorDocumentLease>((tab) => {
        if (tab.kind !== 'editor' || !tab.filePath) return [];
        const localPath = localWorktreePath(worktreeRecords[tab.worktreeId]);
        return localPath ? [{ rootPath: localPath, path: tab.filePath, ownerId: `${tab.id}:${tab.filePath}` }] : [];
      });
      await checkpointLocalEditorDocuments(documentLeases);
      const identities = ownedTabs.filter((tab) => tab.kind === 'terminal').map((tab) => {
        if (!tab.ptyId || !tab.ptyRunId) throw new Error('Terminal 标签缺少 PTY identity');
        return { ptyId: tab.ptyId, runId: tab.ptyRunId };
      });
      if (identities.length > 0) await closeWorkbenchPtyTabs(identities);
      commitLocalEditorDocumentRelease(documentLeases);
      removeStoreGroup(groupId, transactionToken);
      setLifecycleError(null);
    } catch (reason) {
      setLifecycleError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      endResourceTransaction(transactionToken);
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
    if (!selectedLocalPath) {
      setLifecycleError(`主机 ${selectedWorktree.hostId} 尚未提供 Workbench PTY Adapter`);
      return;
    }
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

  const resetSession = async () => {
    if (resetInFlightRef.current) return;
    const transactionToken = beginResourceTransaction('reset-session');
    if (!transactionToken) return;
    resetInFlightRef.current = true;
    setResettingSession(true);
    try {
      await resetWorkbenchSession('local');
      window.location.reload();
    } catch (reason) {
      setLifecycleError(reason instanceof Error ? reason.message : String(reason));
      setResettingSession(false);
    } finally {
      resetInFlightRef.current = false;
      endResourceTransaction(transactionToken);
    }
  };

  return (
    <div className={`junqi-workbench is-sidebar-${sidebarMode}`} data-testid="junqi-ai-workbench">
      {hydrated && !writerReady ? (
        <div className="junqi-wb-storage-gate" role="alert">
          <WarningCircle size={16} />
          <span><strong>工作台会话存储不可用</strong>{hydrationError ?? '请重新启动后重试'}</span>
          <button type="button" disabled={resettingSession} onClick={() => { void resetSession(); }}>
            {resettingSession ? '正在归档…' : '归档并重置会话'}
          </button>
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
        onForget={(id) => { void forgetWorktree(id); }}
      />

      <main className="junqi-wb-main">
        <header className="junqi-wb-workspace-header">
          <div className="junqi-wb-workspace-identity">
            <StateDot state={selectedWorktree?.lifecycle === 'active' ? 'active' : selectedWorktree ? 'unavailable' : 'idle'} />
            <strong>{selectedWorktree ? pathLabel(selectedWorktree.path) : 'AI 工作台'}</strong>
            <span><GitBranch size={12} />{selectedWorktree?.branch ?? '选择项目或迁移旧任务'}</span>
          </div>
          <div className="junqi-wb-inline-actions">
            {selectedWorktree && (
              <button
                type="button"
                className="junqi-wb-header-status"
                onClick={() => useFocusContextStore.getState().setFocus({
                  schemaVersion: 1,
                  target: { kind: 'worktree', id: selectedWorktree.id },
                  title: pathLabel(selectedWorktree.path),
                  detail: selectedWorktree.branch || selectedWorktree.path,
                  route: '/ai-workspace',
                  focusedAt: Date.now(),
                })}
                title={t('focus.set')}
              >
                <Crosshair size={13} />
                {t('focus.worktree')}
              </button>
            )}
            <span className="junqi-wb-header-status">
              <Robot size={13} weight="fill" />
              {providerCapabilities === null
                ? '正在检测 Provider'
                : `${providerCapabilities.filter((provider) => provider.available).length} 个 Provider 可用`}
            </span>
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
              const targetLocalPath = localWorktreePath(targetWorktree);
              return (
                <section className={`junqi-wb-tab-group${groupId === activeGroupId ? ' is-active' : ''}`}>
                  <WorkbenchTabBar
                    tabs={targetTabs}
                    activeTab={targetActiveId ?? ''}
                    indicatorId={`agent-workspace-active-tab-${groupId}`}
                    onSelect={(id) => activateTab(groupId, id)}
                    onClose={(id) => { void closeTab(groupId, id); }}
                    onAdd={() => addTab(groupId)}
                    onSplit={() => {
                      const id = crypto.randomUUID();
                      splitStoreGroup(groupId, `workbench:group:${id}`, `workbench:split:${id}`, 'horizontal', true);
                    }}
                    onCloseGroup={Object.keys(groups).length > 1 ? () => { void closeGroup(groupId); } : undefined}
                  />
                  <div className="junqi-wb-group-content">
                    <WorkbenchContent
                      activeTab={targetActive}
                      domainTab={targetDomainTab}
                      projectPath={targetLocalPath}
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
          <span><GitDiff size={12} />Git 状态按右侧 Source 面板加载</span>
          <span className="junqi-wb-status-spacer" />
          <span><User size={12} />{selectedWorktree?.hostId ?? '未选择主机'}</span>
          <span><Code size={12} />编辑器状态以当前文件为准</span>
        </footer>
      </main>

      <RightSidebar
        activePanel={rightPanel}
        onPanelChange={(panel) => setRightPanel(panel)}
        collapsed={rightCollapsed}
        onToggle={() => setRightCollapsed(!rightCollapsed)}
        projectPath={selectedLocalPath}
        projectName={selectedWorktree ? pathLabel(selectedWorktree.path) : 'Workspace'}
        onFileSelect={openFile}
        onDiffSelect={openDiff}
      />
    </div>
  );
}
