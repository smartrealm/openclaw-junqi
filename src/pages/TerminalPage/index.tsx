// Terminal Workspace — Multi-session terminal with workspace management
// + optional right panel (agents overview)

import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/useTheme";
import {
  ShellTerminalPanel,
} from "@/components/Terminal";
import { PaneTreeView } from "@/components/Terminal/PaneTreeView";
import { TerminalWorkspaceFiles } from "@/components/Terminal/TerminalWorkspaceFiles";
import {
  clampTerminalSidebarWidth,
  nextTerminalSidebarMode,
  resizeTerminalSidebarWidth,
  TERMINAL_SIDEBAR_MAX_WIDTH,
  TERMINAL_SIDEBAR_MIN_WIDTH,
  type TerminalSidebarMode,
} from "@/components/Terminal/terminalWorkspaceTree";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, ChevronRight, Clock3, FolderOpen, FolderTree, GitBranch, Layers, PanelLeft, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, Server, Trash2, X } from "lucide-react";
import type { ThemeVariant, TerminalFontSize, FontFamily } from "@/_nezha_root/types";
import type { Workspace } from "@/workspace/types";
import { getDefaultMonoFont } from "@/_nezha_root/types";
import { takePendingTerminalCommands } from '@/services/terminalCommandQueue';
import { useSettingsStore } from '@/stores/settingsStore';

interface TerminalWorkspaceDirectory {
  path: string;
  name: string;
}

interface TerminalWorkspaceWorktree {
  path: string;
  branch: string;
  name: string;
}

type TerminalSidebarContent = 'workspaces' | 'files';

