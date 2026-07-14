import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm, open } from '@tauri-apps/plugin-dialog';
import {
  ArrowLeft,
  Bot,
  Code2,
  Eye,
  EyeOff,
  FileText,
  Files,
  FolderCog,
  GitBranch,
  GitCompareArrows,
  History,
  LayoutGrid,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  Search,
  Settings,
  Star,
  Sun,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { GitChanges, GitDiffViewer, GitHistory } from '@/components/Git';
import { FileViewer, type OpenFileTab } from '@/components/FileExplorer/FileViewer';
import { FileExplorer } from '@/components/FileExplorer';
import { ShellTerminalPanel } from '@/components/Terminal';
import { getDefaultMonoFont, type FontFamily, type TerminalFontSize, type ThemeVariant } from '@/_nezha_root/types';
import { AgentRunView } from '@/pages/AgentRunView';
import { AgentWorkspaceFileSearchDialog } from './FileSearchDialog';
import { ProjectAvatar } from './ProjectAvatar';
import { AgentWorkspaceBranchBar } from './BranchBar';
import { AgentWorkspaceProjectSettingsDialog } from './ProjectSettingsDialog';
import { AgentWorkspaceTodoTaskView } from './TodoTaskView';
import { useAgentWorkspaceStore, type AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { findWorkspaceForDirectory } from '@/workspace/projectWorkspace';
import { useTheme } from '@/theme/useTheme';
import { StatusIcon } from '@/components/shared/StatusIcon';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { UsagePopover } from '@/components/shared/UsagePopover';
import { ENABLE_USAGE_INSIGHTS } from '@/components/Terminal/_nezha-platform';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTerminalPreferences } from '@/hooks/useTerminalPreferences';
import { agentTaskNeedsAttention, compareAgentWorkspaceTasks } from './taskListModel';
import {
  readAttentionBadge,
  readTaskDisplayWindow,
  type TaskDisplayWindow,
} from '@/workspace/agentWorkspacePreferences';
import {
  AGENT_WORKSPACE_SIDEBAR_STORAGE_KEY,
  AGENT_WORKSPACE_SIDEBAR_TOGGLE_EVENT,
  publishAgentWorkspaceSidebarMode,
  readAgentWorkspaceSidebarMode,
} from '@/components/Layout/agentWorkspaceSidebarEvents';
import { nextWorkspaceSidebarMode, type WorkspaceSidebarMode } from '@/components/Layout/workspaceSidebarChannel';
import { SceneTransition } from '@/components/shared/SceneTransition';

type RightPanel = 'files' | 'changes' | 'history' | null;
type DiffTarget =
  | { mode: 'file'; filePath: string; staged: boolean; title: string }
  | { mode: 'commit'; commitHash: string; title: string }
  | { mode: 'commit-file'; commitHash: string; filePath: string; title: string };
type TaskListRow =
  | { type: 'group'; key: string; label: string }
  | { type: 'task'; key: string; task: AgentWorkspaceTask };

interface ProjectUiState {
  openDiff: DiffTarget | null;
  openFiles: OpenFileTab[];
  activeFilePath: string | null;
  rightPanel: RightPanel;
  rightPanelWidth: number;
  taskSidebarMode: WorkspaceSidebarMode;
  showShellTerminal: boolean;
  terminalHeight: number;
}

const TASK_GROUP_ROW_HEIGHT = 29;
const TASK_ROW_HEIGHT = 48;
const TASK_LIST_OVERSCAN_ROWS = 8;

function WorkspaceContentScene({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const enterX = i18n.dir() === 'rtl' ? -10 : 10;
  return (
    <motion.div
      className="absolute inset-0"
      initial={{ opacity: 0, x: enterX }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -enterX * 0.8 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
function findTaskRowIndex(offsets: number[], offset: number): number {
  if (offsets.length <= 1) return 0;

  let low = 0;
  let high = offsets.length - 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle + 1] < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function taskStatusLabel(status: AgentWorkspaceTask['status']): string {
  const labels: Record<AgentWorkspaceTask['status'], string> = {
    todo: '待开始',
    pending: '等待运行',
    running: '运行中',
    input_required: '等待输入',
    awaiting_review: '等待审阅',
    detached: '已分离',
    interrupted: '已中断',
    done: '已完成',
    failed: '失败',
    cancelled: '已取消',
  };
  return labels[status];
}

function workspacePath(workspace: { projectDirectory?: string; workingDirectory?: string } | undefined): string {
  return workspace?.projectDirectory || workspace?.workingDirectory || '';
}

export function AgentWorkspacePage() {
  const { t, i18n } = useTranslation();
  const sidebarEnterX = i18n.dir() === 'rtl' ? 8 : -8;
  const navigate = useNavigate();
  const location = useLocation();
  const resolvedTheme = useTheme();
  const themeVariant = resolvedTheme.replace('aegis-', '') as ThemeVariant;
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize) as TerminalFontSize;
  const configuredMonoFont = useSettingsStore((state) => state.monoFont);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const monoFontFamily = (configuredMonoFont || getDefaultMonoFont()) as FontFamily;
  const darkTheme = resolvedTheme === 'aegis-dark' || resolvedTheme === 'aegis-midnight';
  const { scrollback: terminalScrollback, shiftEnterNewline: terminalShiftEnterNewline } = useTerminalPreferences();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActive);
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace);
  const moveWorkspace = useWorkspaceStore((state) => state.moveWorkspace);
  const renameWorkspace = useWorkspaceStore((state) => state.renameWorkspace);
  const toggleWorkspaceHidden = useWorkspaceStore((state) => state.toggleWorkspaceHidden);
  const closeWorkspace = useWorkspaceStore((state) => state.closeWorkspace);
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  const projectPath = workspacePath(workspace);

  const tasks = useAgentWorkspaceStore((state) => state.tasks);
  const selectedTaskIds = useAgentWorkspaceStore((state) => state.selectedTaskIds);
  const selectedTaskId = selectedTaskIds[projectPath] ?? null;
  const selectProjectTask = useAgentWorkspaceStore((state) => state.selectProjectTask);
  const selectTask = useCallback((id: string | null) => selectProjectTask(projectPath, id), [projectPath, selectProjectTask]);
  const createTask = useAgentWorkspaceStore((state) => state.createTask);
  const updateTask = useAgentWorkspaceStore((state) => state.updateTask);
  const removeTask = useAgentWorkspaceStore((state) => state.removeTask);

  useEffect(() => {
    const taskId = new URLSearchParams(location.search).get('task');
    if (!taskId) return;
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    const targetWorkspace = findWorkspaceForDirectory(workspaces, task.projectPath);
    if (!targetWorkspace) return;
    setActiveWorkspace(targetWorkspace.id);
    selectProjectTask(task.projectPath, task.id);
    navigate('/ai-workspace', { replace: true });
  }, [location.search, navigate, selectProjectTask, setActiveWorkspace, tasks, workspaces]);

  const [query, setQuery] = useState('');
  const [taskDisplayWindow, setTaskDisplayWindow] = useState<TaskDisplayWindow>(readTaskDisplayWindow);
  const [attentionBadge, setAttentionBadge] = useState(readAttentionBadge);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const [autoStartTaskId, setAutoStartTaskId] = useState<string | null>(null);
  const [mountedRunTaskIds, setMountedRunTaskIds] = useState<Set<string>>(() => new Set());
  const [rightPanel, setRightPanel] = useState<RightPanel>('files');
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [taskSidebarMode, setTaskSidebarMode] = useState<WorkspaceSidebarMode>(readAgentWorkspaceSidebarMode);
  const [openDiff, setOpenDiff] = useState<DiffTarget | null>(null);
  const [openFiles, setOpenFiles] = useState<OpenFileTab[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [resizingRightPanel, setResizingRightPanel] = useState(false);
  const [showShellTerminal, setShowShellTerminal] = useState(false);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(260);
  const [resizingTerminal, setResizingTerminal] = useState(false);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [projectDrawerQuery, setProjectDrawerQuery] = useState('');
  const projectRailRef = useRef<HTMLElement>(null);
  const [draggedWorkspaceId, setDraggedWorkspaceId] = useState<string | null>(null);
  const [workspaceDropTarget, setWorkspaceDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);
  const workspaceDragCleanupRef = useRef<(() => void) | null>(null);
  const suppressWorkspaceClickRef = useRef<string | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [editingWorkspaceName, setEditingWorkspaceName] = useState('');
  const taskListRef = useRef<HTMLDivElement>(null);
  const [taskListViewportHeight, setTaskListViewportHeight] = useState(0);
  const [taskListScrollTop, setTaskListScrollTop] = useState(0);
  const projectUiStatesRef = useRef<Record<string, ProjectUiState>>({});
  const previousProjectPathRef = useRef(projectPath);

  useEffect(() => {
    if (!projectPath || workspace?.sshRemoteHost) return;
    let cancelled = false;
    void invoke('init_project_config', { projectPath }).catch((reason) => {
      if (!cancelled) setTaskActionError(`初始化项目配置失败：${String(reason)}`);
    });
    return () => { cancelled = true; };
  }, [projectPath, workspace?.sshRemoteHost]);
  const currentProjectUiRef = useRef<ProjectUiState>({
    openDiff, openFiles, activeFilePath, rightPanel, rightPanelWidth,
    taskSidebarMode, showShellTerminal, terminalHeight,
  });
  currentProjectUiRef.current = {
    openDiff, openFiles, activeFilePath, rightPanel, rightPanelWidth,
    taskSidebarMode, showShellTerminal, terminalHeight,
  };

  useEffect(() => {
    try { localStorage.setItem(AGENT_WORKSPACE_SIDEBAR_STORAGE_KEY, taskSidebarMode); } catch {}
    publishAgentWorkspaceSidebarMode(taskSidebarMode);
  }, [taskSidebarMode]);
  useEffect(() => {
    const cycleSidebar = () => setTaskSidebarMode(nextWorkspaceSidebarMode);
    window.addEventListener(AGENT_WORKSPACE_SIDEBAR_TOGGLE_EVENT, cycleSidebar);
    return () => window.removeEventListener(AGENT_WORKSPACE_SIDEBAR_TOGGLE_EVENT, cycleSidebar);
  }, []);

  const allProjectTasks = useMemo(
    () => tasks.filter((task) => task.projectPath === projectPath),
    [projectPath, tasks],
  );
  const projectTasks = useMemo(
    () => allProjectTasks.filter((task) => !task.isDraft),
    [allProjectTasks],
  );
  const activeRailWorkspaceId = workspace?.worktreeParentId ?? activeWorkspaceId;
  const railWorkspaces = useMemo(
    () => workspaces.filter((item) => !item.worktreeParentId && (!item.hiddenFromRail || item.id === activeRailWorkspaceId)),
    [activeRailWorkspaceId, workspaces],
  );
  const workspaceActivity = useCallback((item: typeof workspaces[number]) => {
    const path = workspacePath(item);
    const itemTasks = tasks.filter((task) => task.projectPath === path && !task.isDraft);
    return {
      attention: itemTasks.filter((task) => (
        task.status === 'input_required'
        || task.status === 'awaiting_review'
        || task.status === 'detached'
        || task.status === 'interrupted'
      )).length,
      running: itemTasks.some((task) => task.status === 'pending' || task.status === 'running'),
      done: itemTasks.some((task) => task.status === 'done'),
    };
  }, [tasks]);
  const visibleTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = !normalized ? projectTasks : projectTasks.filter((task) => (
      `${task.title || ''} ${task.prompt} ${task.agent}`.toLowerCase().includes(normalized)
    ));
    return [...filtered].sort(compareAgentWorkspaceTasks);
  }, [projectTasks, query]);
  const selected = allProjectTasks.find((task) => task.id === selectedTaskId) ?? null;
  const taskListRows = useMemo<TaskListRow[]>(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const cutoff = taskDisplayWindow === 'all'
      ? Number.NEGATIVE_INFINITY
      : startOfToday.getTime() - taskDisplayWindow * 24 * 60 * 60 * 1000;
    const groups: Array<{ key: string; label: string; tasks: AgentWorkspaceTask[] }> = [
      { key: 'attention', label: '需要关注', tasks: [] },
      { key: 'pending-merge', label: '待合并', tasks: [] },
      { key: 'starred', label: '已收藏', tasks: [] },
      { key: 'todo', label: '待办', tasks: [] },
      { key: 'today', label: '今天', tasks: [] },
      { key: 'earlier', label: '更早', tasks: [] },
    ];
    for (const task of visibleTasks) {
      if (agentTaskNeedsAttention(task)) {
        groups[0].tasks.push(task);
      } else if (task.status === 'done' && task.worktreePath && !task.worktreeDiscarded) {
        groups[1].tasks.push(task);
      } else if (task.starred) {
        groups[2].tasks.push(task);
      } else if (task.status === 'todo') {
        groups[3].tasks.push(task);
      } else if (task.updatedAt >= startOfToday.getTime()) {
        groups[4].tasks.push(task);
      } else if (task.updatedAt >= cutoff) {
        groups[5].tasks.push(task);
      }
    }
    return groups.flatMap((group) => group.tasks.length === 0
      ? []
      : [
        { type: 'group' as const, key: group.key, label: group.label },
        ...group.tasks.map((task) => ({ type: 'task' as const, key: task.id, task })),
      ]);
  }, [taskDisplayWindow, visibleTasks]);
  const taskListOffsets = useMemo(() => {
    const offsets = [0];
    for (const row of taskListRows) {
      offsets.push(offsets[offsets.length - 1] + (row.type === 'group' ? TASK_GROUP_ROW_HEIGHT : TASK_ROW_HEIGHT));
    }
    return offsets;
  }, [taskListRows]);
  const taskListTotalHeight = taskListOffsets[taskListOffsets.length - 1] ?? 0;
  const taskListStartIndex = Math.max(0, findTaskRowIndex(taskListOffsets, taskListScrollTop) - TASK_LIST_OVERSCAN_ROWS);
  const taskListEndIndex = Math.min(
    taskListRows.length,
    findTaskRowIndex(taskListOffsets, taskListScrollTop + taskListViewportHeight) + TASK_LIST_OVERSCAN_ROWS + 1,
  );
  const visibleTaskListRows = taskListRows.slice(taskListStartIndex, taskListEndIndex);

  useEffect(() => {
    taskListRef.current?.scrollTo({ top: 0 });
    setTaskListScrollTop(0);
  }, [taskDisplayWindow]);

  useEffect(() => {
    const reloadWorkspacePreferences = () => {
      setTaskDisplayWindow(readTaskDisplayWindow());
      setAttentionBadge(readAttentionBadge());
    };
    window.addEventListener('nezha:app-settings-changed', reloadWorkspacePreferences);
    return () => window.removeEventListener('nezha:app-settings-changed', reloadWorkspacePreferences);
  }, []);
  const selectedRunVisible = Boolean(
    selected
    && !openDiff
    && !(activeFilePath && openFiles.length > 0),
  );
  const isActiveTask = useCallback((task: AgentWorkspaceTask) => (
    task.status === 'pending'
    || task.status === 'running'
    || task.status === 'input_required'
    || task.status === 'awaiting_review'
    || task.status === 'detached'
    || task.status === 'interrupted'
  ), []);
  const deleteTasks = useCallback(async (deletingTasks: AgentWorkspaceTask[]) => {
    const deletingIds = new Set(deletingTasks.map((task) => task.id));
    for (const task of deletingTasks) {
      if (isActiveTask(task)) {
        await invoke('cancel_task', { taskId: task.id, projectPath: task.worktreePath || task.projectPath }).catch((error) => setTaskActionError(`取消任务失败：${String(error)}`));
      }
      if (task.worktreePath && task.worktreeBranch && !task.worktreeDiscarded) {
        await invoke('remove_task_worktree', {
          projectPath: task.projectPath,
          worktreePath: task.worktreePath,
          branch: task.worktreeBranch,
        }).catch((error) => setTaskActionError(String(error)));
      }
      removeTask(task.id);
    }
    setMountedRunTaskIds((current) => new Set([...current].filter((id) => !deletingIds.has(id))));
    setAutoStartTaskId((current) => current && deletingIds.has(current) ? null : current);
  }, [isActiveTask, removeTask]);
  const requestDeleteTask = useCallback(async (task: AgentWorkspaceTask) => {
    const preview = task.prompt.length > 100 ? `${task.prompt.slice(0, 100)}...` : task.prompt;
    const accepted = await confirm(`确定删除任务“${task.title || preview}”吗？`, {
      title: '删除任务',
      kind: 'warning',
    });
    if (accepted) await deleteTasks([task]);
  }, [deleteTasks]);
  const requestClearProjectTasks = useCallback(async () => {
    if (allProjectTasks.length === 0) return;
    const accepted = await confirm(`确定清空“${workspace?.name || projectPath}”中的 ${allProjectTasks.length} 个任务吗？`, {
      title: '清空任务',
      kind: 'warning',
    });
    if (accepted) await deleteTasks(allProjectTasks);
  }, [allProjectTasks, deleteTasks, projectPath, workspace?.name]);
  const requestCloseProject = useCallback(async (closingWorkspace: typeof workspaces[number]) => {
    const sourceId = closingWorkspace.worktreeParentId || closingWorkspace.id;
    const familyPaths = new Set(workspaces
      .filter((candidate) => candidate.id === sourceId || candidate.worktreeParentId === sourceId)
      .map(workspacePath));
    const relatedTasks = tasks.filter((task) => familyPaths.has(task.projectPath));
    const accepted = await confirm(relatedTasks.length
      ? t('agentWorkspace.removeProjectWithTasksConfirm', {
        name: closingWorkspace.name,
        count: relatedTasks.length,
        defaultValue: `确定从工作台移除“${closingWorkspace.name}”吗？该项目的 ${relatedTasks.length} 个任务也会删除，但不会删除本地项目目录。`,
      })
      : t('agentWorkspace.removeProjectConfirm', {
        name: closingWorkspace.name,
        defaultValue: `确定从工作台移除“${closingWorkspace.name}”吗？不会删除本地项目目录。`,
      }), {
      title: t('agentWorkspace.removeProject', '移除项目'),
      kind: 'warning',
    });
    if (!accepted) return;
    await deleteTasks(relatedTasks);
    closeWorkspace(closingWorkspace.id);
  }, [closeWorkspace, deleteTasks, t, tasks, workspaces]);
  const renderedRunTasks = useMemo(() => tasks.filter((task) => (
    (selected?.id === task.id && (task.isDraft || task.status !== 'todo'))
    || (mountedRunTaskIds.has(task.id) && isActiveTask(task))
  )), [isActiveTask, mountedRunTaskIds, selected?.id, tasks]);
  const hasAttention = projectTasks.some((task) => (
    task.status === 'input_required'
    || task.status === 'awaiting_review'
    || task.status === 'detached'
    || task.status === 'interrupted'
  ));

  useEffect(() => {
    if (!selected || !isActiveTask(selected)) return;
    setMountedRunTaskIds((current) => (
      current.has(selected.id) ? current : new Set([...current, selected.id])
    ));
  }, [isActiveTask, selected]);

  useLayoutEffect(() => {
    const element = taskListRef.current;
    if (!element) return;
    const updateViewport = () => setTaskListViewportHeight(element.clientHeight);
    updateViewport();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewport);
      return () => window.removeEventListener('resize', updateViewport);
    }
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setTaskListScrollTop(0);
    taskListRef.current?.scrollTo({ top: 0 });
  }, [projectPath, query]);

  const handleTaskListScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setTaskListScrollTop(event.currentTarget.scrollTop);
  }, []);

  useEffect(() => {
    if (!resizingRightPanel) return;
    const onMouseMove = (event: MouseEvent) => {
      setRightPanelWidth(Math.max(220, Math.min(600, window.innerWidth - event.clientX - 40)));
    };
    const onMouseUp = () => setResizingRightPanel(false);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [resizingRightPanel]);

  useEffect(() => {
    if (!resizingTerminal) return;
    const onMouseMove = (event: MouseEvent) => {
      setTerminalHeight(Math.max(140, Math.min(600, window.innerHeight - event.clientY)));
    };
    const onMouseUp = () => setResizingTerminal(false);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [resizingTerminal]);

  useEffect(() => {
    const previousPath = previousProjectPathRef.current;
    if (previousPath) projectUiStatesRef.current[previousPath] = currentProjectUiRef.current;
    const restored = projectPath ? projectUiStatesRef.current[projectPath] : undefined;
    setOpenDiff(restored?.openDiff ?? null);
    setOpenFiles(restored?.openFiles ?? []);
    setActiveFilePath(restored?.activeFilePath ?? null);
    setRightPanel(restored?.rightPanel ?? 'files');
    setRightPanelWidth(restored?.rightPanelWidth ?? 320);
    setTaskSidebarMode(restored?.taskSidebarMode ?? readAgentWorkspaceSidebarMode());
    setShowShellTerminal(restored?.showShellTerminal ?? false);
    setTerminalHeight(restored?.terminalHeight ?? 260);
    setShowFileSearch(false);
    setShowProjectSettings(false);
    setResizingTerminal(false);
    setResizingRightPanel(false);
    setTaskActionError(null);
    previousProjectPathRef.current = projectPath;
  }, [projectPath]);

  const startNewTask = useCallback(() => {
    if (!projectPath) return;
    const existingDraft = allProjectTasks.find((task) => task.isDraft);
    if (existingDraft) {
      setOpenDiff(null);
      setOpenFiles([]);
      setActiveFilePath(null);
      selectTask(existingDraft.id);
      return;
    }
    createTask({
      projectPath,
      prompt: '',
      title: '',
      agent: 'claude',
      permissionMode: 'ask',
      planMode: false,
      launchMode: 'local',
      isDraft: true,
    });
    setOpenDiff(null);
    setOpenFiles([]);
    setActiveFilePath(null);
  }, [allProjectTasks, createTask, projectPath, selectTask]);

  const commitWorkspaceRename = useCallback(() => {
    if (!editingWorkspaceId) return;
    const name = editingWorkspaceName.trim();
    if (name) renameWorkspace(editingWorkspaceId, name);
    setEditingWorkspaceId(null);
    setEditingWorkspaceName('');
  }, [editingWorkspaceId, editingWorkspaceName, renameWorkspace]);

  const openProjectWorkspace = useCallback(async () => {
    let selectedPath: string | string[] | null;
    try {
      selectedPath = await open({
        title: '选择项目文件夹',
        directory: true,
        multiple: false,
      });
    } catch {
      return;
    }
    if (typeof selectedPath !== 'string' || !selectedPath) return;
    const existing = findWorkspaceForDirectory(workspaces, selectedPath);
    if (existing) {
      setActiveWorkspace(existing.id);
      setProjectDrawerOpen(false);
      return;
    }
    const normalized = selectedPath.replace(/[\\/]+$/, '');
    const name = normalized.split(/[\\/]/).pop()?.trim() || 'Workspace';
    const created = createWorkspace(name, selectedPath);
    setActiveWorkspace(created.id);
    setProjectDrawerOpen(false);
  }, [createWorkspace, setActiveWorkspace, workspaces]);

  const showDiff = useCallback((target: DiffTarget) => {
    setOpenDiff(target);
    setTaskSidebarMode('compact');
  }, []);

  const closeDiff = useCallback(() => {
    setOpenDiff(null);
  }, []);

  const toggleRightPanel = useCallback((panel: Exclude<RightPanel, null>) => {
    setRightPanel((current) => current === panel ? null : panel);
  }, []);

  const openFile = useCallback((path: string, name: string) => {
    setOpenDiff(null);
    setOpenFiles((current) => current.some((file) => file.path === path)
      ? current
      : [...current, { path, name }]);
    setActiveFilePath(path);
  }, []);

  useEffect(() => {
    if (!projectPath) return;
    const handleFileSearchShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        const target = event.target as HTMLElement | null;
        if (target?.matches('input, textarea, [contenteditable="true"]')) return;
        event.preventDefault();
        setShowFileSearch(true);
      }
    };
    window.addEventListener('keydown', handleFileSearchShortcut);
    return () => window.removeEventListener('keydown', handleFileSearchShortcut);
  }, [projectPath]);

  const closeFile = useCallback((path: string) => {
    setOpenFiles((current) => {
      const index = current.findIndex((file) => file.path === path);
      if (index === -1) return current;
      const next = current.filter((file) => file.path !== path);
      if (activeFilePath === path) setActiveFilePath(next[Math.min(index, next.length - 1)]?.path ?? null);
      return next;
    });
  }, [activeFilePath]);

  const currentGitPath = selected?.worktreePath && !selected.worktreeDiscarded
    ? selected.worktreePath
    : projectPath;

  const backLabel = openDiff || activeFilePath
    ? t('agentWorkspace.backToTask', '返回当前任务')
    : selected
      ? t('agentWorkspace.backToTaskList', '返回任务列表')
      : null;
  const navigateBack = useCallback(() => {
    if (openDiff) {
      setOpenDiff(null);
      return;
    }
    if (activeFilePath) {
      setActiveFilePath(null);
      return;
    }
    if (selected) {
      selectTask(null);
      return;
    }
  }, [activeFilePath, openDiff, selectTask, selected]);

  const beginWorkspaceDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>, workspaceId: string) => {
    if (event.button !== 0) return;
    workspaceDragCleanupRef.current?.();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    let target: { id: string; position: 'before' | 'after' } | null = null;

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('blur', onBlur);
      setDraggedWorkspaceId(null);
      setWorkspaceDropTarget(null);
      workspaceDragCleanupRef.current = null;
    };
    const finish = (cancelled: boolean) => {
      cleanup();
      if (cancelled || !moved) return;
      if (target && target.id !== workspaceId) moveWorkspace(workspaceId, target.id, target.position);
      suppressWorkspaceClickRef.current = workspaceId;
      window.setTimeout(() => {
        if (suppressWorkspaceClickRef.current === workspaceId) suppressWorkspaceClickRef.current = null;
      }, 100);
    };
    function onMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
      moved = true;
      setDraggedWorkspaceId(workspaceId);
      const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest<HTMLElement>('[data-workspace-id]');
      const targetId = element?.dataset.workspaceId;
      if (!element || !targetId || targetId === workspaceId) {
        target = null;
        setWorkspaceDropTarget(null);
      } else {
        const bounds = element.getBoundingClientRect();
        target = { id: targetId, position: moveEvent.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' };
        setWorkspaceDropTarget(target);
      }
      moveEvent.preventDefault();
    }
    function onUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      if (moved) upEvent.preventDefault();
      finish(false);
    }
    function onCancel(cancelEvent: PointerEvent) {
      if (cancelEvent.pointerId === pointerId) finish(true);
    }
    const onBlur = () => finish(true);
    workspaceDragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('blur', onBlur);
  }, [moveWorkspace]);

  useEffect(() => () => workspaceDragCleanupRef.current?.(), []);
  useEffect(() => {
    if (!projectDrawerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (projectRailRef.current?.contains(event.target as Node)) return;
      setProjectDrawerOpen(false);
      setProjectDrawerQuery('');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [projectDrawerOpen]);

  return (
    <SceneTransition className="flex h-full min-h-0 overflow-hidden bg-aegis-bg text-aegis-text">
      <AnimatePresence initial={false}>
      {taskSidebarMode !== 'hidden' && (
      <motion.aside
        ref={projectRailRef}
        initial={{ width: 0, opacity: 0, x: sidebarEnterX }}
        animate={{ width: 48, opacity: 1, x: 0 }}
        exit={{ width: 0, opacity: 0, x: sidebarEnterX }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex shrink-0 flex-col items-center gap-1 border-r border-aegis-border bg-aegis-surface py-2"
      >
        {taskSidebarMode === 'compact' && (
          <button
            type="button"
            title={t('agentWorkspace.expandTasks', '展开任务栏')}
            onClick={() => setTaskSidebarMode('full')}
            className="relative mb-1 flex h-8 w-8 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
          >
            <PanelLeftOpen size={15} />
            {attentionBadge && hasAttention && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" />}
          </button>
        )}
        {railWorkspaces.map((item) => {
          const active = item.id === activeRailWorkspaceId;
          const activity = workspaceActivity(item);
          return (
            <button
              key={item.id}
              type="button"
              data-workspace-id={item.id}
              title={`${item.name || '工作区'}\n${workspacePath(item) || '未设置目录'}`}
              onPointerDown={(event) => beginWorkspaceDrag(event, item.id)}
              onClick={() => {
                if (suppressWorkspaceClickRef.current === item.id) return;
                setActiveWorkspace(item.id);
                setProjectDrawerOpen(false);
              }}
              className={`relative flex h-9 w-9 touch-none items-center justify-center rounded-md ${active ? 'bg-aegis-primary/15 ring-1 ring-inset ring-aegis-primary/35' : 'hover:bg-aegis-hover'} ${draggedWorkspaceId === item.id ? 'opacity-30' : ''} ${workspaceDropTarget?.id === item.id ? workspaceDropTarget.position === 'before' ? 'before:absolute before:-top-0.5 before:h-0.5 before:w-8 before:bg-aegis-primary' : 'after:absolute after:-bottom-0.5 after:h-0.5 after:w-8 after:bg-aegis-primary' : ''}`}
            >
              <ProjectAvatar name={item.name || 'Workspace'} size={28} />
              {attentionBadge && activity.attention > 0 ? (
                <span className="absolute -right-1 -top-1 min-w-3 rounded-full border border-aegis-surface bg-amber-400 px-0.5 text-center text-[8px] leading-3 text-black">
                  {activity.attention > 9 ? '9+' : activity.attention}
                </span>
              ) : activity.running || activity.done ? (
                <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-aegis-surface ${activity.running ? 'bg-emerald-400' : 'bg-aegis-text-dim'}`} />
              ) : null}
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          type="button"
          title="看板"
          onClick={() => navigate('/kanban')}
          className="flex h-8 w-8 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
        >
          <LayoutGrid size={15} />
        </button>
        <button
          type="button"
          title={t('agentWorkspace.projectManager', '项目管理')}
          onClick={() => setProjectDrawerOpen((open) => !open)}
          className={`flex h-8 w-8 items-center justify-center rounded ${projectDrawerOpen ? 'bg-aegis-primary/15 text-aegis-primary' : 'text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text'}`}
        >
          <FolderCog size={15} />
        </button>
        <button
          type="button"
          title={t('agentWorkspace.openProject', '添加项目')}
          onClick={() => void openProjectWorkspace()}
          className="flex h-8 w-8 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
        >
          <Plus size={15} />
        </button>

        {projectDrawerOpen && (
          <div className="absolute bottom-2 left-12 top-0 z-50 flex w-80 flex-col border-r border-aegis-border bg-aegis-surface shadow-xl">
            <div className="border-b border-aegis-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-aegis-text">{t('agentWorkspace.projectManager', '项目管理')}</div>
                  <div className="mt-0.5 text-[10px] text-aegis-text-dim">
                    {t('agentWorkspace.projectManagerHint', '重命名、固定或移除工作台项目；不会修改本地目录。')}
                  </div>
                </div>
                <button
                  type="button"
                  title={t('agentWorkspace.openProject', '添加项目')}
                  onClick={() => void openProjectWorkspace()}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-aegis-primary text-white hover:brightness-110"
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-aegis-border bg-aegis-bg px-2 py-1.5">
                <Search size={13} className="text-aegis-text-dim" />
                <input
                  autoFocus
                  value={projectDrawerQuery}
                  onChange={(event) => setProjectDrawerQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setProjectDrawerOpen(false);
                  }}
                  placeholder={t('agentWorkspace.searchProjects', '搜索项目')}
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-aegis-text-dim"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {workspaces.filter((item) => {
                const needle = projectDrawerQuery.trim().toLowerCase();
                return !needle || `${item.name} ${workspacePath(item)}`.toLowerCase().includes(needle);
              }).map((item) => {
                const active = item.id === activeWorkspaceId;
                const activity = workspaceActivity(item);
                return (
                  <div key={item.id} className={`group flex items-center gap-2 rounded px-2 py-2 ${active ? 'bg-aegis-primary/10' : 'hover:bg-aegis-hover'}`}>
                    {editingWorkspaceId === item.id ? (
                      <div className="min-w-0 flex-1">
                        <input
                          autoFocus
                          value={editingWorkspaceName}
                          onChange={(event) => setEditingWorkspaceName(event.target.value)}
                          onBlur={commitWorkspaceRename}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') commitWorkspaceRename();
                            if (event.key === 'Escape') {
                              setEditingWorkspaceId(null);
                              setEditingWorkspaceName('');
                            }
                          }}
                          className="h-6 w-full rounded border border-aegis-primary bg-aegis-bg px-1.5 text-xs outline-none"
                        />
                        <span className="block truncate pt-1 font-mono text-[10px] text-aegis-text-dim">{workspacePath(item) || '未设置目录'}</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveWorkspace(item.id);
                          setProjectDrawerOpen(false);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="flex items-center gap-2">
                          <ProjectAvatar name={item.name || 'Workspace'} size={24} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{item.name || '工作区'}</span>
                            <span className="block truncate font-mono text-[10px] text-aegis-text-dim">{workspacePath(item) || '未设置目录'}</span>
                          </span>
                          {item.hiddenFromRail && <span className="rounded bg-aegis-hover px-1.5 py-0.5 text-[9px] text-aegis-text-dim">已隐藏</span>}
                          {attentionBadge && activity.attention > 0 && <span className="rounded bg-amber-400/20 px-1 text-[10px] text-amber-500">{activity.attention}</span>}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      title={t('agentWorkspace.renameProject', '重命名项目')}
                      onClick={() => {
                        setEditingWorkspaceId(item.id);
                        setEditingWorkspaceName(item.name);
                      }}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-bg hover:text-aegis-text"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      title={item.hiddenFromRail
                        ? t('agentWorkspace.pinProject', '固定到项目栏')
                        : t('agentWorkspace.hideProject', '从项目栏隐藏')}
                      onClick={() => toggleWorkspaceHidden(item.id)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-bg hover:text-aegis-text"
                    >
                      {item.hiddenFromRail ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                    <button
                      type="button"
                      title={t('agentWorkspace.removeProject', '移除项目')}
                      onClick={() => void requestCloseProject(item)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-aegis-text-dim hover:bg-red-500/10 hover:text-red-400"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </motion.aside>
      )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
      {taskSidebarMode === 'full' && (
        <motion.aside
          initial={{ width: 0, opacity: 0, x: sidebarEnterX }}
          animate={{ width: 276, opacity: 1, x: 0 }}
          exit={{ width: 0, opacity: 0, x: sidebarEnterX }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="flex shrink-0 flex-col overflow-hidden border-r border-aegis-border bg-aegis-surface"
        >
          <div className="flex h-12 items-center gap-2 border-b border-aegis-border px-3">
            <Bot size={16} className="text-aegis-primary" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{workspace?.name || 'AI 工作台'}</span>
            <button
              type="button"
              title={t('agentWorkspace.collapseTasks', '收起任务栏')}
              onClick={() => setTaskSidebarMode('compact')}
              className="flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
            >
              <PanelLeftClose size={15} />
            </button>
          </div>
          <div className="truncate border-b border-aegis-border px-3 py-2 font-mono text-[11px] text-aegis-text-dim">
            {projectPath || '请先在终端中打开一个项目工作区'}
          </div>
          <div className="m-3 flex items-center gap-2 rounded-md border border-aegis-border bg-aegis-bg px-2 py-1.5">
            <Search size={13} className="text-aegis-text-dim" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索任务"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-aegis-text-dim"
            />
          </div>
          {projectPath && <AgentWorkspaceBranchBar projectPath={currentGitPath} active />}
          <button
            type="button"
            onClick={startNewTask}
            className="mx-3 flex h-9 items-center justify-center gap-2 rounded-md bg-aegis-primary text-xs font-semibold text-white"
          >
            <Plus size={14} />新建任务
          </button>
          <div className="mt-3 flex items-center border-y border-aegis-border px-3 py-2 text-[11px] text-aegis-text-dim">
            <span className="flex-1">{projectTasks.length} 个任务</span>
            {projectTasks.length > 0 && (
              <button
                type="button"
                title="清空此项目任务"
                onClick={() => void requestClearProjectTasks()}
                className="flex h-6 items-center gap-1 rounded px-1.5 hover:bg-aegis-hover hover:text-aegis-text"
              >
                <Trash2 size={12} />清空
              </button>
            )}
          </div>
          {taskActionError && (
            <div className="border-b border-red-500/20 px-3 py-2 text-[11px] text-red-400" role="status">
              {taskActionError}
            </div>
          )}
          <div
            ref={taskListRef}
            onScroll={handleTaskListScroll}
            className="min-h-0 flex-1 overflow-y-auto py-1"
          >
            {taskListRows.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-aegis-text-dim">还没有任务</div>
            )}
            <div className="relative" style={{ height: taskListTotalHeight }}>
              {visibleTaskListRows.map((row, visibleIndex) => {
                const rowIndex = taskListStartIndex + visibleIndex;
                const top = taskListOffsets[rowIndex] ?? 0;
                if (row.type === 'group') {
                  return (
                    <div
                      key={row.key}
                      className="absolute left-0 right-0 px-3 pb-1 pt-3 text-[10px] font-semibold text-aegis-text-dim"
                      style={{ top, height: TASK_GROUP_ROW_HEIGHT }}
                    >
                      {row.label}
                    </div>
                  );
                }
                const task = row.task;
                return (
                  <div
                    key={task.id}
                    className={`group absolute left-0 right-0 flex items-start px-1 py-1 hover:bg-aegis-hover/50 ${selected?.id === task.id ? 'bg-aegis-primary/10' : ''}`}
                    style={{ top, height: TASK_ROW_HEIGHT }}
                  >
                  <button
                    type="button"
                    onClick={() => {
                      setOpenDiff(null);
                      setOpenFiles([]);
                      setActiveFilePath(null);
                      selectTask(task.id);
                    }}
                    className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1 text-left"
                  >
                    <span className="mt-0.5 shrink-0"><StatusIcon status={task.status} size={13} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{task.title || task.prompt}</span>
                      <span className="flex min-w-0 items-center gap-1 pt-0.5 text-[10px] text-aegis-text-dim">
                        <span>{taskStatusLabel(task.status)}</span>
                        {task.status === 'done' && task.additions !== undefined && task.deletions !== undefined && (
                          <span className="flex items-center gap-1 font-mono font-semibold">
                            <span className="text-emerald-500">+{task.additions}</span>
                            <span className="text-red-400">-{task.deletions}</span>
                          </span>
                        )}
                        {task.worktreeBranch && !task.worktreeDiscarded && (
                          <span className="flex min-w-0 items-center gap-0.5 truncate"><GitBranch size={9} />{task.worktreeBranch}</span>
                        )}
                      </span>
                    </span>
                    <span title={task.agent === 'codex' ? 'Codex' : 'Claude Code'} className="shrink-0 text-aegis-text-dim transition-opacity group-hover:opacity-0">
                      {task.agent === 'codex' ? <Code2 size={12} /> : <Bot size={12} />}
                    </span>
                  </button>
                <div className="flex shrink-0 items-center gap-0.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    title={task.starred ? '取消收藏' : '收藏任务'}
                    onClick={() => updateTask(task.id, { starred: !task.starred })}
                    className={`flex h-6 w-6 items-center justify-center rounded hover:bg-aegis-hover ${task.starred ? 'text-amber-400' : 'text-aegis-text-dim'}`}
                  >
                    <Star size={12} fill={task.starred ? 'currentColor' : 'none'} />
                  </button>
                  {task.status === 'todo' && (
                    <button
                      type="button"
                      title="立即运行"
                      onClick={() => {
                        setOpenDiff(null);
                        setOpenFiles([]);
                        setActiveFilePath(null);
                        setAutoStartTaskId(task.id);
                        setMountedRunTaskIds((current) => new Set([...current, task.id]));
                        updateTask(task.id, { status: 'pending' });
                        selectTask(task.id);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded text-aegis-primary hover:bg-aegis-hover"
                    >
                      <Play size={11} fill="currentColor" />
                    </button>
                  )}
                  <button
                    type="button"
                    title="删除任务"
                    onClick={() => void requestDeleteTask(task)}
                    className="flex h-6 w-6 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-red-400"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                  </div>
                );
              })}
            </div>
          </div>
          <footer className="flex h-10 shrink-0 items-center justify-end gap-1 border-t border-aegis-border px-2">
            <NotificationBell />
            <button type="button" title={t('terminalSettings.title', '终端设置')} onClick={() => navigate('/settings?tab=terminal')} className="flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"><Settings size={14} /></button>
            <button type="button" title={darkTheme ? '切换到浅色主题' : '切换到深色主题'} onClick={() => setTheme(darkTheme ? 'aegis-light' : 'aegis-dark')} className="flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text">{darkTheme ? <Sun size={14} /> : <Moon size={14} />}</button>
            {ENABLE_USAGE_INSIGHTS && <UsagePopover />}
          </footer>
        </motion.aside>
      )}
      </AnimatePresence>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-aegis-border px-4">
          <div className="flex min-w-0 items-center gap-2 text-xs text-aegis-text-dim">
            {taskSidebarMode === 'hidden' && (
              <button
                type="button"
                title={t('agentWorkspace.expandSidebar', '展开工作台侧栏')}
                onClick={() => setTaskSidebarMode('full')}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
              >
                <PanelLeftOpen size={15} />
              </button>
            )}
            {backLabel && (
              <>
                <button
                  type="button"
                  title={backLabel}
                  aria-label={backLabel}
                  onClick={navigateBack}
                  className="flex h-7 shrink-0 items-center gap-1 rounded px-1.5 text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
                >
                  <ArrowLeft size={14} />
                  <span className="hidden text-[11px] sm:inline">{backLabel}</span>
                </button>
                <span className="h-4 w-px shrink-0 bg-aegis-border" />
              </>
            )}
            <GitBranch size={14} className="shrink-0" />
            <span className="truncate">{workspace?.name || '项目工作台'}</span>
            {openDiff && <span className="truncate text-aegis-text">/ {openDiff.title}</span>}
          </div>
          <span />
        </header>

        <div className="relative min-h-0 flex-1">
          <ErrorBoundary fallbackMessage="任务内容加载失败，请重试。">
          <AnimatePresence initial={false} mode="wait">
          {openDiff ? (
            <WorkspaceContentScene key={`diff:${openDiff.mode}:${openDiff.title}`}>
              <GitDiffViewer
                projectPath={currentGitPath}
                mode={openDiff.mode}
                commitHash={'commitHash' in openDiff ? openDiff.commitHash : undefined}
                filePath={'filePath' in openDiff ? openDiff.filePath : undefined}
                staged={openDiff.mode === 'file' ? openDiff.staged : undefined}
                title={openDiff.title}
                onClose={closeDiff}
              />
            </WorkspaceContentScene>
          ) : activeFilePath && openFiles.length > 0 ? (
            <WorkspaceContentScene key={`file:${activeFilePath}`}>
              <FileViewer
                tabs={openFiles}
                activeFilePath={activeFilePath}
                projectPath={projectPath}
                themeVariant={themeVariant}
                onSelectTab={setActiveFilePath}
                onCloseTab={closeFile}
                onCloseOtherTabs={(path) => {
                  setOpenFiles((current) => current.filter((file) => file.path === path));
                  setActiveFilePath(path);
                }}
                onCloseTabsToRight={(path) => {
                  setOpenFiles((current) => {
                    const index = current.findIndex((file) => file.path === path);
                    const next = index >= 0 ? current.slice(0, index + 1) : current;
                    if (!next.some((file) => file.path === activeFilePath)) setActiveFilePath(path);
                    return next;
                  });
                }}
                onCloseTabsToLeft={(path) => {
                  setOpenFiles((current) => {
                    const index = current.findIndex((file) => file.path === path);
                    const next = index >= 0 ? current.slice(index) : current;
                    if (!next.some((file) => file.path === activeFilePath)) setActiveFilePath(path);
                    return next;
                  });
                }}
                onCloseAllTabs={() => {
                  setOpenFiles([]);
                  setActiveFilePath(null);
                }}
              />
            </WorkspaceContentScene>
          ) : !projectPath ? (
            <WorkspaceContentScene key="no-project">
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <FileText size={28} className="text-aegis-text-dim" />
                <p className="text-sm text-aegis-text-dim">请先在终端工作台创建或选择一个本地项目工作区。</p>
                <button
                  type="button"
                  onClick={() => navigate('/terminal')}
                  className="rounded bg-aegis-primary px-3 py-2 text-xs font-semibold text-white"
                >
                  打开终端工作台
                </button>
              </div>
            </WorkspaceContentScene>
          ) : !selected ? (
            <WorkspaceContentScene key={`task-list:${projectPath}`}>
              <section className="flex h-full items-center justify-center px-8" aria-label={t('agentWorkspace.noTaskSelected', '未选择任务')}>
                <div className="flex max-w-sm flex-col items-center text-center text-aegis-text-dim">
                  <Bot size={24} strokeWidth={1.5} className="mb-3 opacity-45" />
                  <p className="text-xs font-medium text-aegis-text-secondary">
                    {t('agentWorkspace.noTaskSelected', '未选择任务')}
                  </p>
                  <p className="mt-1 text-[11px] leading-5">
                    {t('agentWorkspace.noTaskSelectedHint', '从左侧任务列表打开一项，或使用“新建任务”。')}
                  </p>
                </div>
              </section>
            </WorkspaceContentScene>
          ) : selected.status === 'todo' && !selected.isDraft ? (
            <WorkspaceContentScene key={`todo:${selected.id}`}>
              <AgentWorkspaceTodoTaskView
                task={selected}
                onUpdate={(patch) => updateTask(selected.id, patch)}
                onRun={() => {
                  setAutoStartTaskId(selected.id);
                  setMountedRunTaskIds((current) => new Set([...current, selected.id]));
                  updateTask(selected.id, { status: 'pending' });
                }}
              />
            </WorkspaceContentScene>
          ) : null}
          </AnimatePresence>

          {renderedRunTasks.map((task) => (
            <motion.div
              key={task.id}
              className={selected?.id === task.id && selectedRunVisible ? 'absolute inset-0' : 'hidden'}
              initial={false}
              animate={selected?.id === task.id && selectedRunVisible ? { opacity: 1, x: 0 } : { opacity: 0, x: 10 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <AgentRunView
                taskId={task.id}
                initialTitle={task.title}
                projectPath={task.projectPath}
                agent={task.agent === 'codex' || task.agent === 'pi' ? task.agent : 'claude'}
                prompt={task.prompt}
                permissionMode={task.permissionMode}
                initialStatus={task.status}
                initialSessionPath={task.sessionPath}
                initialSessionId={task.agent === 'codex' ? task.codexSessionId : task.agent === 'claude' ? task.claudeSessionId : undefined}
                initialWorktreePath={task.worktreePath}
                initialWorktreeBranch={task.worktreeBranch}
                initialWorktreeDiscarded={task.worktreeDiscarded}
                initialBaseBranch={task.baseBranch}
                initialPlanMode={task.planMode}
                initialLaunchMode={task.launchMode}
                initialIsDraft={task.isDraft}
                autoStart={autoStartTaskId === task.id}
                onTaskStarted={() => setAutoStartTaskId((current) => current === task.id ? null : current)}
                onOpenWorktreeTerminal={() => setShowShellTerminal(true)}
                terminalScrollback={terminalScrollback}
                terminalFontSize={terminalFontSize}
                monoFontFamily={monoFontFamily}
                themeVariant={themeVariant}
                visible={selected?.id === task.id && selectedRunVisible}
              />
            </motion.div>
          ))}
          </ErrorBoundary>
        </div>
        {showShellTerminal && projectPath && (
          <div className="relative shrink-0 border-t border-aegis-border" style={{ height: terminalHeight }}>
            <button
              type="button"
              title="拖动调整终端高度"
              aria-label="拖动调整终端高度"
              onMouseDown={() => setResizingTerminal(true)}
              className="absolute -top-1 left-0 z-20 h-2 w-full cursor-row-resize bg-transparent"
            />
            <ShellTerminalPanel
              key={`agent-workspace-shell:${workspace?.id ?? projectPath}`}
              projectPath={currentGitPath}
              projectId={`agent-workspace:${workspace?.id ?? 'default'}`}
              onClose={() => setShowShellTerminal(false)}
              themeVariant={themeVariant}
              terminalFontSize={terminalFontSize}
              terminalScrollback={terminalScrollback}
              terminalShiftEnterNewline={terminalShiftEnterNewline}
              monoFontFamily={monoFontFamily}
              height={terminalHeight}
            />
          </div>
        )}
      </main>

      {projectPath && rightPanel && (
        <aside className="relative flex shrink-0 border-l border-aegis-border bg-aegis-surface" style={{ width: rightPanelWidth }}>
          <button
            type="button"
            title="拖动调整侧栏宽度"
            aria-label="拖动调整侧栏宽度"
            onMouseDown={() => setResizingRightPanel(true)}
            className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize bg-transparent"
          />
          {rightPanel === 'files' && (
            <ErrorBoundary fallbackMessage="文件浏览器加载失败。">
              <FileExplorer
                projectPath={projectPath}
                projectName={workspace?.name || 'Project'}
                onFileSelect={openFile}
                active
                width={rightPanelWidth}
              />
            </ErrorBoundary>
          )}
          {rightPanel === 'changes' && (
            <ErrorBoundary fallbackMessage="Git 变更面板加载失败。">
              <GitChanges
                projectPath={currentGitPath}
                currentTaskCreatedAt={selected?.createdAt ?? null}
                onFileSelect={(filePath, staged, title) => showDiff({ mode: 'file', filePath, staged, title })}
                width={rightPanelWidth}
              />
            </ErrorBoundary>
          )}
          {rightPanel === 'history' && (
            <ErrorBoundary fallbackMessage="Git 历史面板加载失败。">
              <GitHistory
                projectPath={currentGitPath}
                onCommitSelect={(commitHash, title) => showDiff({ mode: 'commit', commitHash, title })}
                onFileClick={(commitHash, filePath, title) => showDiff({ mode: 'commit-file', commitHash, filePath, title })}
                width={rightPanelWidth}
              />
            </ErrorBoundary>
          )}
        </aside>
      )}

      <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-aegis-border bg-aegis-surface py-2">
        <button
          type="button"
          title="文件"
          onClick={() => toggleRightPanel('files')}
          className={`flex h-8 w-8 items-center justify-center rounded ${rightPanel === 'files' ? 'bg-aegis-primary/15 text-aegis-primary' : 'text-aegis-text-dim hover:bg-aegis-hover'}`}
        >
          <Files size={15} />
        </button>
        <button
          type="button"
          title="Git 变更"
          onClick={() => toggleRightPanel('changes')}
          className={`flex h-8 w-8 items-center justify-center rounded ${rightPanel === 'changes' ? 'bg-aegis-primary/15 text-aegis-primary' : 'text-aegis-text-dim hover:bg-aegis-hover'}`}
        >
          <GitCompareArrows size={15} />
        </button>
        <button
          type="button"
          title="提交历史"
          onClick={() => toggleRightPanel('history')}
          className={`flex h-8 w-8 items-center justify-center rounded ${rightPanel === 'history' ? 'bg-aegis-primary/15 text-aegis-primary' : 'text-aegis-text-dim hover:bg-aegis-hover'}`}
        >
          <History size={15} />
        </button>
        <button
          type="button"
          title={showShellTerminal ? '关闭终端' : '打开终端'}
          onClick={() => setShowShellTerminal((visible) => !visible)}
          className={`flex h-8 w-8 items-center justify-center rounded ${showShellTerminal ? 'bg-aegis-primary/15 text-aegis-primary' : 'text-aegis-text-dim hover:bg-aegis-hover'}`}
        >
          <TerminalSquare size={15} />
        </button>
        <div className="my-1 h-px w-5 bg-aegis-border" />
        <button
          type="button"
          disabled={!projectPath}
          title="搜索文件 (Cmd/Ctrl+P)"
          onClick={() => setShowFileSearch(true)}
          className="flex h-8 w-8 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Search size={15} />
        </button>
        <span className="flex-1" />
        <button
          type="button"
          title="设置"
          onClick={() => setShowProjectSettings(true)}
          className="flex h-8 w-8 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
        >
          <Settings size={15} />
        </button>
      </nav>

      {showFileSearch && projectPath && (
        <AgentWorkspaceFileSearchDialog
          projectPath={projectPath}
          onFileOpen={openFile}
          onClose={() => setShowFileSearch(false)}
        />
      )}
      {showProjectSettings && projectPath && (
        <AgentWorkspaceProjectSettingsDialog
          projectPath={projectPath}
          onClose={() => setShowProjectSettings(false)}
        />
      )}
    </SceneTransition>
  );
}
