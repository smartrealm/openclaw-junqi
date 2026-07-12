import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Bot,
  CircleDot,
  Check,
  ChevronDown,
  FileText,
  Files,
  GitBranch,
  GitCompareArrows,
  GripVertical,
  History,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Star,
  TerminalSquare,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { GitChanges, GitDiffViewer, GitHistory } from '@/components/Git';
import { FileViewer, type OpenFileTab } from '@/components/FileExplorer/FileViewer';
import { ShellTerminalPanel } from '@/components/Terminal';
import { TerminalWorkspaceFiles } from '@/components/Terminal/TerminalWorkspaceFiles';
import { DEFAULT_TERMINAL_FONT_SIZE, getDefaultMonoFont, type FontFamily, type TerminalFontSize, type ThemeVariant } from '@/_nezha_root/types';
import { AgentRunView } from '@/pages/AgentRunView';
import { SessionViewPage } from '@/pages/SessionViewPage';
import { AgentWorkspaceFileSearchDialog } from './FileSearchDialog';
import { useAgentWorkspaceStore, type AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { findWorkspaceForDirectory } from '@/workspace/projectWorkspace';
import { useTheme } from '@/theme/useTheme';

type RightPanel = 'files' | 'changes' | 'history' | null;
type DiffTarget =
  | { mode: 'file'; filePath: string; staged: boolean; title: string }
  | { mode: 'commit'; commitHash: string; title: string }
  | { mode: 'commit-file'; commitHash: string; filePath: string; title: string };
type TaskListRow =
  | { type: 'group'; key: string; label: string }
  | { type: 'task'; key: string; task: AgentWorkspaceTask };

const TASK_GROUP_ROW_HEIGHT = 29;
const TASK_ROW_HEIGHT = 48;
const TASK_LIST_OVERSCAN_ROWS = 8;
const TASK_DISPLAY_WINDOWS = [3, 7, 15, 30, 'all'] as const;
type TaskDisplayWindow = typeof TASK_DISPLAY_WINDOWS[number];

function readTaskDisplayWindow(): TaskDisplayWindow {
  try {
    const value = localStorage.getItem('junqi:agent-workspace:task-display-window');
    if (value === 'all') return 'all';
    const days = Number(value);
    return TASK_DISPLAY_WINDOWS.includes(days as TaskDisplayWindow) ? days as TaskDisplayWindow : 3;
  } catch {
    return 3;
  }
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

const statusColor: Record<AgentWorkspaceTask['status'], string> = {
  todo: 'rgb(var(--aegis-text-dim))',
  pending: 'rgb(var(--aegis-primary))',
  running: 'rgb(34 197 94)',
  input_required: 'rgb(245 158 11)',
  awaiting_review: 'rgb(245 158 11)',
  detached: 'rgb(245 158 11)',
  interrupted: 'rgb(239 68 68)',
  done: 'rgb(34 197 94)',
  failed: 'rgb(239 68 68)',
  cancelled: 'rgb(var(--aegis-text-dim))',
};

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
  const navigate = useNavigate();
  const resolvedTheme = useTheme();
  const themeVariant = resolvedTheme.replace('aegis-', '') as ThemeVariant;
  const terminalFontSize = DEFAULT_TERMINAL_FONT_SIZE as TerminalFontSize;
  const monoFontFamily = getDefaultMonoFont() as FontFamily;
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActive);
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace);
  const moveWorkspace = useWorkspaceStore((state) => state.moveWorkspace);
  const renameWorkspace = useWorkspaceStore((state) => state.renameWorkspace);
  const closeWorkspace = useWorkspaceStore((state) => state.closeWorkspace);
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  const projectPath = workspacePath(workspace);

  const tasks = useAgentWorkspaceStore((state) => state.tasks);
  const selectedTaskId = useAgentWorkspaceStore((state) => state.selectedTaskId);
  const selectTask = useAgentWorkspaceStore((state) => state.selectTask);
  const createTask = useAgentWorkspaceStore((state) => state.createTask);
  const updateTask = useAgentWorkspaceStore((state) => state.updateTask);
  const removeTask = useAgentWorkspaceStore((state) => state.removeTask);
  const clearProjectTasks = useAgentWorkspaceStore((state) => state.clearProjectTasks);

  const [query, setQuery] = useState('');
  const [taskDisplayWindow, setTaskDisplayWindow] = useState<TaskDisplayWindow>(readTaskDisplayWindow);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState('');
  const [generatingTaskId, setGeneratingTaskId] = useState<string | null>(null);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const [rerunTaskId, setRerunTaskId] = useState<string | null>(null);
  const [mountedRunTaskIds, setMountedRunTaskIds] = useState<Set<string>>(() => new Set());
  const [rightPanel, setRightPanel] = useState<RightPanel>('files');
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [taskPanelCollapsed, setTaskPanelCollapsed] = useState(false);
  const [openDiff, setOpenDiff] = useState<DiffTarget | null>(null);
  const [openFiles, setOpenFiles] = useState<OpenFileTab[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [resizingRightPanel, setResizingRightPanel] = useState(false);
  const [showShellTerminal, setShowShellTerminal] = useState(false);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(260);
  const [resizingTerminal, setResizingTerminal] = useState(false);
  const [currentBranch, setCurrentBranch] = useState('');
  const [branches, setBranches] = useState<{ name: string; current: boolean; remote: string | null }[]>([]);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [branchBusy, setBranchBusy] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [projectDrawerQuery, setProjectDrawerQuery] = useState('');
  const [draggedWorkspaceId, setDraggedWorkspaceId] = useState<string | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [editingWorkspaceName, setEditingWorkspaceName] = useState('');
  const branchRequestRef = useRef(0);
  const taskListRef = useRef<HTMLDivElement>(null);
  const [taskListViewportHeight, setTaskListViewportHeight] = useState(0);
  const [taskListScrollTop, setTaskListScrollTop] = useState(0);

  const allProjectTasks = useMemo(
    () => tasks.filter((task) => task.projectPath === projectPath),
    [projectPath, tasks],
  );
  const projectTasks = useMemo(
    () => allProjectTasks.filter((task) => !task.isDraft),
    [allProjectTasks],
  );
  const railWorkspaces = useMemo(
    () => workspaces.filter((item) => !item.worktreeParentId),
    [workspaces],
  );
  const activeRailWorkspaceId = workspace?.worktreeParentId ?? activeWorkspaceId;
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
      running: itemTasks.some((task) => task.status === 'running'),
      done: itemTasks.some((task) => task.status === 'done'),
    };
  }, [tasks]);
  const visibleTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = !normalized ? projectTasks : projectTasks.filter((task) => (
      `${task.title || ''} ${task.prompt} ${task.agent}`.toLowerCase().includes(normalized)
    ));
    const priority = (task: AgentWorkspaceTask) => {
      if (task.status === 'input_required' || task.status === 'awaiting_review' || task.status === 'detached' || task.status === 'interrupted') return 0;
      if (task.status === 'done' && task.worktreePath && !task.worktreeDiscarded) return 1;
      if (task.starred) return 2;
      if (task.status === 'todo') return 3;
      return 4;
    };
    return [...filtered].sort((left, right) => {
      const priorityDelta = priority(left) - priority(right);
      return priorityDelta || right.updatedAt - left.updatedAt;
    });
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
      if (task.status === 'input_required' || task.status === 'awaiting_review' || task.status === 'detached' || task.status === 'interrupted') {
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
    try {
      localStorage.setItem('junqi:agent-workspace:task-display-window', String(taskDisplayWindow));
    } catch { /* local persistence is best effort */ }
    taskListRef.current?.scrollTo({ top: 0 });
    setTaskListScrollTop(0);
  }, [taskDisplayWindow]);
  const selectedShowsHistory = Boolean(
    selected?.sessionPath
    && ['done', 'failed', 'cancelled'].includes(selected.status)
    && rerunTaskId !== selected.id,
  );
  const selectedRunVisible = Boolean(
    selected
    && !selectedShowsHistory
    && !openDiff
    && !(activeFilePath && openFiles.length > 0),
  );
  const isActiveTask = useCallback((task: AgentWorkspaceTask) => (
    task.status === 'running'
    || task.status === 'input_required'
    || task.status === 'awaiting_review'
    || task.status === 'detached'
    || task.status === 'interrupted'
  ), []);
  const renderedRunTasks = useMemo(() => tasks.filter((task) => (
    (selected?.id === task.id && !selectedShowsHistory)
    || (mountedRunTaskIds.has(task.id) && isActiveTask(task))
  )), [isActiveTask, mountedRunTaskIds, selected?.id, selectedShowsHistory, tasks]);
  const hasAttention = projectTasks.some((task) => (
    task.status === 'input_required'
    || task.status === 'awaiting_review'
    || task.status === 'detached'
    || task.status === 'interrupted'
  ));

  useEffect(() => {
    if (!selected || rerunTaskId !== selected.id) return;
    if (selected.status === 'done' || selected.status === 'failed' || selected.status === 'cancelled') {
      setRerunTaskId(null);
    }
  }, [rerunTaskId, selected]);

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
    setOpenDiff(null);
    setOpenFiles([]);
    setActiveFilePath(null);
    setRerunTaskId(null);
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

  const commitTaskRename = useCallback(() => {
    if (!editingTaskId) return;
    const title = editingTaskTitle.trim();
    if (title) updateTask(editingTaskId, { title });
    setEditingTaskId(null);
    setEditingTaskTitle('');
  }, [editingTaskId, editingTaskTitle, updateTask]);

  const generateTaskTitle = useCallback(async (task: AgentWorkspaceTask) => {
    if (generatingTaskId || (task.agent !== 'claude' && task.agent !== 'codex')) return;
    setGeneratingTaskId(task.id);
    setTaskActionError(null);
    try {
      const title = await invoke<string>('generate_task_name', {
        projectPath: task.projectPath,
        agent: task.agent,
        originalPrompt: task.prompt,
      });
      if (title.trim()) updateTask(task.id, { title: title.trim() });
    } catch (reason) {
      setTaskActionError(`生成任务名称失败：${String(reason)}`);
    } finally {
      setGeneratingTaskId(null);
    }
  }, [generatingTaskId, updateTask]);

  const showDiff = useCallback((target: DiffTarget) => {
    setOpenDiff(target);
    setTaskPanelCollapsed(true);
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
      const next = current.filter((file) => file.path !== path);
      if (activeFilePath === path) setActiveFilePath(next[index - 1]?.path ?? next[index]?.path ?? null);
      return next;
    });
  }, [activeFilePath]);

  const currentGitPath = selected?.worktreePath && !selected.worktreeDiscarded
    ? selected.worktreePath
    : projectPath;

  const refreshBranches = useCallback(async () => {
    const requestId = ++branchRequestRef.current;
    if (!currentGitPath) {
      setCurrentBranch('');
      setBranches([]);
      return;
    }
    try {
      const nextBranches = await invoke<{ name: string; current: boolean; remote: string | null }[]>('git_list_branches', { projectPath: currentGitPath });
      if (requestId !== branchRequestRef.current) return;
      setBranches(nextBranches);
      setCurrentBranch(nextBranches.find((branch) => branch.current)?.name ?? '');
    } catch {
      if (requestId !== branchRequestRef.current) return;
      setCurrentBranch('');
      setBranches([]);
    }
  }, [currentGitPath]);

  useEffect(() => {
    if (!currentGitPath) {
      branchRequestRef.current += 1;
      setCurrentBranch('');
      return;
    }
    void refreshBranches();
    return undefined;
  }, [currentGitPath, refreshBranches]);

  const checkoutBranch = useCallback(async (branch: { name: string; current: boolean; remote: string | null }) => {
    if (!currentGitPath || branch.current || branchBusy) return;
    setBranchBusy(true);
    setBranchError(null);
    try {
      await invoke('git_checkout_branch', {
        projectPath: currentGitPath,
        branchName: branch.name,
        isRemote: Boolean(branch.remote),
      });
      await refreshBranches();
      setBranchPickerOpen(false);
      setBranchQuery('');
    } catch (reason) {
      setBranchError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBranchBusy(false);
    }
  }, [branchBusy, currentGitPath, refreshBranches]);

  const createAndCheckoutBranch = useCallback(async () => {
    const branchName = newBranchName.trim();
    if (!currentGitPath || !branchName || branchBusy) return;
    setBranchBusy(true);
    setBranchError(null);
    try {
      await invoke('git_create_branch', {
        projectPath: currentGitPath,
        branchName,
        fromBranch: currentBranch || 'HEAD',
        checkout: true,
      });
      await refreshBranches();
      setNewBranchName('');
      setBranchPickerOpen(false);
      setBranchQuery('');
    } catch (reason) {
      setBranchError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBranchBusy(false);
    }
  }, [branchBusy, currentBranch, currentGitPath, newBranchName, refreshBranches]);

  const filteredBranches = useMemo(() => {
    const normalized = branchQuery.trim().toLowerCase();
    return normalized
      ? branches.filter((branch) => branch.name.toLowerCase().includes(normalized))
      : branches;
  }, [branchQuery, branches]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-aegis-bg text-aegis-text">
      <aside className="relative flex w-12 shrink-0 flex-col items-center gap-1 border-r border-aegis-border bg-aegis-surface py-2">
        <button
          type="button"
          title="终端工作台"
          onClick={() => navigate('/terminal')}
          className="mb-2 flex h-8 w-8 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
        >
          <TerminalSquare size={16} />
        </button>
        {railWorkspaces.map((item) => {
          const active = item.id === activeRailWorkspaceId;
          const label = (item.name || 'W').trim().slice(0, 1).toUpperCase();
          const activity = workspaceActivity(item);
          return (
            <button
              key={item.id}
              type="button"
              title={`${item.name || '工作区'}\n${workspacePath(item) || '未设置目录'}`}
              draggable
              onDragStart={(event) => {
                setDraggedWorkspaceId(item.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('application/x-junqi-workspace', item.id);
              }}
              onDragEnd={() => setDraggedWorkspaceId(null)}
              onDragOver={(event) => {
                if (!draggedWorkspaceId || draggedWorkspaceId === item.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                const source = event.dataTransfer.getData('application/x-junqi-workspace') || draggedWorkspaceId;
                if (source && source !== item.id) moveWorkspace(source, item.id, 'before');
                setDraggedWorkspaceId(null);
              }}
              onClick={() => {
                setActiveWorkspace(item.id);
                setProjectDrawerOpen(false);
              }}
              className={`relative flex h-8 w-8 items-center justify-center rounded text-[11px] font-semibold ${active ? 'bg-aegis-primary text-white' : 'text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text'} ${draggedWorkspaceId === item.id ? 'opacity-30' : ''}`}
            >
              {label}
              {activity.attention > 0 ? (
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
          title="所有项目"
          onClick={() => setProjectDrawerOpen((open) => !open)}
          className={`flex h-8 w-8 items-center justify-center rounded ${projectDrawerOpen ? 'bg-aegis-primary/15 text-aegis-primary' : 'text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text'}`}
        >
          <GripVertical size={15} />
        </button>
        <button
          type="button"
          title="打开项目"
          onClick={() => void openProjectWorkspace()}
          className="flex h-8 w-8 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
        >
          <Plus size={15} />
        </button>

        {projectDrawerOpen && (
          <div className="absolute bottom-2 left-12 top-0 z-50 flex w-64 flex-col border-r border-aegis-border bg-aegis-surface shadow-xl">
            <div className="border-b border-aegis-border p-3">
              <div className="mb-2 text-[10px] font-semibold text-aegis-text-dim">所有项目</div>
              <div className="flex items-center gap-2 rounded-md border border-aegis-border bg-aegis-bg px-2 py-1.5">
                <Search size={13} className="text-aegis-text-dim" />
                <input
                  autoFocus
                  value={projectDrawerQuery}
                  onChange={(event) => setProjectDrawerQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setProjectDrawerOpen(false);
                  }}
                  placeholder="搜索项目"
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
                          <span className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-semibold ${active ? 'bg-aegis-primary text-white' : 'bg-aegis-bg text-aegis-text-dim'}`}>{(item.name || 'W').slice(0, 1).toUpperCase()}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{item.name || '工作区'}</span>
                            <span className="block truncate font-mono text-[10px] text-aegis-text-dim">{workspacePath(item) || '未设置目录'}</span>
                          </span>
                          {activity.attention > 0 && <span className="rounded bg-amber-400/20 px-1 text-[10px] text-amber-500">{activity.attention}</span>}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      title="重命名项目"
                      onClick={() => {
                        setEditingWorkspaceId(item.id);
                        setEditingWorkspaceName(item.name);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded text-aegis-text-dim opacity-0 hover:bg-aegis-bg hover:text-aegis-text group-hover:opacity-100 focus:opacity-100"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      title="关闭项目"
                      onClick={() => closeWorkspace(item.id)}
                      className="flex h-6 w-6 items-center justify-center rounded text-aegis-text-dim opacity-0 hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </aside>

      {!taskPanelCollapsed ? (
        <aside className="flex w-[276px] shrink-0 flex-col border-r border-aegis-border bg-aegis-surface">
          <div className="flex h-12 items-center gap-2 border-b border-aegis-border px-3">
            <Bot size={16} className="text-aegis-primary" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{workspace?.name || 'AI 工作台'}</span>
            <button
              type="button"
              title="收起任务栏"
              onClick={() => setTaskPanelCollapsed(true)}
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
          <button
            type="button"
            onClick={startNewTask}
            className="mx-3 flex h-9 items-center justify-center gap-2 rounded-md bg-aegis-primary text-xs font-semibold text-white"
          >
            <Plus size={14} />新建任务
          </button>
          <div className="mt-3 flex items-center border-y border-aegis-border px-3 py-2 text-[11px] text-aegis-text-dim">
            <span className="flex-1">{projectTasks.length} 个任务</span>
            <select
              value={taskDisplayWindow}
              onChange={(event) => setTaskDisplayWindow(event.target.value === 'all' ? 'all' : Number(event.target.value) as TaskDisplayWindow)}
              aria-label="任务历史范围"
              title="任务历史范围"
              className="mr-1 max-w-20 bg-transparent text-[10px] text-aegis-text-dim outline-none hover:text-aegis-text"
            >
              {TASK_DISPLAY_WINDOWS.map((windowValue) => (
                <option key={windowValue} value={windowValue}>
                  {windowValue === 'all' ? '全部' : `${windowValue} 天`}
                </option>
              ))}
            </select>
            {projectTasks.length > 0 && (
              <button
                type="button"
                title="清空此项目任务"
                onClick={() => clearProjectTasks(projectPath)}
                className="flex h-6 w-6 items-center justify-center rounded hover:bg-aegis-hover hover:text-aegis-text"
              >
                <Trash2 size={13} />
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
                {editingTaskId === task.id ? (
                  <div className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1">
                    <CircleDot size={12} className="mt-0.5 shrink-0" style={{ color: statusColor[task.status] }} />
                    <span className="min-w-0 flex-1">
                      <input
                        autoFocus
                        value={editingTaskTitle}
                        onChange={(event) => setEditingTaskTitle(event.target.value)}
                        onBlur={commitTaskRename}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitTaskRename();
                          if (event.key === 'Escape') {
                            setEditingTaskId(null);
                            setEditingTaskTitle('');
                          }
                        }}
                        className="h-5 w-full rounded border border-aegis-primary bg-aegis-bg px-1 text-xs outline-none"
                      />
                      <span className="block truncate pt-0.5 text-[10px] text-aegis-text-dim">
                        {task.agent} · {taskStatusLabel(task.status)}
                        {task.worktreeBranch && !task.worktreeDiscarded && ` · ${task.worktreeBranch}`}
                      </span>
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setOpenDiff(null);
                      setOpenFiles([]);
                      setActiveFilePath(null);
                      setRerunTaskId(null);
                      selectTask(task.id);
                    }}
                    className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1 text-left"
                  >
                    <CircleDot size={12} className="mt-0.5 shrink-0" style={{ color: statusColor[task.status] }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{task.title || task.prompt}</span>
                      <span className="block truncate pt-0.5 text-[10px] text-aegis-text-dim">
                        {task.agent} · {taskStatusLabel(task.status)}
                        {task.worktreeBranch && !task.worktreeDiscarded && ` · ${task.worktreeBranch}`}
                      </span>
                    </span>
                  </button>
                )}
                <div className="flex shrink-0 items-center gap-0.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    title={task.starred ? '取消收藏' : '收藏任务'}
                    onClick={() => updateTask(task.id, { starred: !task.starred })}
                    className={`flex h-6 w-6 items-center justify-center rounded hover:bg-aegis-hover ${task.starred ? 'text-amber-400' : 'text-aegis-text-dim'}`}
                  >
                    <Star size={12} fill={task.starred ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    type="button"
                    title="重命名任务"
                    onClick={() => {
                      setEditingTaskId(task.id);
                      setEditingTaskTitle(task.title || task.prompt.split('\n')[0]);
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
                  >
                    <Pencil size={12} />
                  </button>
                  {(task.agent === 'claude' || task.agent === 'codex') && (
                    <button
                      type="button"
                      disabled={generatingTaskId !== null}
                      title={generatingTaskId === task.id ? '正在生成任务名称' : '生成任务名称'}
                      onClick={() => void generateTaskTitle(task)}
                      className="flex h-6 w-6 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-wait disabled:opacity-50"
                    >
                      <WandSparkles size={12} className={generatingTaskId === task.id ? 'animate-pulse' : undefined} />
                    </button>
                  )}
                  <button
                    type="button"
                    title="删除任务"
                    onClick={() => removeTask(task.id)}
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
        </aside>
      ) : (
        <aside className="flex w-10 shrink-0 flex-col items-center border-r border-aegis-border bg-aegis-surface pt-2">
          <button
            type="button"
            title="展开任务栏"
            onClick={() => setTaskPanelCollapsed(false)}
            className="relative flex h-8 w-8 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
          >
            <PanelLeftOpen size={15} />
            {hasAttention && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" />}
          </button>
        </aside>
      )}

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-aegis-border px-4">
          <div className="flex min-w-0 items-center gap-2 text-xs text-aegis-text-dim">
            <GitBranch size={14} className="shrink-0" />
            <span className="truncate">{workspace?.name || '项目工作台'}</span>
            {currentBranch && (
              <div className="relative">
                <button
                  type="button"
                  title={`当前分支：${currentBranch}`}
                  onClick={() => {
                    setBranchPickerOpen((open) => !open);
                    setBranchError(null);
                    void refreshBranches();
                  }}
                  className="flex max-w-48 items-center gap-1 truncate rounded px-1.5 py-0.5 font-mono text-[11px] text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
                >
                  <span className="truncate">{currentBranch}</span>
                  <ChevronDown size={12} className="shrink-0" />
                </button>
                {branchPickerOpen && (
                  <div className="absolute left-0 z-50 mt-1 w-72 overflow-hidden rounded-md border border-aegis-border bg-aegis-surface shadow-xl">
                    <div className="border-b border-aegis-border p-2">
                      <input
                        autoFocus
                        value={branchQuery}
                        onChange={(event) => setBranchQuery(event.target.value)}
                        placeholder="搜索分支"
                        className="h-7 w-full rounded border border-aegis-border bg-aegis-bg px-2 text-xs outline-none focus:border-aegis-primary"
                      />
                    </div>
                    <div className="max-h-52 overflow-y-auto py-1">
                      {filteredBranches.map((branch) => (
                        <button
                          key={branch.name}
                          type="button"
                          disabled={branchBusy}
                          onClick={() => void checkoutBranch(branch)}
                          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-aegis-hover disabled:cursor-wait"
                        >
                          <GitBranch size={12} className="shrink-0 text-aegis-text-dim" />
                          <span className="min-w-0 flex-1 truncate font-mono">{branch.name}</span>
                          {branch.current && <Check size={12} className="shrink-0 text-aegis-primary" />}
                          {branch.remote && <span className="text-[10px] text-aegis-text-dim">remote</span>}
                        </button>
                      ))}
                      {!filteredBranches.length && <p className="px-3 py-4 text-center text-xs text-aegis-text-dim">未找到分支</p>}
                    </div>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void createAndCheckoutBranch();
                      }}
                      className="flex gap-1.5 border-t border-aegis-border p-2"
                    >
                      <input
                        value={newBranchName}
                        onChange={(event) => setNewBranchName(event.target.value)}
                        placeholder="新建分支"
                        className="min-w-0 flex-1 rounded border border-aegis-border bg-aegis-bg px-2 py-1 text-xs outline-none focus:border-aegis-primary"
                      />
                      <button
                        type="submit"
                        disabled={!newBranchName.trim() || branchBusy}
                        className="rounded bg-aegis-primary px-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        新建
                      </button>
                    </form>
                    {branchError && <p className="border-t border-red-500/20 px-2.5 py-2 text-[11px] text-red-400">{branchError}</p>}
                  </div>
                )}
              </div>
            )}
            {openDiff && <span className="truncate text-aegis-text">/ {openDiff.title}</span>}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!projectPath}
              title="搜索文件 (Cmd/Ctrl+P)"
              onClick={() => setShowFileSearch(true)}
              className="flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Search size={15} />
            </button>
            <button
              type="button"
              title={showShellTerminal ? '关闭底部终端' : '打开底部终端'}
              onClick={() => setShowShellTerminal((visible) => !visible)}
              className="flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
            >
              <TerminalSquare size={15} />
            </button>
          </div>
        </header>

        <div className="relative min-h-0 flex-1">
          {openDiff ? (
            <GitDiffViewer
              projectPath={currentGitPath}
              mode={openDiff.mode}
              commitHash={'commitHash' in openDiff ? openDiff.commitHash : undefined}
              filePath={'filePath' in openDiff ? openDiff.filePath : undefined}
              staged={openDiff.mode === 'file' ? openDiff.staged : undefined}
              title={openDiff.title}
              onClose={closeDiff}
            />
          ) : activeFilePath && openFiles.length > 0 ? (
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
          ) : !projectPath ? (
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
          ) : !selected ? (
            <section className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center px-8">
              <h1 className="mb-2 text-xl font-semibold">新建 AI 任务</h1>
              <p className="mb-5 text-sm text-aegis-text-dim">使用完整编辑器配置智能体、权限、工作树和附件，再直接启动或保存为待办。</p>
              <button
                type="button"
                onClick={startNewTask}
                className="inline-flex w-fit items-center gap-2 rounded bg-aegis-primary px-3 py-2 text-xs font-semibold text-white"
              >
                <Plus size={14} />新建任务
              </button>
            </section>
          ) : selectedShowsHistory && selected?.sessionPath ? (
            <SessionViewPage
              sessionPath={selected.sessionPath}
              embedded
              onRun={() => {
                updateTask(selected.id, { status: 'todo', failureReason: undefined });
                setRerunTaskId(selected.id);
              }}
            />
          ) : null}

          {renderedRunTasks.map((task) => (
            <div
              key={task.id}
              className={selected?.id === task.id && selectedRunVisible ? 'absolute inset-0' : 'hidden'}
            >
              <AgentRunView
                taskId={task.id}
                projectPath={task.projectPath}
                agent={task.agent === 'codex' || task.agent === 'pi' ? task.agent : 'claude'}
                prompt={task.prompt}
                permissionMode={task.permissionMode}
                initialStatus={task.status}
                initialSessionPath={task.sessionPath}
                initialWorktreePath={task.worktreePath}
                initialWorktreeDiscarded={task.worktreeDiscarded}
                initialBaseBranch={task.baseBranch}
                initialPlanMode={task.planMode}
                initialLaunchMode={task.launchMode}
                initialIsDraft={task.isDraft}
              />
            </div>
          ))}
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
              projectPath={currentGitPath}
              projectId={`agent-workspace:${workspace?.id ?? 'default'}`}
              onClose={() => setShowShellTerminal(false)}
              themeVariant={themeVariant}
              terminalFontSize={terminalFontSize}
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
            <TerminalWorkspaceFiles
              root={projectPath}
              onFileOpen={(entry) => {
                if (!entry.is_dir) openFile(entry.path, entry.name);
              }}
            />
          )}
          {rightPanel === 'changes' && (
            <GitChanges
              projectPath={currentGitPath}
              currentTaskCreatedAt={selected?.createdAt ?? null}
              onFileSelect={(filePath, staged, title) => showDiff({ mode: 'file', filePath, staged, title })}
              width={rightPanelWidth}
            />
          )}
          {rightPanel === 'history' && (
            <GitHistory
              projectPath={currentGitPath}
              onCommitSelect={(commitHash, title) => showDiff({ mode: 'commit', commitHash, title })}
              onFileClick={(commitHash, filePath, title) => showDiff({ mode: 'commit-file', commitHash, filePath, title })}
              width={rightPanelWidth}
            />
          )}
        </aside>
      )}

      <nav className="flex w-10 shrink-0 flex-col items-center gap-1 border-l border-aegis-border bg-aegis-surface py-2">
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
        {openDiff && (
          <button
            type="button"
            title="关闭 Diff"
            onClick={closeDiff}
            className="mt-auto flex h-8 w-8 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
          >
            <X size={15} />
          </button>
        )}
      </nav>

      {showFileSearch && projectPath && (
        <AgentWorkspaceFileSearchDialog
          projectPath={projectPath}
          onFileOpen={openFile}
          onClose={() => setShowFileSearch(false)}
        />
      )}
    </div>
  );
}