export function TerminalPage() {
  const { t } = useTranslation();
  const resolvedTheme = useTheme();
  const themeVariant: ThemeVariant = resolvedTheme.replace("aegis-", "") as ThemeVariant;

  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize) as TerminalFontSize;
  const configuredMonoFont = useSettingsStore((state) => state.monoFont);
  const monoFontFamily = (configuredMonoFont || getDefaultMonoFont()) as FontFamily;
  const [projectPath, setProjectPath] = useState(".");
  const [recentDirectories, setRecentDirectories] = useState<TerminalWorkspaceDirectory[]>([]);
  const addToast = useNotificationStore((state) => state.addToast);
  useEffect(() => {
    let cancelled = false;
    homeDir()
      .then((path) => {
        if (cancelled) return;
        setProjectPath(path);
        const store = useWorkspaceStore.getState();
        store.setDefaultWorkingDirectory(path);
        store.ensureActive(path);
      })
      .catch(() => {
        if (cancelled) return;
        const store = useWorkspaceStore.getState();
        store.setDefaultWorkingDirectory(".");
        store.ensureActive(".");
      });
    return () => { cancelled = true; };
  }, []);

  const termWrapRef = useRef<HTMLDivElement>(null);

  const workspace = useWorkspaceStore((s) => {
    const active = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    return active ?? null;
  });
  const ensureActive = useWorkspaceStore((s) => s.ensureActive);
  useEffect(() => { if (!workspace) ensureActive(); }, [workspace, ensureActive]);

  const [sidebarMode, setSidebarMode] = useState<TerminalSidebarMode>(() => {
    try {
      const saved = localStorage.getItem('junqi:terminal-sidebar-mode');
      return saved === 'full' || saved === 'compact' || saved === 'hidden' ? saved : 'full';
    } catch { return 'full'; }
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      return clampTerminalSidebarWidth(Number(localStorage.getItem('junqi:terminal-sidebar-width')));
    } catch {
      return TERMINAL_SIDEBAR_MIN_WIDTH;
    }
  });
  const [sidebarResizeActive, setSidebarResizeActive] = useState(false);
  const sidebarTransitionTimerRef = useRef<number | null>(null);
  useEffect(() => {
    try { localStorage.setItem('junqi:terminal-sidebar-mode', sidebarMode); } catch {}
  }, [sidebarMode]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem('junqi:terminal-sidebar-width', String(sidebarWidth)); } catch {}
    }, 150);
    return () => window.clearTimeout(timer);
  }, [sidebarWidth]);
  const cycleSidebarMode = useCallback(() => {
    if (sidebarTransitionTimerRef.current !== null) {
      window.clearTimeout(sidebarTransitionTimerRef.current);
    }
    setSidebarResizeActive(true);
    setSidebarMode(nextTerminalSidebarMode);
    sidebarTransitionTimerRef.current = window.setTimeout(() => {
      sidebarTransitionTimerRef.current = null;
      setSidebarResizeActive(false);
    }, 200);
  }, []);
  useEffect(() => () => {
    if (sidebarTransitionTimerRef.current !== null) {
      window.clearTimeout(sidebarTransitionTimerRef.current);
    }
  }, []);
  const [sidebarContent, setSidebarContent] = useState<TerminalSidebarContent>(() => {
    try {
      return localStorage.getItem('junqi:terminal-sidebar-content') === 'files' ? 'files' : 'workspaces';
    } catch {
      return 'workspaces';
    }
  });
  useEffect(() => {
    try { localStorage.setItem('junqi:terminal-sidebar-content', sidebarContent); } catch {}
  }, [sidebarContent]);

  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [renameWorkspaceRequestId, setRenameWorkspaceRequestId] = useState<string | null>(null);
  const [closeWorkspaceRequestId, setCloseWorkspaceRequestId] = useState<string | null>(null);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const refreshRecentDirectories = useCallback(async () => {
    try {
      const directories = await invoke<TerminalWorkspaceDirectory[]>('list_terminal_recent_workspaces');
      setRecentDirectories(directories);
    } catch {
      // Recent folders are auxiliary state. A read failure must not block a shell.
      setRecentDirectories([]);
    }
  }, []);

  const sidebarToggleTitle = sidebarMode === 'full'
    ? t('nav.sidebarToMini', 'Compact sidebar')
    : sidebarMode === 'compact'
      ? t('nav.sidebarHide', 'Hide sidebar')
      : t('nav.sidebarExpand', 'Show sidebar');
  const sidebarToggleIcon = sidebarMode === 'full'
    ? <PanelLeftClose size={14} />
    : sidebarMode === 'compact'
      ? <PanelLeft size={14} />
      : <PanelLeftOpen size={14} />;

  useEffect(() => {
    void refreshRecentDirectories();
  }, [refreshRecentDirectories]);

  const recordWorkspaceDirectory = useCallback((directory: string) => {
    if (!directory) return;
    void invoke('record_terminal_workspace_directory', { path: directory })
      .then(() => refreshRecentDirectories())
      .catch(() => undefined);
  }, [refreshRecentDirectories]);

  const createWorkspace = useCallback(() => {
    const created = useWorkspaceStore.getState().createWorkspace();
    recordWorkspaceDirectory(created.workingDirectory);
    return created;
  }, [recordWorkspaceDirectory]);

  const createSshWorkspace = useCallback((host: string) => {
    const created = useWorkspaceStore.getState().createSshWorkspace(host);
    if (!created) throw new Error(t('terminal.sshWorkspaceInvalid'));
    return created;
  }, [t]);

  const createWorktreeWorkspace = useCallback(async (parentId: string, branch: string) => {
    const parent = useWorkspaceStore.getState().workspaces.find((workspace) => workspace.id === parentId);
    if (!parent) throw new Error(t('terminal.worktreeSourceMissing'));
    const created = await invoke<TerminalWorkspaceWorktree>('create_terminal_workspace_worktree', {
      projectPath: parent.projectDirectory || parent.workingDirectory,
      branch,
    });
    const workspace = useWorkspaceStore.getState().createWorktreeWorkspace(
      parent.id,
      created.branch,
      created.path,
    );
    if (!workspace) throw new Error(t('terminal.worktreeCreateStateFailed'));
  }, [t]);

  const closeWorktreeWorkspace = useCallback(async (workspace: Workspace, deleteOnDisk: boolean) => {
    if (deleteOnDisk) {
      await invoke('remove_terminal_workspace_worktree', {
        projectPath: workspace.projectDirectory || workspace.workingDirectory,
        worktreePath: workspace.worktreePath || workspace.workingDirectory,
        branch: workspace.worktreeBranch || workspace.name,
      });
    }
    useWorkspaceStore.getState().closeWorkspace(workspace.id);
  }, []);

  const revealWorkspaceDirectory = useCallback(async (workspace: Workspace) => {
    const path = workspace.worktreePath || workspace.projectDirectory || workspace.workingDirectory;
    try {
      await invoke('open_folder', { path });
    } catch {
      addToast(
        'error',
        t('terminal.workspaceRevealFailedTitle'),
        t('terminal.workspaceRevealFailed'),
      );
    }
  }, [addToast, t]);

  const openWorkspaceDirectory = useCallback(async (directoryPath: string) => {
    try {
      const directory = await invoke<TerminalWorkspaceDirectory>('open_terminal_workspace_directory', {
        path: directoryPath,
      });
      useWorkspaceStore.getState().createWorkspace(directory.name, directory.path);
      await refreshRecentDirectories();
      return directory;
    } catch {
      addToast(
        'error',
        t('terminal.openFolderFailedTitle'),
        t('terminal.openFolderFailed'),
      );
      return null;
    }
  }, [addToast, refreshRecentDirectories, t]);

  const chooseWorkspaceDirectory = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: true,
        defaultPath: workspace?.workingDirectory || projectPath,
        title: t('terminal.openFolderDialogTitle'),
      });
      const paths = typeof selected === 'string'
        ? [selected]
        : Array.isArray(selected) ? selected : [];
      for (const path of paths) {
        await openWorkspaceDirectory(path);
      }
    } catch {
      addToast(
        'error',
        t('terminal.openFolderFailedTitle'),
        t('terminal.openFolderFailed'),
      );
    }
  }, [addToast, openWorkspaceDirectory, projectPath, t, workspace?.workingDirectory]);

  const clearRecentDirectories = useCallback(async () => {
    try {
      await invoke('clear_terminal_recent_workspaces');
      setRecentDirectories([]);
    } catch {
      addToast(
        'error',
        t('terminal.clearRecentFoldersFailedTitle'),
        t('terminal.clearRecentFoldersFailed'),
      );
    }
  }, [addToast, t]);

  useEffect(() => {
    const newWorkspace = () => { createWorkspace(); };
    const openFolder = () => { void chooseWorkspaceDirectory(); };
    window.addEventListener('junqi:new-terminal-workspace', newWorkspace);
    window.addEventListener('junqi:open-terminal-folder', openFolder);
    return () => {
      window.removeEventListener('junqi:new-terminal-workspace', newWorkspace);
      window.removeEventListener('junqi:open-terminal-folder', openFolder);
    };
  }, [chooseWorkspaceDirectory, createWorkspace]);

  useEffect(() => {
    const deliver = (command: string, commandProjectPath?: string) => {
      window.dispatchEvent(new CustomEvent('junqi:deliver-terminal-command', {
        detail: { command, projectPath: commandProjectPath },
      }));
    };
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ command: string; projectPath?: string }>;
      const cmd = ce.detail?.command;
      if (!cmd) return;
      deliver(cmd, ce.detail?.projectPath);
    };
    const pendingTimer = window.setTimeout(() => {
      const pending = takePendingTerminalCommands();
      for (const command of pending) deliver(command.command, command.projectPath);
    }, 0);
    window.addEventListener("junqi:run-terminal-command", handler);
    return () => {
      window.clearTimeout(pendingTimer);
      window.removeEventListener("junqi:run-terminal-command", handler);
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editingText = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable;
      if (!editingText && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'w') {
        const activeWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId;
        if (!activeWorkspaceId) return;
        e.preventDefault();
        setSidebarMode('full');
        setCloseWorkspaceRequestId(activeWorkspaceId);
        return;
      }
      if (!editingText && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'r') {
        const activeWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId;
        if (!activeWorkspaceId) return;
        e.preventDefault();
        setSidebarMode('full');
        setRenameWorkspaceRequestId(activeWorkspaceId);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setCmdPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--terminal-bg)" }}>
      <div
        style={{
          height: 32,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          borderBottom: '1px solid rgb(var(--aegis-overlay)/0.08)',
          background: 'rgb(var(--aegis-surface))',
        }}
      >
        <button
          type="button"
          onClick={cycleSidebarMode}
          title={sidebarToggleTitle}
          aria-label={sidebarToggleTitle}
          style={{
            width: 28,
            height: 28,
            borderRadius: 5,
            border: 'none',
            background: 'transparent',
            color: 'rgb(var(--aegis-text-dim))',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = 'rgb(var(--aegis-overlay)/0.08)';
            event.currentTarget.style.color = 'rgb(var(--aegis-text))';
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = 'transparent';
            event.currentTarget.style.color = 'rgb(var(--aegis-text-dim))';
          }}
        >
          {sidebarToggleIcon}
        </button>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>

        {sidebarMode !== "hidden" && (
          <WorkspaceSidebarPanel
            mode={sidebarMode}
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
            onResizeActiveChange={setSidebarResizeActive}
            content={sidebarContent}
            onContentChange={setSidebarContent}
            projectPath={workspace?.sshRemoteHost ? '' : workspace?.projectDirectory || workspace?.workingDirectory || projectPath}
            workspaces={workspaces}
            recentDirectories={recentDirectories}
            activeWorkspaceId={activeWorkspaceId}
            onSelectWorkspace={(id) => useWorkspaceStore.getState().setActive(id)}
            onCreateWorkspace={createWorkspace}
            onCreateSshWorkspace={createSshWorkspace}
            onOpenFolder={chooseWorkspaceDirectory}
            onOpenRecentDirectory={openWorkspaceDirectory}
            onClearRecentDirectories={clearRecentDirectories}
            onCloseWorkspace={(id) => useWorkspaceStore.getState().closeWorkspace(id)}
            onCreateWorktree={createWorktreeWorkspace}
            onCloseWorktree={closeWorktreeWorkspace}
            onRenameWorkspace={(id, name) => useWorkspaceStore.getState().renameWorkspace(id, name)}
            onMoveWorkspace={(workspaceId, targetWorkspaceId, position) => useWorkspaceStore.getState().moveWorkspace(workspaceId, targetWorkspaceId, position)}
            onDuplicateWorkspace={(id) => useWorkspaceStore.getState().duplicateWorkspace(id)}
            onCloseOtherWorkspaces={(id) => useWorkspaceStore.getState().closeOtherWorkspaces(id)}
            onRevealWorkspace={revealWorkspaceDirectory}
            renameWorkspaceRequestId={renameWorkspaceRequestId}
            onRenameWorkspaceRequestHandled={() => setRenameWorkspaceRequestId(null)}
            closeWorkspaceRequestId={closeWorkspaceRequestId}
            onCloseWorkspaceRequestHandled={() => setCloseWorkspaceRequestId(null)}
          />
        )}

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>

          <div ref={termWrapRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {workspaces.map((candidate) => {
              const candidateActive = candidate.id === activeWorkspaceId;
              return (
                <div
                  key={candidate.id}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 0,
                    display: candidateActive ? 'flex' : 'none',
                  }}
                >
                  <PaneTreeView
                    workspace={candidate}
                    isActive={candidateActive}
                    themeVariant={themeVariant}
                    terminalFontSize={terminalFontSize}
                    monoFontFamily={monoFontFamily}
                    projectPath={candidate.sshRemoteHost ? projectPath : candidate.projectDirectory || candidate.workingDirectory || projectPath}
                    resizeSuspended={sidebarResizeActive}
                  />
                </div>
              );
            })}
            {workspaces.length === 0 && (
              <ShellTerminalPanel
                themeVariant={themeVariant}
                terminalFontSize={terminalFontSize}
                monoFontFamily={monoFontFamily}
                projectPath={projectPath}
                projectId="default"
                resizeSuspended={sidebarResizeActive}
                onClose={() => {}}
                onSplitHorizontal={() => {
                  import('@/stores/workspaceStore').then(({ useWorkspaceStore }) => {
                    const ws = useWorkspaceStore.getState();
                    const active = ws.workspaces.find((w) => w.id === ws.activeWorkspaceId);
                    if (active) ws.splitPane(active.focusedPaneId, 'horizontal');
                  });
                }}
                onSplitVertical={() => {
                  import('@/stores/workspaceStore').then(({ useWorkspaceStore }) => {
                    const ws = useWorkspaceStore.getState();
                    const active = ws.workspaces.find((w) => w.id === ws.activeWorkspaceId);
                    if (active) ws.splitPane(active.focusedPaneId, 'vertical');
                  });
                }}
              />
            )}
          </div>
        </div>

      </div>

      <CommandPaletteModal
        open={cmdPaletteOpen}
      onClose={() => setCmdPaletteOpen(false)}
      workspaces={workspaces}
      recentDirectories={recentDirectories}
      onSelectWorkspace={(id) => useWorkspaceStore.getState().setActive(id)}
      onCreateWorkspace={createWorkspace}
      onOpenFolder={chooseWorkspaceDirectory}
      onOpenRecentDirectory={openWorkspaceDirectory}
    />
    </div>
  );
}

