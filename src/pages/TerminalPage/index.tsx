// Terminal Workspace — Multi-session terminal with workspace management
// + optional right panel (agents overview)

import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/useTheme";
import {
  ShellTerminalPanel,
} from "@/components/Terminal";
import { PaneTreeView } from "@/components/Terminal/PaneTreeView";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeVariant, TerminalFontSize, FontFamily } from "@/_nezha_root/types";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  getDefaultMonoFont,
} from "@/_nezha_root/types";

export function TerminalPage() {
  const { t } = useTranslation();
  const resolvedTheme = useTheme();
  const themeVariant: ThemeVariant = resolvedTheme.replace("aegis-", "") as ThemeVariant;

  const terminalFontSize: TerminalFontSize = DEFAULT_TERMINAL_FONT_SIZE;
  const monoFontFamily: FontFamily = getDefaultMonoFont();
  const [projectPath, setProjectPath] = useState(".");
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

  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

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
            onModeChange={setSidebarMode}
            onToggleSidebar={cycleSidebarMode}
            projectPath={workspace?.workingDirectory || projectPath}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            onSelectWorkspace={(id) => useWorkspaceStore.getState().setActive(id)}
            onCreateWorkspace={() => useWorkspaceStore.getState().createWorkspace()}
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
                projectPath={projectPath}
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
        onSelectWorkspace={(id) => useWorkspaceStore.getState().setActive(id)}
        onCreateWorkspace={() => useWorkspaceStore.getState().createWorkspace()}
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
  mode, onModeChange, onToggleSidebar, projectPath, workspaces, activeWorkspaceId,
  onSelectWorkspace, onCreateWorkspace, onCloseWorkspace, onRenameWorkspace,
}: {
  mode: 'full' | 'compact';
  onModeChange: (m: 'full' | 'compact' | 'hidden') => void;
  onToggleSidebar?: () => void;
  projectPath: string;
  workspaces: Array<{ id: string; name: string; focusedPaneId: string; root: any }>;
  activeWorkspaceId: string | null;
  onSelectWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
  onCloseWorkspace: (id: string) => void;
  onRenameWorkspace?: (id: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const width = mode === 'full' ? 220 : 52;

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
          {/* 图标 */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--aegis-text-dim))" strokeWidth="2" style={{ flexShrink: 0 }}>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <span style={{
            flex: 1, fontSize: 10, fontFamily: '"JetBrains Mono", monospace',
            color: 'rgb(var(--aegis-text-dim))', fontWeight: 600,
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>{t('terminal.workspaces', 'WORKSPACES')}</span>
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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
      ) : (
        /* compact 顶部：只有新建按钮 */
        <div style={{ height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <button
            onClick={onCreateWorkspace}
            title={t('terminal.workspaceNew')}
            style={{
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', borderRadius: 6,
              color: 'rgb(var(--aegis-text-dim))', cursor: 'pointer',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.08)'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-dim))'; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
      )}

      {/* ── 分隔线 ───────────────────────────────── */}
      <div style={{ height: 1, flexShrink: 0, background: 'rgb(255 255 255 / 0.06)' }} />

      {/* ── 工作区列表 ──────────────────────────── */}
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
      </div>

      {/* ── 底部新建行（full 模式） ──────────────── */}
      {mode === 'full' && (
        <>
          <div style={{ height: 1, background: 'rgb(255 255 255 / 0.05)', flexShrink: 0 }} />
          <button
            onClick={onCreateWorkspace}
            style={{
              height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              background: 'transparent', border: 'none', cursor: 'pointer', width: '100%',
              color: 'rgb(var(--aegis-text-dim))', fontSize: 11,
              fontFamily: '"JetBrains Mono", monospace',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.05)'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-dim))'; }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {t('terminal.workspaceNew')}
          </button>
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
  kind: 'workspace' | 'new-workspace';
}

function CommandPaletteModal({
  open, onClose, workspaces, onSelectWorkspace, onCreateWorkspace,
}: {
  open: boolean;
  onClose: () => void;
  workspaces: Array<{ id: string; name: string }>;
  onSelectWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
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
    const ws: PaletteItem[] = workspaces.map((w) => ({
      id: w.id, label: w.name || '新工作区', kind: 'workspace',
    }));
    const newWs: PaletteItem = { id: '__new__', label: '新建工作区', kind: 'new-workspace' };
    if (!query) return [...ws, newWs];
    const scored = ws
      .map((item) => ({ item, score: fuzzyScore(query, item.label) }))
      .filter((x) => x.score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
    // "new workspace" only if query roughly matches
    if (fuzzyScore(query, '新建工作区') > -Infinity || fuzzyScore(query, 'new workspace') > -Infinity) {
      scored.push(newWs);
    }
    return scored;
  }, [query, workspaces]);

  // Clamp selectedIdx
  useEffect(() => {
    setSelectedIdx((prev) => Math.min(prev, Math.max(0, items.length - 1)));
  }, [items.length]);

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
      if (item) {
        if (item.kind === 'new-workspace') { onCreateWorkspace(); }
        else { onSelectWorkspace(item.id); }
        onClose();
      }
    }
  }, [items, selectedIdx, onSelectWorkspace, onCreateWorkspace, onClose]);

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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--aegis-text-dim))" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
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
          <span style={{ fontSize: 10, color: 'rgb(var(--aegis-text-dim))', opacity: 0.5 }}>ESC 关闭</span>
        </div>
        {/* Results */}
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {items.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'rgb(var(--aegis-text-dim))', fontSize: 12, fontFamily: '"JetBrains Mono", monospace' }}>
              无结果
            </div>
          )}
          {items.map((item, idx) => {
            const isSelected = idx === selectedIdx;
            const isNew = item.kind === 'new-workspace';
            return (
              <div
                key={item.id}
                onClick={() => {
                  if (isNew) onCreateWorkspace(); else onSelectWorkspace(item.id);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIdx(idx)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '0 14px', height: 40, cursor: 'pointer',
                  background: isSelected ? 'rgb(var(--aegis-overlay)/0.10)' : 'transparent',
                  borderTop: isNew ? '1px solid rgb(255 255 255 / 0.07)' : 'none',
                  marginTop: isNew ? 4 : 0,
                }}
              >
                {isNew ? (
                  <span style={{ fontSize: 14, color: 'rgb(var(--aegis-primary))' }}>+</span>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--aegis-text-dim))" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                )}
                <span style={{
                  fontSize: 12, fontFamily: '"JetBrains Mono", monospace',
                  color: isNew ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text))',
                  flex: 1,
                }}>
                  {item.label}
                </span>
                {isSelected && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--aegis-text-dim))" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
