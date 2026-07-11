// Terminal Workspace — Multi-session terminal with workspace management
// + optional right panel (agents overview)

import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/useTheme";
import {
  ShellTerminalPanel,
} from "@/components/Terminal";
import { PaneTreeView } from "@/components/Terminal/PaneTreeView";
import { TerminalWorkspaceFiles } from "@/components/Terminal/TerminalWorkspaceFiles";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, Clock3, FolderOpen, FolderTree, Layers, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import type { ThemeVariant, TerminalFontSize, FontFamily } from "@/_nezha_root/types";
import type { Workspace } from "@/workspace/types";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  getDefaultMonoFont,
} from "@/_nezha_root/types";

interface TerminalWorkspaceDirectory {
  path: string;
  name: string;
}

type TerminalSidebarContent = 'workspaces' | 'files';

export function TerminalPage() {
  const { t } = useTranslation();
  const resolvedTheme = useTheme();
  const themeVariant: ThemeVariant = resolvedTheme.replace("aegis-", "") as ThemeVariant;

  const terminalFontSize: TerminalFontSize = DEFAULT_TERMINAL_FONT_SIZE;
  const monoFontFamily: FontFamily = getDefaultMonoFont();
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

  type SidebarMode = 'full' | 'compact' | 'hidden';
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() => {
    try {
      const saved = localStorage.getItem('junqi:terminal-sidebar-mode');
      return saved === 'full' || saved === 'compact' || saved === 'hidden' ? saved : 'hidden';
    } catch { return 'hidden'; }
  });
  useEffect(() => {
    try { localStorage.setItem('junqi:terminal-sidebar-mode', sidebarMode); } catch {}
  }, [sidebarMode]);
  const cycleSidebarMode = () => setSidebarMode((m) =>
    m === 'hidden' ? 'full' : m === 'full' ? 'compact' : 'hidden'
  );
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
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ command: string; projectPath?: string }>;
      const cmd = ce.detail?.command;
      if (!cmd) return;
      window.dispatchEvent(new CustomEvent('junqi:deliver-terminal-command', {
        detail: { command: cmd, projectPath: ce.detail?.projectPath },
      }));
    };
    window.addEventListener("junqi:run-terminal-command", handler);
    return () => window.removeEventListener("junqi:run-terminal-command", handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>

        {sidebarMode !== "hidden" && (
          <WorkspaceSidebarPanel
            mode={sidebarMode}
            content={sidebarContent}
            onContentChange={setSidebarContent}
            projectPath={workspace?.workingDirectory || projectPath}
            workspaces={workspaces}
            recentDirectories={recentDirectories}
            activeWorkspaceId={activeWorkspaceId}
            onSelectWorkspace={(id) => useWorkspaceStore.getState().setActive(id)}
            onCreateWorkspace={createWorkspace}
            onOpenFolder={chooseWorkspaceDirectory}
            onOpenRecentDirectory={openWorkspaceDirectory}
            onClearRecentDirectories={clearRecentDirectories}
            onCloseWorkspace={(id) => useWorkspaceStore.getState().closeWorkspace(id)}
            onRenameWorkspace={(id, name) => useWorkspaceStore.getState().renameWorkspace(id, name)}
          />
        )}

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>

          <div ref={termWrapRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {workspace ? (
              <PaneTreeView
                workspace={workspace}
                themeVariant={themeVariant}
                terminalFontSize={terminalFontSize}
                monoFontFamily={monoFontFamily}
                projectPath={workspace?.workingDirectory || projectPath}
                onToggleSidebar={cycleSidebarMode}
                sidebarActive={sidebarMode !== 'hidden'}
              />
            ) : (
              <ShellTerminalPanel
                themeVariant={themeVariant}
                terminalFontSize={terminalFontSize}
                monoFontFamily={monoFontFamily}
                projectPath={projectPath}
                projectId="default"
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

// ── WorkspaceRow — workspace item in sidebar with inline rename (kooky SidebarWorkspaceRow) ──
// ──────────────────────────────────────────────────────────────
// WorkspaceRow — redesigned kooky SidebarWorkspaceRow
// full: 左边框激活态 + 首字母badge + 名称 + hover显关闭
// compact: 首字母圆形badge + hover tooltip
// 右键菜单: 重命名 / 关闭 / 关闭其他 / 复制
// ──────────────────────────────────────────────────────────────
function WorkspaceRow({ ws, isActive, mode, index, totalCount, onSelect, onRename, onClose, onCloseOthers, onDuplicate }: {
  ws: { id: string; name: string };
  isActive: boolean;
  mode: 'full' | 'compact';
  index: number;
  totalCount: number;
  onSelect: () => void;
  onRename?: (name: string) => void;
  onClose?: () => void;
  onCloseOthers?: () => void;
  onDuplicate?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const displayName = ws.name?.trim() || t('terminal.workspaceDefault');
  // 首字母 badge：取前两个有效字符（忽略特殊符号）
  const initials = displayName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').slice(0, 2).toUpperCase() || '#';

  useEffect(() => {
    if (renaming && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [renaming]);

  useEffect(() => {
    if (!ctxMenu) return;
    const h = (e: MouseEvent) => { setCtxMenu(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ctxMenu]);

  const commitRename = () => {
    const v = renameVal.trim();
    if (v) onRename?.(v);
    setRenaming(false);
  };

  const startRename = () => { setRenameVal(displayName); setRenaming(true); setCtxMenu(null); };

  // ── compact 模式 ──────────────────────────────────────────
  if (mode === 'compact') {
    return (
      <div
        onClick={() => onSelect()}
        title={displayName}
        style={{
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 36, height: 36, margin: '2px 8px', borderRadius: 8,
          cursor: 'pointer', flexShrink: 0,
          background: isActive ? 'rgb(var(--aegis-primary)/0.15)' : 'transparent',
          border: isActive ? '1px solid rgb(var(--aegis-primary)/0.35)' : '1px solid transparent',
          transition: 'background 0.12s, border-color 0.12s',
        }}
        onMouseEnter={(e) => { setHovered(true); if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.08)'; }}
        onMouseLeave={(e) => { setHovered(false); if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {/* 首字母 badge */}
        <span style={{
          fontSize: 11, fontWeight: 700, fontFamily: '"JetBrains Mono", monospace',
          color: isActive ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text-dim))',
          lineHeight: 1, userSelect: 'none',
        }}>{initials}</span>
        {/* 激活圆点 */}
        {isActive && (
          <span style={{
            position: 'absolute', bottom: 4, right: 4,
            width: 5, height: 5, borderRadius: '50%',
            background: 'rgb(var(--aegis-primary))',
            boxShadow: '0 0 5px rgb(var(--aegis-primary)/0.7)',
          }} />
        )}
        {/* Tooltip */}
        {hovered && (
          <div style={{
            position: 'absolute', left: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)',
            zIndex: 400, padding: '4px 8px', borderRadius: 5,
            background: 'rgb(var(--aegis-elevated))',
            border: '1px solid rgb(255 255 255 / 0.10)',
            boxShadow: '0 4px 16px rgb(0 0 0 / 0.4)',
            fontSize: 11, fontFamily: '"JetBrains Mono", monospace',
            color: 'rgb(var(--aegis-text))', whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}>
            {displayName}
          </div>
        )}
      </div>
    );
  }

  // ── full 模式 ─────────────────────────────────────────────
  return (
    <>
      <div
        ref={rowRef}
        onClick={() => { if (!renaming) onSelect(); }}
        onDoubleClick={() => { if (onRename && !renaming) { setRenameVal(displayName); setRenaming(true); } }}
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'relative',
          display: 'flex', alignItems: 'center', gap: 8,
          height: 38, paddingLeft: 12, paddingRight: 8,
          cursor: 'pointer',
          background: isActive
            ? 'rgb(var(--aegis-primary)/0.08)'
            : hovered ? 'rgb(var(--aegis-overlay)/0.05)' : 'transparent',
          borderLeft: `3px solid ${isActive ? 'rgb(var(--aegis-primary))' : 'transparent'}`,
          transition: 'background 0.1s',
        }}
      >
        {/* 首字母 badge */}
        <div style={{
          width: 24, height: 24, borderRadius: 6, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isActive ? 'rgb(var(--aegis-primary)/0.18)' : 'rgb(var(--aegis-overlay)/0.08)',
          border: `1px solid ${isActive ? 'rgb(var(--aegis-primary)/0.3)' : 'rgb(255 255 255 / 0.06)'}`,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, lineHeight: 1,
            fontFamily: '"JetBrains Mono", monospace',
            color: isActive ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text-dim))',
            userSelect: 'none',
          }}>{initials}</span>
        </div>

        {/* 名称 or 重命名输入框 */}
        {renaming ? (
          <input
            ref={inputRef}
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              flex: 1, fontSize: 12, fontFamily: '"JetBrains Mono", monospace',
              background: 'rgb(var(--aegis-surface))',
              border: '1px solid rgb(var(--aegis-primary)/0.5)',
              borderRadius: 4, color: 'rgb(var(--aegis-text))',
              padding: '0 6px', height: 24, outline: 'none',
            }}
          />
        ) : (
          <span style={{
            flex: 1, fontSize: 12, fontFamily: '"JetBrains Mono", monospace',
            fontWeight: isActive ? 500 : 400,
            color: isActive ? 'rgb(var(--aegis-text))' : 'rgb(var(--aegis-text-dim))',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{displayName}</span>
        )}

        {/* 序号（仅非激活，非 hover 时） */}
        {!isActive && !hovered && !renaming && (
          <span style={{
            fontSize: 10, color: 'rgb(var(--aegis-text-dim))', opacity: 0.4,
            fontFamily: '"JetBrains Mono", monospace', flexShrink: 0,
          }}>{index + 1}</span>
        )}

        {/* 关闭按钮（hover 时显示） */}
        {(hovered || isActive) && !renaming && onClose && (
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            title={t('terminal.workspaceClose')}
            style={{
              width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', borderRadius: 3, cursor: 'pointer',
              color: 'rgb(var(--aegis-text-dim))', flexShrink: 0, padding: 0,
              opacity: hovered ? 0.7 : 0.4,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.12)'; (e.currentTarget as HTMLElement).style.opacity = '1'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.opacity = hovered ? '0.7' : '0.4'; }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* 右键菜单 */}
      {ctxMenu && (
        <div
          style={{
            position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 500,
            background: 'rgb(var(--aegis-elevated))',
            border: '1px solid rgb(255 255 255 / 0.09)',
            borderRadius: 7, boxShadow: '0 8px 28px rgb(0 0 0 / 0.45)',
            padding: '4px 0', minWidth: 160,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {[
            onRename && { label: t('terminal.workspaceRename'), action: startRename, icon: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' },
            onDuplicate && { label: t('terminal.workspaceDuplicate'), action: () => { onDuplicate(); setCtxMenu(null); }, icon: 'M8 17l4 4 4-4m-4-5v9M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10' },
            totalCount > 1 && onCloseOthers && { label: t('terminal.workspaceCloseOthers'), action: () => { onCloseOthers(); setCtxMenu(null); }, icon: 'M18 6L6 18M6 6l12 12' },
            totalCount > 1 && onClose && { label: t('terminal.workspaceClose'), action: () => { onClose(); setCtxMenu(null); }, icon: 'M18 6L6 18M6 6l12 12', danger: true },
          ].filter(Boolean).map((item: any, i) => (
            <button
              key={i}
              onClick={item.action}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '5px 12px', background: 'transparent', border: 'none',
                cursor: 'pointer', textAlign: 'left' as const,
                fontSize: 11.5, fontFamily: '"JetBrains Mono", monospace',
                color: item.danger ? 'rgb(239 68 68)' : 'rgb(var(--aegis-text))',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = item.danger ? 'rgb(239 68 68 / 0.08)' : 'rgb(var(--aegis-overlay)/0.07)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.6">
                <path d={item.icon}/>
              </svg>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}


interface ProjectStatusPanelState {
  node?: string | null;
  go?: string | null;
  branch?: string | null;
  files?: number;
  insertions?: number;
  deletions?: number;
}

function ProjectStatusPanel({ projectPath, mode }: { projectPath: string; mode: 'full' | 'compact' }) {
  const [status, setStatus] = useState<ProjectStatusPanelState>({});

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const next: ProjectStatusPanelState = {};
      try {
        const env = await invoke<{ node_version: string | null; go_version: string | null }>('get_terminal_env', { projectPath });
        next.node = env.node_version;
        next.go = env.go_version;
      } catch {}
      try {
        const branches = await invoke<{ name: string; current: boolean }[]>('git_list_branches', { projectPath });
        next.branch = branches.find((b) => b.current)?.name ?? null;
      } catch {}
      try {
        const diff = await invoke<{ files_changed: number; insertions: number; deletions: number }>('git_diff_shortstat', { projectPath });
        next.files = diff.files_changed;
        next.insertions = diff.insertions;
        next.deletions = diff.deletions;
      } catch {}
      if (!cancelled) setStatus(next);
    };
    void refresh();
    const timer = setInterval(refresh, 8000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [projectPath]);

  const hasGit = !!status.branch;
  if (mode === 'compact') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '8px 0', borderBottom: '1px solid rgb(255 255 255 / 0.06)' }}>
        <StatusDot label="node" ok={!!status.node} />
        <StatusDot label="go" ok={!!status.go} />
        <StatusDot label="git" ok={hasGit} />
      </div>
    );
  }
  return (
    <div style={{ padding: '8px 10px 7px', borderBottom: '1px solid rgb(255 255 255 / 0.06)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        <StatusPill label="node" value={status.node || '—'} ok={!!status.node} />
        <StatusPill label="go" value={status.go || '—'} ok={!!status.go} />
        <StatusPill label="git" value={status.branch || '—'} ok={hasGit} />
      </div>
      {hasGit && (status.files || 0) > 0 && (
        <div style={{ marginTop: 6, fontSize: 10, fontFamily: '"JetBrains Mono", monospace', color: 'rgb(var(--aegis-text-dim))' }}>
          {status.files} files <span style={{ color: 'rgb(34 197 94)' }}>+{status.insertions || 0}</span> <span style={{ color: 'rgb(239 68 68)' }}>-{status.deletions || 0}</span>
        </div>
      )}
    </div>
  );
}

function StatusPill({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return <span title={`${label}: ${value}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 6px', borderRadius: 5, border: '1px solid rgb(var(--aegis-overlay)/0.08)', fontSize: 10, fontFamily: '"JetBrains Mono", monospace', color: ok ? 'rgb(var(--aegis-text))' : 'rgb(var(--aegis-text-dim))', background: ok ? 'rgb(var(--aegis-overlay)/0.05)' : 'transparent', maxWidth: 96 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: ok ? 'rgb(34 197 94)' : 'rgb(var(--aegis-text-dim)/0.35)', flexShrink: 0 }} />{label}:{value}</span>;
}

function StatusDot({ label, ok }: { label: string; ok: boolean }) {
  return <span title={label} style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? 'rgb(34 197 94)' : 'rgb(var(--aegis-text-dim)/0.35)' }} />;
}

// ──────────────────────────────────────────────────────────────
// WorkspaceSidebarPanel — redesigned (full 220px / compact 52px)
// ──────────────────────────────────────────────────────────────
function WorkspaceSidebarPanel({
  mode, content, onContentChange, projectPath, workspaces, recentDirectories, activeWorkspaceId,
  onSelectWorkspace, onCreateWorkspace, onOpenFolder, onOpenRecentDirectory,
  onClearRecentDirectories, onCloseWorkspace, onRenameWorkspace,
}: {
  mode: 'full' | 'compact';
  content: TerminalSidebarContent;
  onContentChange: (content: TerminalSidebarContent) => void;
  projectPath: string;
  workspaces: Workspace[];
  recentDirectories: TerminalWorkspaceDirectory[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
  onOpenFolder: () => void;
  onOpenRecentDirectory: (path: string) => void | Promise<unknown>;
  onClearRecentDirectories: () => void | Promise<unknown>;
  onCloseWorkspace: (id: string) => void;
  onRenameWorkspace?: (id: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const width = mode === 'full' ? 220 : 52;
  const [fileTreeVersion, setFileTreeVersion] = useState(0);
  const openWorkspacePaths = new Set(workspaces.map((workspace) => workspace.workingDirectory));
  const visibleRecentDirectories = recentDirectories.filter((directory) => !openWorkspacePaths.has(directory.path));
  const showingFiles = content === 'files' && mode === 'full';
  const fileRootAvailable = projectPath !== '.';
  const fileRootName = projectPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || projectPath;

  return (
    <div style={{
      width, flexShrink: 0, display: 'flex', flexDirection: 'column',
      borderRight: '1px solid rgb(255 255 255 / 0.07)',
      background: 'rgb(var(--aegis-surface))',
      transition: 'width 0.18s cubic-bezier(0.22,1,0.36,1)',
      overflow: 'hidden',
    }}>
      <ProjectStatusPanel projectPath={projectPath} mode={mode} />

      {/* ── 标题栏 ─────────────────────────────────── */}
      {mode === 'full' ? (
        <div style={{
          height: 34, display: 'flex', alignItems: 'center',
          padding: '0 8px 0 12px', gap: 6, flexShrink: 0,
        }}>
          {showingFiles
            ? <FolderTree size={13} strokeWidth={1.8} color="rgb(var(--aegis-text-dim))" style={{ flexShrink: 0 }} />
            : <FolderOpen size={13} strokeWidth={1.8} color="rgb(var(--aegis-text-dim))" style={{ flexShrink: 0 }} />}
          <span style={{
            flex: 1, fontSize: 10, fontFamily: '"JetBrains Mono", monospace',
            color: 'rgb(var(--aegis-text-dim))', fontWeight: 600,
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>{showingFiles ? t('terminal.files') : t('terminal.workspaces', 'WORKSPACES')}</span>
          <button
            onClick={onOpenFolder}
            title={t('terminal.openFolder')}
            style={{
              width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', borderRadius: 5,
              color: 'rgb(var(--aegis-text-dim))', cursor: 'pointer',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.08)'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-dim))'; }}
          >
            <FolderOpen size={13} strokeWidth={2} />
          </button>
          {/* 新建按钮 */}
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
        </div>
      ) : (
        <div style={{ height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, flexShrink: 0 }}>
          <button
            onClick={onOpenFolder}
            title={t('terminal.openFolder')}
            style={{
              width: 24, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', borderRadius: 6,
              color: 'rgb(var(--aegis-text-dim))', cursor: 'pointer',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.08)'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-dim))'; }}
          >
            <FolderOpen size={13} strokeWidth={2} />
          </button>
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
        </div>
      )}

      {/* ── 分隔线 ───────────────────────────────── */}
      <div style={{ height: 1, flexShrink: 0, background: 'rgb(255 255 255 / 0.06)' }} />

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
            <TerminalWorkspaceFiles key={`${projectPath}:${fileTreeVersion}`} root={projectPath} />
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
          workspaces.map((ws, idx) => (
            <WorkspaceRow
              key={ws.id}
              ws={ws}
              isActive={ws.id === activeWorkspaceId}
              mode={mode}
              index={idx}
              totalCount={workspaces.length}
              onSelect={() => onSelectWorkspace(ws.id)}
              onClose={workspaces.length > 1 ? () => onCloseWorkspace(ws.id) : undefined}
              onCloseOthers={workspaces.length > 1 ? () => {
                workspaces.forEach((w) => { if (w.id !== ws.id) onCloseWorkspace(w.id); });
              } : undefined}
              onRename={onRenameWorkspace ? (name) => onRenameWorkspace(ws.id, name) : undefined}
            />
          ))
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
    </div>
  );
}


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
      subtitle: workspace.workingDirectory || undefined,
      kind: 'workspace',
    }));
    const openWorkspacePaths = new Set(workspaces.map((workspace) => workspace.workingDirectory));
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