function WorkspaceProjectTree({
  workspaces,
  activeWorkspaceId,
  compact,
  onSelect,
  onRename,
  onClose,
  onMove,
  onDuplicate,
  onCloseOthers,
  onCreateWorktree,
  worktreeEligibleWorkspaceIds,
  onReveal,
  renameWorkspaceRequestId,
  onRenameWorkspaceRequestHandled,
}: {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  compact: boolean;
  onSelect: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onClose: (id: string) => void;
  onMove: (workspaceId: string, targetWorkspaceId: string, position: 'before' | 'after') => void;
  onDuplicate: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCreateWorktree: (parentId: string) => void;
  worktreeEligibleWorkspaceIds: Set<string>;
  onReveal: (workspace: Workspace) => void | Promise<void>;
  renameWorkspaceRequestId: string | null;
  onRenameWorkspaceRequestHandled: () => void;
}) {
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(() => new Set());
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);
  const workspaceIds = useMemo(() => new Set(workspaces.map((workspace) => workspace.id)), [workspaces]);
  const childrenByParent = useMemo(() => {
    const children = new Map<string, Workspace[]>();
    for (const workspace of workspaces) {
      if (!workspace.worktreeParentId || !workspaceIds.has(workspace.worktreeParentId)) continue;
      const siblings = children.get(workspace.worktreeParentId) ?? [];
      siblings.push(workspace);
      children.set(workspace.worktreeParentId, siblings);
    }
    return children;
  }, [workspaceIds, workspaces]);
  const topLevel = workspaces.filter((workspace) => (
    !workspace.worktreeParentId || !workspaceIds.has(workspace.worktreeParentId)
  ));

  useEffect(() => {
    if (!renameWorkspaceRequestId) return;
    const requested = workspaces.find((workspace) => workspace.id === renameWorkspaceRequestId);
    if (requested?.worktreeParentId) {
      setCollapsedParents((current) => {
        if (!current.has(requested.worktreeParentId!)) return current;
        const next = new Set(current);
        next.delete(requested.worktreeParentId!);
        return next;
      });
    }
  }, [renameWorkspaceRequestId, workspaces]);

  const renderRow = (workspace: Workspace, depth: number, parent?: Workspace) => {
    const children = childrenByParent.get(workspace.id) ?? [];
    const isTopLevel = depth === 0;
    const isCollapsed = collapsedParents.has(workspace.id);
    return (
      <div key={workspace.id}>
        <ProjectWorkspaceRow
          workspace={workspace}
          parent={parent}
          active={workspace.id === activeWorkspaceId}
          compact={compact}
          hasChildren={children.length > 0}
          collapsed={isCollapsed}
          depth={depth}
          draggable={isTopLevel}
          dragTargetPosition={dragTarget?.id === workspace.id ? dragTarget.position : null}
          onSelect={() => onSelect(workspace.id)}
          onToggleChildren={() => setCollapsedParents((current) => {
            const next = new Set(current);
            if (next.has(workspace.id)) next.delete(workspace.id);
            else next.add(workspace.id);
            return next;
          })}
          onRename={onRename ? (name) => onRename(workspace.id, name) : undefined}
          onClose={() => onClose(workspace.id)}
          onDuplicate={() => onDuplicate(workspace.id)}
          onCloseOthers={() => onCloseOthers(workspace.id)}
          canCloseOthers={workspaces.length > 1}
          onCreateWorktree={
            !workspace.worktreeParentId
            && !workspace.sshRemoteHost
            && worktreeEligibleWorkspaceIds.has(workspace.id)
              ? () => onCreateWorktree(workspace.id)
              : undefined
          }
          onGoToSource={workspace.worktreeParentId ? () => onSelect(workspace.worktreeParentId!) : undefined}
          onReveal={workspace.sshRemoteHost ? undefined : () => { void onReveal(workspace); }}
          renameRequested={renameWorkspaceRequestId === workspace.id}
          onRenameRequestHandled={onRenameWorkspaceRequestHandled}
          onDragStart={() => setDraggedId(workspace.id)}
          onDragEnd={() => setDraggedId(null)}
          onDragOver={(event) => {
            if (!isTopLevel || !draggedId || draggedId === workspace.id) return;
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            setDragTarget({ id: workspace.id, position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' });
          }}
          onDragLeave={() => setDragTarget((current) => current?.id === workspace.id ? null : current)}
          onDrop={(event) => {
            event.preventDefault();
            const source = event.dataTransfer.getData('application/x-junqi-workspace') || draggedId;
            const position = dragTarget?.id === workspace.id ? dragTarget.position : 'before';
            if (isTopLevel && source && source !== workspace.id) onMove(source, workspace.id, position);
            setDraggedId(null);
            setDragTarget(null);
          }}
        />
        {!compact && children.length > 0 && !isCollapsed && children.map((child) => renderRow(child, depth + 1, workspace))}
      </div>
    );
  };

  return <>{compact ? workspaces.map((workspace) => renderRow(workspace, 0)) : topLevel.map((workspace) => renderRow(workspace, 0))}</>;
}

function ProjectWorkspaceRow({
  workspace,
  parent,
  active,
  compact,
  hasChildren,
  collapsed,
  depth,
  draggable,
  dragTargetPosition,
  onSelect,
  onToggleChildren,
  onRename,
  onClose,
  onDuplicate,
  onCloseOthers,
  canCloseOthers,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onCreateWorktree,
  onGoToSource,
  onReveal,
  renameRequested,
  onRenameRequestHandled,
}: {
  workspace: Workspace;
  parent?: Workspace;
  active: boolean;
  compact: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  depth: number;
  draggable: boolean;
  dragTargetPosition: 'before' | 'after' | null;
  onSelect: () => void;
  onToggleChildren: () => void;
  onRename?: (name: string) => void;
  onClose?: () => void;
  onDuplicate: () => void;
  onCloseOthers?: () => void;
  canCloseOthers: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onCreateWorktree?: () => void;
  onGoToSource?: () => void;
  onReveal?: () => void;
  renameRequested: boolean;
  onRenameRequestHandled: () => void;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const title = workspace.name.trim() || t('terminal.workspaceDefault');
  const projectPath = workspace.sshRemoteHost
    ? `ssh://${workspace.sshRemoteHost}`
    : workspace.worktreePath || workspace.projectDirectory || workspace.workingDirectory;
  const subtitle = workspace.worktreeParentId
    ? workspace.worktreeBranch || projectPath
    : projectPath;

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (!renameRequested || compact) return;
    setName(title);
    setRenaming(true);
    onRenameRequestHandled();
  }, [compact, onRenameRequestHandled, renameRequested, title]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [contextMenu]);

  const commitRename = () => {
    const next = name.trim();
    if (next) onRename?.(next);
    setRenaming(false);
  };

  const contextMenuContent = contextMenu && (
    <div
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 600,
        minWidth: 176, padding: 4, borderRadius: 6,
        background: 'rgb(var(--aegis-elevated))', border: '1px solid rgb(var(--aegis-overlay) / 0.14)',
        boxShadow: '0 8px 24px rgb(0 0 0 / 0.32)',
      }}
    >
      {onClose && <WorkspaceRowMenuItem danger label={workspace.worktreeParentId ? t('terminal.worktreeClose') : t('terminal.workspaceClose')} onClick={() => { onClose(); setContextMenu(null); }} />}
      <WorkspaceRowMenuItem disabled={!canCloseOthers} label={t('terminal.workspaceCloseOthers')} onClick={() => { if (canCloseOthers) { onCloseOthers?.(); setContextMenu(null); } }} />
      <div style={{ height: 1, margin: '3px 0', background: 'rgb(var(--aegis-overlay) / 0.10)' }} />
      <WorkspaceRowMenuItem label={t('terminal.workspaceRename')} onClick={() => { setName(title); setRenaming(true); setContextMenu(null); }} />
      <WorkspaceRowMenuItem label={t('terminal.workspaceDuplicate')} onClick={() => { onDuplicate(); setContextMenu(null); }} />
      {onCreateWorktree && <WorkspaceRowMenuItem label={t('terminal.worktreeCreate')} onClick={() => { onCreateWorktree(); setContextMenu(null); }} />}
      {onGoToSource && <WorkspaceRowMenuItem label={t('terminal.worktreeGoToSource')} onClick={() => { onGoToSource(); setContextMenu(null); }} />}
      {onReveal && <WorkspaceRowMenuItem label={t('terminal.workspaceReveal')} onClick={() => { onReveal(); setContextMenu(null); }} />}
    </div>
  );

  if (compact) {
    return (
      <>
      <div
        draggable={draggable}
        title={workspace.worktreeParentId ? `${title} - ${subtitle}` : title}
        onClick={onSelect}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
        onDragStart={(event) => {
          if (!draggable) return;
          event.dataTransfer.setData('application/x-junqi-workspace', workspace.id);
          event.dataTransfer.effectAllowed = 'move';
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          height: 38, margin: '2px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', cursor: 'pointer', borderRadius: 6,
          background: active ? 'rgb(var(--aegis-overlay) / 0.12)' : 'transparent',
          outline: dragTargetPosition ? '1px solid rgb(var(--aegis-primary) / 0.55)' : 'none',
          color: active ? 'rgb(var(--aegis-text))' : 'rgb(var(--aegis-text-dim))',
        }}
      >
        {workspace.sshRemoteHost ? <Server size={15} strokeWidth={1.8} /> : workspace.worktreeParentId ? <GitBranch size={15} strokeWidth={1.8} /> : <FolderOpen size={15} strokeWidth={1.8} />}
        {active && <span style={{ position: 'absolute', top: 5, right: 5, width: 5, height: 5, borderRadius: '50%', background: 'rgb(var(--aegis-primary))' }} />}
      </div>
      {contextMenuContent}
      </>
    );
  }

  return (
    <div
      draggable={draggable}
      onClick={() => { if (!renaming) onSelect(); }}
      onDoubleClick={() => { if (onRename) { setName(title); setRenaming(true); } }}
      onContextMenu={(event) => {
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragStart={(event) => {
        if (!draggable) return;
        event.dataTransfer.setData('application/x-junqi-workspace', workspace.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        minHeight: 48, display: 'flex', alignItems: 'center', gap: 8, margin: '2px 6px',
        padding: `7px 8px 7px ${10 + depth * 18}px`, borderRadius: 6, cursor: 'pointer', position: 'relative',
        background: active ? 'rgb(var(--aegis-overlay) / 0.12)' : hovered ? 'rgb(var(--aegis-overlay) / 0.06)' : 'transparent',
        boxShadow: dragTargetPosition === 'before'
          ? 'inset 0 2px 0 rgb(var(--aegis-primary) / 0.9)'
          : dragTargetPosition === 'after'
            ? 'inset 0 -2px 0 rgb(var(--aegis-primary) / 0.9)'
            : 'none',
        color: active ? 'rgb(var(--aegis-text))' : 'rgb(var(--aegis-text-dim))',
      }}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-label={collapsed ? 'Expand worktrees' : 'Collapse worktrees'}
          onClick={(event) => { event.stopPropagation(); onToggleChildren(); }}
          style={{ width: 18, height: 18, border: 'none', background: 'transparent', color: 'inherit', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
        >
          <ChevronRight size={13} style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 120ms ease' }} />
        </button>
      ) : <span style={{ width: 18, flexShrink: 0 }} />}
      {workspace.sshRemoteHost ? <Server size={14} strokeWidth={1.8} style={{ flexShrink: 0 }} /> : workspace.worktreeParentId ? <GitBranch size={14} strokeWidth={1.8} style={{ flexShrink: 0 }} /> : <FolderOpen size={14} strokeWidth={1.8} style={{ flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {renaming ? (
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); commitRename(); }
              if (event.key === 'Escape') { event.preventDefault(); setRenaming(false); }
              event.stopPropagation();
            }}
            style={{ height: 20, minWidth: 0, borderRadius: 3, border: '1px solid rgb(var(--aegis-primary) / 0.7)', background: 'rgb(var(--aegis-surface))', color: 'rgb(var(--aegis-text))', fontSize: 12, padding: '0 5px', outline: 'none' }}
          />
        ) : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, lineHeight: 1.2, color: active ? 'rgb(var(--aegis-text))' : 'inherit' }}>{title}</span>}
        <span title={subtitle} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, lineHeight: 1.2, opacity: 0.7, fontFamily: '"JetBrains Mono", monospace' }}>
          {workspace.worktreeParentId && <GitBranch size={10} strokeWidth={1.8} style={{ verticalAlign: '-1px', marginRight: 4 }} />}{subtitle}
        </span>
      </div>
      {hovered && (onClose || onCreateWorktree || hasChildren) ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {hasChildren && <button type="button" title={collapsed ? t('terminal.worktreeExpand') : t('terminal.worktreeCollapse')} onClick={(event) => { event.stopPropagation(); onToggleChildren(); }} style={workspaceRowIconButtonStyle}><ChevronRight size={12} style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 120ms ease' }} /></button>}
          {onCreateWorktree && <button type="button" title={t('terminal.worktreeCreate')} onClick={(event) => { event.stopPropagation(); onCreateWorktree(); }} style={workspaceRowIconButtonStyle}><GitBranch size={12} /></button>}
          {onClose && <button
            type="button"
            title={workspace.worktreeParentId ? t('terminal.worktreeClose') : t('terminal.workspaceClose')}
            onClick={(event) => { event.stopPropagation(); onClose(); }}
            style={workspaceRowIconButtonStyle}
          >
            <X size={12} strokeWidth={2} />
          </button>}
        </div>
      ) : <span style={{ width: 20, height: 20, flexShrink: 0 }} />}
      {parent && <span className="sr-only">{parent.name}</span>}
      {contextMenuContent}
    </div>
  );
}

const workspaceRowIconButtonStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'rgb(var(--aegis-text-dim))',
  padding: 0,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

function WorkspaceRowMenuItem({ label, onClick, danger = false, disabled = false }: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      style={{ width: '100%', height: 28, border: 'none', borderRadius: 4, background: 'transparent', color: danger ? 'rgb(239 68 68)' : 'rgb(var(--aegis-text))', opacity: disabled ? 0.45 : 1, padding: '0 8px', cursor: disabled ? 'default' : 'pointer', textAlign: 'left', fontSize: 11.5 }}
      onMouseEnter={(event) => { if (!disabled) event.currentTarget.style.background = danger ? 'rgb(239 68 68 / 0.10)' : 'rgb(var(--aegis-overlay) / 0.08)'; }}
      onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}
    >
      {label}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────
// WorkspaceSidebarPanel — redesigned (full 220px / compact 52px)
// ──────────────────────────────────────────────────────────────
function WorkspaceSidebarPanel({
  mode, width, onWidthChange, onResizeActiveChange, content, onContentChange, projectPath, workspaces, recentDirectories, activeWorkspaceId,
  onSelectWorkspace, onCreateWorkspace, onCreateSshWorkspace, onOpenFolder, onOpenRecentDirectory,
  onClearRecentDirectories, onCloseWorkspace, onCreateWorktree, onCloseWorktree, onRenameWorkspace, onMoveWorkspace, onDuplicateWorkspace, onCloseOtherWorkspaces, onRevealWorkspace,
  renameWorkspaceRequestId, onRenameWorkspaceRequestHandled, closeWorkspaceRequestId, onCloseWorkspaceRequestHandled,
}: {
  mode: 'full' | 'compact';
  width: number;
  onWidthChange: (width: number) => void;
  onResizeActiveChange: (active: boolean) => void;
  content: TerminalSidebarContent;
  onContentChange: (content: TerminalSidebarContent) => void;
  projectPath: string;
  workspaces: Workspace[];
  recentDirectories: TerminalWorkspaceDirectory[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
  onCreateSshWorkspace: (host: string) => Workspace;
  onOpenFolder: () => void;
  onOpenRecentDirectory: (path: string) => void | Promise<unknown>;
  onClearRecentDirectories: () => void | Promise<unknown>;
  onCloseWorkspace: (id: string) => void;
  onCreateWorktree: (parentId: string, branch: string) => Promise<void>;
  onCloseWorktree: (workspace: Workspace, deleteOnDisk: boolean) => Promise<void>;
  onRenameWorkspace?: (id: string, name: string) => void;
  onMoveWorkspace: (workspaceId: string, targetWorkspaceId: string, position: 'before' | 'after') => void;
  onDuplicateWorkspace: (id: string) => void;
  onCloseOtherWorkspaces: (id: string) => void;
  onRevealWorkspace: (workspace: Workspace) => void | Promise<void>;
  renameWorkspaceRequestId: string | null;
  onRenameWorkspaceRequestHandled: () => void;
  closeWorkspaceRequestId: string | null;
  onCloseWorkspaceRequestHandled: () => void;
}) {
  const { t } = useTranslation();
  const panelWidth = mode === 'full' ? width : 52;
  const [fileTreeVersion, setFileTreeVersion] = useState(0);
  const [worktreeCreateParent, setWorktreeCreateParent] = useState<Workspace | null>(null);
  const [sshWorkspaceDialogOpen, setSshWorkspaceDialogOpen] = useState(false);
  const [worktreeRemoval, setWorktreeRemoval] = useState<Workspace | null>(null);
  const [worktreeFamilyRemoval, setWorktreeFamilyRemoval] = useState<Workspace | null>(null);
  const [worktreeEligibleWorkspaceIds, setWorktreeEligibleWorkspaceIds] = useState<Set<string>>(() => new Set());
  const [resizing, setResizing] = useState(false);
  const resizeStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    direction: 'ltr' | 'rtl';
  } | null>(null);
  const openWorkspacePaths = new Set(workspaces.map(
    (workspace) => workspace.projectDirectory || workspace.workingDirectory,
  ));
  const visibleRecentDirectories = recentDirectories.filter((directory) => !openWorkspacePaths.has(directory.path));
  const showingFiles = content === 'files' && mode === 'full';
  const fileRootAvailable = projectPath !== '.';
  const fileRootName = projectPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || projectPath;

  useEffect(() => {
    let cancelled = false;
    const candidates = workspaces.filter((workspace) => (
      !workspace.sshRemoteHost
      && !workspace.worktreeParentId
      && Boolean(workspace.projectDirectory || workspace.workingDirectory)
    ));
    void Promise.all(candidates.map(async (workspace) => {
      try {
        await invoke('git_status', {
          projectPath: workspace.projectDirectory || workspace.workingDirectory,
        });
        return workspace.id;
      } catch {
        return null;
      }
    })).then((eligible) => {
      if (cancelled) return;
      setWorktreeEligibleWorkspaceIds(new Set(eligible.filter((id): id is string => id !== null)));
    });
    return () => { cancelled = true; };
  }, [workspaces]);

  useEffect(() => {
    if (!showingFiles || !fileRootAvailable) return;
    const refresh = () => setFileTreeVersion((version) => version + 1);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
    };
  }, [fileRootAvailable, showingFiles]);

  useEffect(() => () => {
    if (resizeStateRef.current) onResizeActiveChange(false);
  }, [onResizeActiveChange]);

  const finishResize = useCallback(() => {
    if (!resizeStateRef.current) return;
    resizeStateRef.current = null;
    setResizing(false);
    onResizeActiveChange(false);
  }, [onResizeActiveChange]);

  const requestWorkspaceClose = useCallback((id: string) => {
    const workspace = workspaces.find((candidate) => candidate.id === id);
    if (workspace?.worktreeParentId) {
      setWorktreeRemoval(workspace);
    } else if (workspace && workspaces.some((candidate) => candidate.worktreeParentId === workspace.id)) {
      setWorktreeFamilyRemoval(workspace);
    } else if (workspace) {
      onCloseWorkspace(id);
    }
  }, [onCloseWorkspace, workspaces]);

  useEffect(() => {
    if (!closeWorkspaceRequestId) return;
    requestWorkspaceClose(closeWorkspaceRequestId);
    onCloseWorkspaceRequestHandled();
  }, [closeWorkspaceRequestId, onCloseWorkspaceRequestHandled, requestWorkspaceClose]);

  useEffect(() => {
    if (mode !== 'full') finishResize();
  }, [finishResize, mode]);

  return (
    <div style={{
      width: panelWidth, flexShrink: 0, display: 'flex', flexDirection: 'column',
      borderInlineEnd: '1px solid rgb(255 255 255 / 0.07)',
      background: 'rgb(var(--aegis-surface))',
      transition: resizing ? 'none' : 'width 0.18s cubic-bezier(0.22,1,0.36,1)',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Kooky keeps project status inside each pane's bottom bar. The
          sidebar is intentionally just a workspace navigator. */}
      {mode === 'full' ? (
        <div style={{
          height: 46, display: 'flex', alignItems: 'center',
          padding: '0 10px 0 14px', gap: 6, flexShrink: 0,
        }}>
          <span style={{
            flex: 1, fontSize: 15, fontFamily: 'inherit', color: 'rgb(var(--aegis-text))',
            fontWeight: 500, letterSpacing: 0,
          }}>junqi</span>
          <button
            onClick={onCreateWorkspace}
            title={t('terminal.workspaceNew')}
            style={{
              width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', borderRadius: 5,
              color: 'rgb(var(--aegis-text-dim))', cursor: 'pointer',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.08)'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-dim))'; }}
          >
            <Plus size={13} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => setSshWorkspaceDialogOpen(true)}
            title={t('terminal.sshWorkspaceCreate')}
            style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 5, color: 'rgb(var(--aegis-text-dim))', cursor: 'pointer' }}
            onMouseEnter={(event) => { event.currentTarget.style.background = 'rgb(var(--aegis-overlay)/0.08)'; event.currentTarget.style.color = 'rgb(var(--aegis-text))'; }}
            onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; event.currentTarget.style.color = 'rgb(var(--aegis-text-dim))'; }}
          >
            <Server size={13} strokeWidth={2} />
          </button>
        </div>
      ) : (
        <div style={{ height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <button
            onClick={onCreateWorkspace}
            title={t('terminal.workspaceNew')}
            style={{
              width: 24, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', borderRadius: 6,
              color: 'rgb(var(--aegis-text-dim))', cursor: 'pointer',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.08)'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-dim))'; }}
          >
            <Plus size={13} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => setSshWorkspaceDialogOpen(true)}
            title={t('terminal.sshWorkspaceCreate')}
            style={{ width: 24, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 6, color: 'rgb(var(--aegis-text-dim))', cursor: 'pointer' }}
          >
            <Server size={13} strokeWidth={2} />
          </button>
        </div>
      )}

      <div style={{ height: 1, flexShrink: 0, background: 'rgb(var(--aegis-overlay) / 0.08)' }} />

      {/* ── 工作区列表 ──────────────────────────── */}
      {showingFiles ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ minHeight: 46, display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px 6px 12px', borderBottom: '1px solid rgb(255 255 255 / 0.06)' }}>
            <FolderOpen size={14} strokeWidth={1.8} color="rgb(var(--aegis-primary))" style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, fontFamily: '"JetBrains Mono", monospace', color: 'rgb(var(--aegis-text))' }} title={projectPath}>{fileRootName}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 9.5, fontFamily: '"JetBrains Mono", monospace', color: 'rgb(var(--aegis-text-dim))' }} title={projectPath}>{projectPath}</span>
            </span>
            <button
              type="button"
              onClick={() => setFileTreeVersion((version) => version + 1)}
              title={t('terminal.refreshFiles')}
              style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 4, color: 'rgb(var(--aegis-text-dim))', cursor: 'pointer', flexShrink: 0 }}
              onMouseEnter={(event) => { (event.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay) / 0.08)'; (event.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; }}
              onMouseLeave={(event) => { (event.currentTarget as HTMLElement).style.background = 'transparent'; (event.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-dim))'; }}
            >
              <RefreshCw size={13} strokeWidth={1.9} />
            </button>
          </div>
          {fileRootAvailable ? (
            <TerminalWorkspaceFiles root={projectPath} refreshVersion={fileTreeVersion} />
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, color: 'rgb(var(--aegis-text-dim))', fontSize: 11, textAlign: 'center' }}>
              {t('terminal.filesUnavailable')}
            </div>
          )}
        </div>
      ) : (
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: mode === 'full' ? '6px 0' : '6px 0' }}>
        {workspaces.length === 0 ? (
          /* 空状态 */
          mode === 'full' && (
            <div style={{
              padding: '24px 16px', textAlign: 'center',
              color: 'rgb(var(--aegis-text-dim))', opacity: 0.45,
              fontSize: 11, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.6,
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto 8px', display: 'block', opacity: 0.5 }}>
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              {t('terminal.workspaceEmpty')}
            </div>
          )
        ) : (
          <WorkspaceProjectTree
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            compact={mode === 'compact'}
            onSelect={onSelectWorkspace}
            onRename={onRenameWorkspace}
            onClose={requestWorkspaceClose}
            onCreateWorktree={(parentId) => {
              const parent = workspaces.find((workspace) => workspace.id === parentId) ?? null;
              setWorktreeCreateParent(parent);
            }}
            worktreeEligibleWorkspaceIds={worktreeEligibleWorkspaceIds}
            onMove={onMoveWorkspace}
            onDuplicate={onDuplicateWorkspace}
            onCloseOthers={onCloseOtherWorkspaces}
            onReveal={onRevealWorkspace}
            renameWorkspaceRequestId={renameWorkspaceRequestId}
            onRenameWorkspaceRequestHandled={onRenameWorkspaceRequestHandled}
          />
        )}

        {mode === 'full' && visibleRecentDirectories.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgb(255 255 255 / 0.05)' }}>
            <div style={{ height: 22, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 0 12px' }}>
              <Clock3 size={11} strokeWidth={1.9} color="rgb(var(--aegis-text-dim))" />
              <span style={{ flex: 1, fontSize: 10, fontFamily: '"JetBrains Mono", monospace', color: 'rgb(var(--aegis-text-dim))', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {t('terminal.recentFolders')}
              </span>
              <button
                type="button"
                onClick={() => { void onClearRecentDirectories(); }}
                title={t('terminal.clearRecentFolders')}
                style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 4, color: 'rgb(var(--aegis-text-dim))', cursor: 'pointer', padding: 0 }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.08)'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-dim))'; }}
              >
                <Trash2 size={11} strokeWidth={1.9} />
              </button>
            </div>
            {visibleRecentDirectories.slice(0, 5).map((directory) => (
              <button
                type="button"
                key={directory.path}
                onClick={() => { void onOpenRecentDirectory(directory.path); }}
                title={directory.path}
                style={{
                  width: '100%', minWidth: 0, height: 38, display: 'flex', alignItems: 'center', gap: 8,
                  padding: '0 10px 0 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                  color: 'rgb(var(--aegis-text-dim))',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.05)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <Clock3 size={12} strokeWidth={1.8} style={{ flexShrink: 0, opacity: 0.72 }} />
                <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, fontFamily: '"JetBrains Mono", monospace', color: 'rgb(var(--aegis-text))' }}>{directory.name}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 9.5, fontFamily: '"JetBrains Mono", monospace', opacity: 0.68 }}>{directory.path}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      {/* ── 底部视图切换 / 打开目录（full 模式） ── */}
      {mode === 'full' && (
        <>
          <div style={{ height: 1, background: 'rgb(255 255 255 / 0.05)', flexShrink: 0 }} />
          <div style={{ height: 34, display: 'flex', alignItems: 'center', gap: 2, padding: '0 6px' }}>
            <button
              type="button"
              onClick={() => onContentChange('workspaces')}
              title={t('terminal.workspaceList')}
              aria-pressed={content === 'workspaces'}
              style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', background: content === 'workspaces' ? 'rgb(var(--aegis-primary) / 0.14)' : 'transparent', border: content === 'workspaces' ? '1px solid rgb(var(--aegis-primary) / 0.28)' : '1px solid transparent', borderRadius: 5, color: content === 'workspaces' ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text-dim))', cursor: 'pointer' }}
              onMouseEnter={(event) => { if (content !== 'workspaces') (event.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay) / 0.08)'; }}
              onMouseLeave={(event) => { if (content !== 'workspaces') (event.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <Layers size={13} strokeWidth={1.9} />
            </button>
            <button
              type="button"
              onClick={() => onContentChange('files')}
              title={t('terminal.files')}
              aria-pressed={content === 'files'}
              style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', background: content === 'files' ? 'rgb(var(--aegis-primary) / 0.14)' : 'transparent', border: content === 'files' ? '1px solid rgb(var(--aegis-primary) / 0.28)' : '1px solid transparent', borderRadius: 5, color: content === 'files' ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text-dim))', cursor: 'pointer' }}
              onMouseEnter={(event) => { if (content !== 'files') (event.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay) / 0.08)'; }}
              onMouseLeave={(event) => { if (content !== 'files') (event.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <FolderTree size={13} strokeWidth={1.9} />
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onOpenFolder}
              title={t('terminal.openFolder')}
              style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 5, color: 'rgb(var(--aegis-text-dim))', cursor: 'pointer' }}
              onMouseEnter={(event) => { (event.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay) / 0.08)'; (event.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; }}
              onMouseLeave={(event) => { (event.currentTarget as HTMLElement).style.background = 'transparent'; (event.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-dim))'; }}
            >
              <FolderOpen size={13} strokeWidth={1.9} />
            </button>
          </div>
        </>
      )}
      {mode === 'full' && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('terminal.resizeSidebar', 'Resize sidebar')}
          aria-valuemin={TERMINAL_SIDEBAR_MIN_WIDTH}
          aria-valuemax={TERMINAL_SIDEBAR_MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          title={t('terminal.resizeSidebar', 'Resize sidebar')}
          onDoubleClick={() => onWidthChange(TERMINAL_SIDEBAR_MIN_WIDTH)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const delta = event.key === 'ArrowRight' ? 10 : -10;
            const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? 'rtl' : 'ltr';
            onWidthChange(resizeTerminalSidebarWidth(width, delta, direction));
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            resizeStateRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startWidth: width,
              direction: getComputedStyle(event.currentTarget).direction === 'rtl' ? 'rtl' : 'ltr',
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            setResizing(true);
            onResizeActiveChange(true);
          }}
          onPointerMove={(event) => {
            const state = resizeStateRef.current;
            if (!state || state.pointerId !== event.pointerId) return;
            onWidthChange(resizeTerminalSidebarWidth(
              state.startWidth,
              event.clientX - state.startX,
              state.direction,
            ));
          }}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onLostPointerCapture={finishResize}
          style={{
            position: 'absolute', insetBlock: 0, insetInlineEnd: 0, zIndex: 20,
            width: 7, cursor: 'col-resize', touchAction: 'none',
            background: resizing ? 'rgb(var(--aegis-primary) / 0.35)' : 'transparent',
          }}
        />
      )}
      {worktreeCreateParent && (
        <TerminalWorktreeCreateDialog
          workspace={worktreeCreateParent}
          onClose={() => setWorktreeCreateParent(null)}
          onCreate={async (branch) => {
            await onCreateWorktree(worktreeCreateParent.id, branch);
            setWorktreeCreateParent(null);
          }}
        />
      )}
      {sshWorkspaceDialogOpen && (
        <TerminalSshWorkspaceDialog
          onClose={() => setSshWorkspaceDialogOpen(false)}
          onCreate={(host) => {
            onCreateSshWorkspace(host);
            setSshWorkspaceDialogOpen(false);
          }}
        />
      )}
      {worktreeRemoval && (
        <TerminalWorktreeCloseDialog
          workspace={worktreeRemoval}
          onClose={() => setWorktreeRemoval(null)}
          onConfirm={async (deleteOnDisk) => {
            await onCloseWorktree(worktreeRemoval, deleteOnDisk);
            setWorktreeRemoval(null);
          }}
        />
      )}
      {worktreeFamilyRemoval && (
        <TerminalWorktreeFamilyCloseDialog
          workspace={worktreeFamilyRemoval}
          worktreeCount={workspaces.filter((workspace) => workspace.worktreeParentId === worktreeFamilyRemoval.id).length}
          onClose={() => setWorktreeFamilyRemoval(null)}
          onConfirm={() => {
            onCloseWorkspace(worktreeFamilyRemoval.id);
            setWorktreeFamilyRemoval(null);
          }}
        />
      )}
    </div>
  );
}

function TerminalWorktreeCreateDialog({ workspace, onClose, onCreate }: {
  workspace: Workspace;
  onClose: () => void;
  onCreate: (branch: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [branch, setBranch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    const value = branch.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={t('terminal.worktreeCreate')} style={terminalModalBackdropStyle} onMouseDown={onClose}>
      <div style={terminalModalStyle} onMouseDown={(event) => event.stopPropagation()}>
        <div style={terminalModalEyebrowStyle}>CREATE-WORKTREE</div>
        <div style={terminalModalTitleStyle}>{workspace.name}</div>
        <div style={terminalModalPathStyle}>{workspace.projectDirectory || workspace.workingDirectory}</div>
        <label style={terminalModalLabelStyle}>
          {t('terminal.worktreeBranch')}
          <input ref={inputRef} value={branch} onChange={(event) => setBranch(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') onClose(); if (event.key === 'Enter') void submit(); }}
            placeholder={t('terminal.worktreeBranchPlaceholder')} style={terminalModalInputStyle} />
        </label>
        {error && <div style={{ color: 'rgb(239 68 68)', fontSize: 11, lineHeight: 1.45 }}>{error}</div>}
        <div style={terminalModalActionsStyle}>
          <button type="button" onClick={onClose} disabled={submitting} style={terminalModalSecondaryButtonStyle}>{t('common.cancel', 'Cancel')}</button>
          <button type="button" onClick={() => void submit()} disabled={!branch.trim() || submitting} style={terminalModalPrimaryButtonStyle}>{submitting ? t('common.creating', 'Creating...') : t('terminal.worktreeCreate')}</button>
        </div>
      </div>
    </div>
  );
}

function TerminalSshWorkspaceDialog({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (host: string) => void;
}) {
  const { t } = useTranslation();
  const [host, setHost] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const submit = () => {
    const destination = host.trim();
    if (!destination || /[\u0000-\u001f\u007f]/.test(destination)) {
      setError(t('terminal.sshWorkspaceInvalid'));
      return;
    }
    onCreate(destination);
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={t('terminal.sshWorkspaceCreate')} style={terminalModalBackdropStyle} onMouseDown={onClose}>
      <div style={terminalModalStyle} onMouseDown={(event) => event.stopPropagation()}>
        <div style={terminalModalEyebrowStyle}>SSH-WORKSPACE</div>
        <div style={terminalModalTitleStyle}>{t('terminal.sshWorkspaceTitle')}</div>
        <div style={{ color: 'rgb(var(--aegis-text-dim))', fontSize: 11.5, lineHeight: 1.5 }}>{t('terminal.sshWorkspaceDescription')}</div>
        <label style={terminalModalLabelStyle}>
          {t('terminal.sshWorkspaceHost')}
          <input
            ref={inputRef}
            value={host}
            onChange={(event) => { setHost(event.target.value); setError(null); }}
            onKeyDown={(event) => { if (event.key === 'Escape') onClose(); if (event.key === 'Enter') submit(); }}
            placeholder="user@host"
            style={terminalModalInputStyle}
          />
        </label>
        {error && <div style={{ color: 'rgb(239 68 68)', fontSize: 11, lineHeight: 1.45 }}>{error}</div>}
        <div style={terminalModalActionsStyle}>
          <button type="button" onClick={onClose} style={terminalModalSecondaryButtonStyle}>{t('common.cancel', 'Cancel')}</button>
          <button type="button" onClick={submit} disabled={!host.trim()} style={terminalModalPrimaryButtonStyle}>{t('terminal.sshWorkspaceCreate')}</button>
        </div>
      </div>
    </div>
  );
}

function TerminalWorktreeCloseDialog({ workspace, onClose, onConfirm }: {
  workspace: Workspace;
  onClose: () => void;
  onConfirm: (deleteOnDisk: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [deleteOnDisk, setDeleteOnDisk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(deleteOnDisk);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={t('terminal.worktreeClose')} style={terminalModalBackdropStyle} onMouseDown={onClose}>
      <div style={terminalModalStyle} onMouseDown={(event) => event.stopPropagation()}>
        <div style={terminalModalEyebrowStyle}>CLOSE-WORKTREE</div>
        <div style={terminalModalTitleStyle}>{workspace.name}</div>
        <div style={terminalModalPathStyle}>{workspace.worktreePath || workspace.workingDirectory}</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgb(var(--aegis-text-dim))', fontSize: 11.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={deleteOnDisk} onChange={(event) => setDeleteOnDisk(event.target.checked)} disabled={submitting} />
          {t('terminal.worktreeDeleteOnClose')}
        </label>
        {error && <div style={{ color: 'rgb(239 68 68)', fontSize: 11, lineHeight: 1.45 }}>{error}</div>}
        <div style={terminalModalActionsStyle}>
          <button type="button" onClick={onClose} disabled={submitting} style={terminalModalSecondaryButtonStyle}>{t('common.cancel', 'Cancel')}</button>
          <button type="button" onClick={() => void submit()} disabled={submitting} style={{ ...terminalModalPrimaryButtonStyle, background: deleteOnDisk ? 'rgb(239 68 68)' : 'rgb(var(--aegis-primary))' }}>{submitting ? t('common.working', 'Working...') : deleteOnDisk ? t('terminal.worktreeCloseAndDelete') : t('terminal.worktreeClose')}</button>
        </div>
      </div>
    </div>
  );
}

function TerminalWorktreeFamilyCloseDialog({ workspace, worktreeCount, onClose, onConfirm }: {
  workspace: Workspace;
  worktreeCount: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="dialog" aria-modal="true" aria-label={t('terminal.worktreeCloseFamily')} style={terminalModalBackdropStyle} onMouseDown={onClose}>
      <div style={terminalModalStyle} onMouseDown={(event) => event.stopPropagation()}>
        <div style={terminalModalEyebrowStyle}>CLOSE-WORKSPACE</div>
        <div style={terminalModalTitleStyle}>{workspace.name}</div>
        <div style={{ color: 'rgb(var(--aegis-text-dim))', fontSize: 11.5, lineHeight: 1.5 }}>
          {t('terminal.worktreeCloseFamilyDescription', { count: worktreeCount })}
        </div>
        <div style={terminalModalPathStyle}>{workspace.projectDirectory || workspace.workingDirectory}</div>
        <div style={terminalModalActionsStyle}>
          <button type="button" onClick={onClose} style={terminalModalSecondaryButtonStyle}>{t('common.cancel', 'Cancel')}</button>
          <button type="button" onClick={onConfirm} style={terminalModalPrimaryButtonStyle}>{t('terminal.worktreeCloseFamily')}</button>
        </div>
      </div>
    </div>
  );
}

const terminalModalBackdropStyle: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgb(0 0 0 / 0.42)', padding: 20 };
const terminalModalStyle: React.CSSProperties = { width: 'min(440px, 100%)', display: 'flex', flexDirection: 'column', gap: 14, padding: 24, borderRadius: 8, background: 'rgb(var(--aegis-elevated))', border: '1px solid rgb(var(--aegis-overlay) / 0.16)', boxShadow: '0 18px 52px rgb(0 0 0 / 0.38)' };
const terminalModalEyebrowStyle: React.CSSProperties = { color: 'rgb(var(--aegis-text-dim))', fontFamily: '"JetBrains Mono", monospace', fontSize: 10, letterSpacing: '0.12em' };
const terminalModalTitleStyle: React.CSSProperties = { color: 'rgb(var(--aegis-text))', fontSize: 17, fontWeight: 600 };
const terminalModalPathStyle: React.CSSProperties = { color: 'rgb(var(--aegis-text-dim))', fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const terminalModalLabelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, color: 'rgb(var(--aegis-text-dim))', fontSize: 11.5 };
const terminalModalInputStyle: React.CSSProperties = { height: 32, borderRadius: 4, border: '1px solid rgb(var(--aegis-primary) / 0.45)', background: 'rgb(var(--aegis-surface))', color: 'rgb(var(--aegis-text))', padding: '0 9px', outline: 'none', fontFamily: '"JetBrains Mono", monospace', fontSize: 12 };
const terminalModalActionsStyle: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 };
const terminalModalSecondaryButtonStyle: React.CSSProperties = { height: 30, padding: '0 12px', border: '1px solid rgb(var(--aegis-overlay) / 0.16)', borderRadius: 4, background: 'transparent', color: 'rgb(var(--aegis-text-dim))', cursor: 'pointer', fontSize: 11.5 };
const terminalModalPrimaryButtonStyle: React.CSSProperties = { height: 30, padding: '0 12px', border: 'none', borderRadius: 4, background: 'rgb(var(--aegis-primary))', color: '#fff', cursor: 'pointer', fontSize: 11.5 };


// ──────────────────────────────────────────────────────────────
// kooky CommandPaletteWindowController 1:1 port — fuzzy search, arrow key nav
// Supported item kinds: workspace switch, new workspace.
// Fuzzy scorer: prefix +10, word-boundary +5, consecutive chars +3.
// ──────────────────────────────────────────────────────────────

/** Simple fuzzy score: higher is better match, -Infinity means no match. */
function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let qi = 0;
  let lastMatch = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // consecutive bonus
      if (lastMatch === ti - 1) score += 3;
      // word boundary bonus
      if (ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === '-' || t[ti - 1] === '_' || t[ti - 1] === '/') score += 5;
      // prefix bonus
      if (ti === 0) score += 10;
      score += 1;
      lastMatch = ti;
      qi++;
    }
  }
  // Must match all query chars
  if (qi < q.length) return -Infinity;
  return score;
}

interface PaletteItem {
  id: string;
  label: string;
  subtitle?: string;
  path?: string;
  kind: 'workspace' | 'new-workspace' | 'open-folder' | 'recent-folder';
}

function CommandPaletteModal({
  open, onClose, workspaces, recentDirectories, onSelectWorkspace, onCreateWorkspace,
  onOpenFolder, onOpenRecentDirectory,
}: {
  open: boolean;
  onClose: () => void;
  workspaces: Workspace[];
  recentDirectories: TerminalWorkspaceDirectory[];
  onSelectWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
  onOpenFolder: () => void | Promise<unknown>;
  onOpenRecentDirectory: (path: string) => void | Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 50); setQuery(''); setSelectedIdx(0); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Build scored, sorted items
  const items = useMemo((): PaletteItem[] => {
    const openFolder: PaletteItem = {
      id: '__open-folder__',
      label: t('terminal.openFolder'),
      subtitle: t('terminal.openFolderDescription'),
      kind: 'open-folder',
    };
    const ws: PaletteItem[] = workspaces.map((workspace) => ({
      id: workspace.id,
      label: workspace.name || t('terminal.workspaceDefault'),
      subtitle: workspace.projectDirectory || workspace.workingDirectory || undefined,
      kind: 'workspace',
    }));
    const openWorkspacePaths = new Set(workspaces.map(
      (workspace) => workspace.projectDirectory || workspace.workingDirectory,
    ));
    const recent: PaletteItem[] = recentDirectories
      .filter((directory) => !openWorkspacePaths.has(directory.path))
      .map((directory) => ({
        id: `recent-${directory.path}`,
        label: directory.name,
        subtitle: directory.path,
        path: directory.path,
        kind: 'recent-folder',
      }));
    const newWs: PaletteItem = {
      id: '__new__',
      label: t('terminal.workspaceNew'),
      subtitle: t('terminal.newWorkspaceDescription'),
      kind: 'new-workspace',
    };
    const candidates = [openFolder, ...ws, ...recent, newWs];
    if (!query) return candidates;
    return candidates
      .map((item) => ({ item, score: fuzzyScore(query, `${item.label} ${item.subtitle ?? ''}`) }))
      .filter((x) => x.score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }, [query, recentDirectories, t, workspaces]);

  // Clamp selectedIdx
  useEffect(() => {
    setSelectedIdx((prev) => Math.min(prev, Math.max(0, items.length - 1)));
  }, [items.length]);

  const activateItem = useCallback((item: PaletteItem) => {
    switch (item.kind) {
      case 'workspace':
        onSelectWorkspace(item.id);
        break;
      case 'new-workspace':
        void onCreateWorkspace();
        break;
      case 'open-folder':
        void onOpenFolder();
        break;
      case 'recent-folder':
        if (item.path) void onOpenRecentDirectory(item.path);
        break;
    }
    onClose();
  }, [onClose, onCreateWorkspace, onOpenFolder, onOpenRecentDirectory, onSelectWorkspace]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[selectedIdx];
      if (item) activateItem(item);
    }
  }, [activateItem, items, selectedIdx]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgb(0 0 0 / 0.5)' }} />
      <div style={{
        position: 'fixed', top: '18%', left: '50%', transform: 'translateX(-50%)',
        zIndex: 1000, width: 500, maxHeight: 420,
        background: 'rgb(var(--aegis-elevated))',
        border: '1px solid rgb(255 255 255 / 0.12)',
        borderRadius: 10, boxShadow: '0 20px 60px rgb(0 0 0 / 0.6)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid rgb(255 255 255 / 0.07)' }}>
          <Search size={14} strokeWidth={2.3} color="rgb(var(--aegis-text-dim))" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder={t('terminal.searchWorkspace', '搜索工作区、操作…')}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 13, fontFamily: '"JetBrains Mono", monospace',
              color: 'rgb(var(--aegis-text))',
            }}
          />
          <span style={{ fontSize: 10, color: 'rgb(var(--aegis-text-dim))', opacity: 0.5 }}>{t('terminal.paletteCloseHint')}</span>
        </div>
        {/* Results */}
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {items.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'rgb(var(--aegis-text-dim))', fontSize: 12, fontFamily: '"JetBrains Mono", monospace' }}>
              {t('terminal.noResults')}
            </div>
          )}
          {items.map((item, idx) => {
            const isSelected = idx === selectedIdx;
            const isNew = item.kind === 'new-workspace';
            const isAction = item.kind === 'new-workspace' || item.kind === 'open-folder';
            const icon = item.kind === 'new-workspace'
              ? <Plus size={14} strokeWidth={2.2} />
              : item.kind === 'open-folder'
                ? <FolderOpen size={14} strokeWidth={2} />
                : item.kind === 'recent-folder'
                  ? <Clock3 size={14} strokeWidth={1.9} />
                  : <FolderOpen size={14} strokeWidth={1.9} />;
            return (
              <div
                key={item.id}
                onClick={() => activateItem(item)}
                onMouseEnter={() => setSelectedIdx(idx)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '0 14px', minHeight: item.subtitle ? 46 : 40, cursor: 'pointer',
                  background: isSelected ? 'rgb(var(--aegis-overlay)/0.10)' : 'transparent',
                  borderTop: isNew ? '1px solid rgb(255 255 255 / 0.07)' : 'none',
                  marginTop: isNew ? 4 : 0,
                }}
              >
                <span style={{ display: 'flex', color: isAction ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text-dim))', flexShrink: 0 }}>
                  {icon}
                </span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: item.subtitle ? 2 : 0 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontFamily: '"JetBrains Mono", monospace', color: isAction ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text))' }}>
                    {item.label}
                  </span>
                  {item.subtitle && (
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, fontFamily: '"JetBrains Mono", monospace', color: 'rgb(var(--aegis-text-dim))', opacity: 0.72 }}>
                      {item.subtitle}
                    </span>
                  )}
                </span>
                {isSelected && (
                  <Check size={13} strokeWidth={2} color="rgb(var(--aegis-text-dim))" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
