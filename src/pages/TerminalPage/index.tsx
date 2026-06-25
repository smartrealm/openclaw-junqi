// Terminal Workspace — Multi-session terminal + CLI tool quick-launch
// + right toolbar with File Explorer / Git Changes / Git History.

import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme";
import {
  ShellTerminalPanel,
  type ShellTerminalPanelHandle,
} from "@/components/Terminal";
import { PaneTreeView } from "@/components/Terminal/PaneTreeView";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { FileExplorer } from "@/components/FileExplorer";
import { GitChanges } from "@/components/Git";
import { GitHistory } from "@/components/Git";
import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
// (loadTools/mergeDetected were used by the removed AgentLaunchBar — no longer needed)
import type { ThemeVariant, TerminalFontSize, FontFamily } from "@/_nezha_root/types";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  getDefaultMonoFont,
} from "@/_nezha_root/types";
import {
  X, ChevronDown,
} from "lucide-react";
import { Icon } from "@/components/shared/icons";
import { AgentOverviewPanel, type AgentPanelMode } from "@/components/Terminal/AgentOverviewPanel";

type RightPanel = null | "files" | "git-changes" | "git-history" | "agents";

export function TerminalPage() {
  const { t } = useTranslation();
  const resolvedTheme = useTheme();
  const themeVariant: ThemeVariant = resolvedTheme.replace("aegis-", "") as ThemeVariant;
  const panelRef = useRef<ShellTerminalPanelHandle>(null);

  const terminalFontSize: TerminalFontSize = DEFAULT_TERMINAL_FONT_SIZE;
  const monoFontFamily: FontFamily = getDefaultMonoFont();
  const [projectPath, setProjectPath] = useState("/");
  useEffect(() => { homeDir().then(setProjectPath).catch(() => setProjectPath("/")); }, []);
  const projectName = projectPath.split("/").pop() || "home";

  // Terminal fills available flex space (no ResizeObserver needed)
  const termWrapRef = useRef<HTMLDivElement>(null);

  // Workspace — ensure at least one workspace exists (lazy init)
  const workspace = useWorkspaceStore((s) => {
    const active = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    return active ?? null;
  });
  const ensureActive = useWorkspaceStore((s) => s.ensureActive);
  useEffect(() => { if (!workspace) ensureActive(); }, [workspace, ensureActive]);

  // Right panel
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState(360);
  const [isDragging, setIsDragging] = useState(false);
  const [agentPanelMode, setAgentPanelMode] = useState<AgentPanelMode>('full');

  // ── kooky WorkspaceSidebar 三态 ──
  type SidebarMode = 'full' | 'compact' | 'hidden';
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('hidden');
  const cycleSidebarMode = () => setSidebarMode((m) =>
    m === 'hidden' ? 'full' : m === 'full' ? 'compact' : 'hidden'
  );

  // ── kooky CommandPalette (⌘P) ──
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);

  // ── kooky InboxBell + InboxPanel (⌘⇧I) ──
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxEvents, setInboxEvents] = useState<Array<{ id: string; title: string; body: string; time: number; read: boolean }>>([]);
  const unreadCount = inboxEvents.filter((e) => !e.read).length;

  // ── 从 store 读取工作区列表 ──
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const togglePanel = useCallback((panel: RightPanel) => {
    setRightPanel((prev) => (prev === panel ? null : panel));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => setRightPanelWidth(Math.max(240, Math.min(700, window.innerWidth - e.clientX)));
    const onUp = () => setIsDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isDragging]);

  // Tool click → type command into active shell
  const runTool = useCallback((cmd: string) => {
    panelRef.current?.sendCommand(cmd);
  }, []);

  // ── Cross-page command bridge ──
  // Listen for `junqi:run-terminal-command` events from FileViewer's Makefile
  // run buttons (and any other component that wants to push a command into the
  // terminal without prop-drilling). The terminal panel must already be mounted.
  // If the user is on a different page the command silently drops — they'd need
  // to be on /terminal for it to land.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ command: string; projectPath?: string }>;
      const cmd = ce.detail?.command;
      if (!cmd) return;
      panelRef.current?.sendCommand(cmd);
    };
    window.addEventListener("junqi:run-terminal-command", handler);
    return () => window.removeEventListener("junqi:run-terminal-command", handler);
  }, []);

  // ── kooky 全局快捷键 ⌘P / ⌃⌘S ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setCmdPaletteOpen((v) => !v);
      }
      // ⌃⌘S 切换侧栏
      if ((e.metaKey || e.ctrlKey) && e.ctrlKey && e.key === "s") {
        e.preventDefault();
        cycleSidebarMode();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--terminal-bg)" }}>
      {/* ── kooky 32pt top strip — [侧栏切换] [── 拖拽 + 搜索 ──] [智能体] [铃铛] ── */}
      <div style={{ height: 32, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 8px 0 0", gap: 0, borderBottom: "1px solid rgb(255 255 255 / 0.07)" }}>
        <div style={{ width: 82, flexShrink: 0 }} />
        {/* 侧栏三态切换：full → compact → hidden，快捷键 ⌃⌘S */}
        <button
          title="切换侧栏 (⌃⌘S)"
          onClick={cycleSidebarMode}
          style={{
            width: 28, height: 28, display: "flex", alignItems: "center",
            justifyContent: "center", border: "none", background: "transparent",
            borderRadius: 5, color: "rgb(var(--aegis-text-muted))", cursor: "pointer",
          }}
        >
          {/* 侧栏图标：三条横线 + 矩形外框 */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
          </svg>
        </button>
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          {/* kooky SearchTriggerPill — ⌘P 快速打开 */}
          <button
            onClick={() => setCmdPaletteOpen(true)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "0 12px", height: 22, borderRadius: 11,
              border: "1px solid rgb(255 255 255 / 0.1)",
              background: "rgb(var(--aegis-overlay)/0.04)",
              color: "rgb(var(--aegis-text-dim))", cursor: "pointer",
              fontSize: 11, fontFamily: '"JetBrains Mono", monospace',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            快速打开
            <span style={{ opacity: 0.5 }}>⌘P</span>
          </button>
        </div>
        <button title="Open Agent Panel" onClick={() => togglePanel("agents")} style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", borderRadius: 5, color: "rgb(var(--aegis-text-muted))", cursor: "pointer" }}>
          {Icon.chrome.grid}
        </button>
        {/* kooky InboxBell — 铃铛 + 红点 */}
        <button
          title="通知收件箱 (⌘⇧I)"
          onClick={() => setInboxOpen((v) => !v)}
          style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", borderRadius: 5, color: "rgb(var(--aegis-text-muted))", cursor: "pointer", position: "relative" }}
        >
          {Icon.chrome.bell}
          {unreadCount > 0 && (
            <span style={{ position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: 3, background: "rgb(239 68 68)" }} />
          )}
        </button>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* kooky WorkspaceSidebar — 左侧工作区侧栏（三态：full 220px / compact 52px） */}
        {sidebarMode !== "hidden" && (
          <WorkspaceSidebarPanel
            mode={sidebarMode}
            onModeChange={setSidebarMode}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            onSelectWorkspace={(id) => useWorkspaceStore.getState().setActive(id)}
            onCreateWorkspace={() => useWorkspaceStore.getState().createWorkspace()}
            onCloseWorkspace={(id) => useWorkspaceStore.getState().closeWorkspace(id)}
            onRenameWorkspace={(id, name) => useWorkspaceStore.getState().renameWorkspace(id, name)}
          />
        )}
        {/* Main terminal area — kooky 1:1: tab strip at top, terminal fills below */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>
          <div ref={termWrapRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {workspace ? (
              <PaneTreeView
                workspace={workspace}
                themeVariant={themeVariant}
                terminalFontSize={terminalFontSize}
                monoFontFamily={monoFontFamily}
                projectPath={projectPath}
              />
            ) : (
              <ShellTerminalPanel
                ref={panelRef}
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

      {/* Right panel — between terminal and toolbar */}
      {rightPanel && (<>
        <div onMouseDown={handleMouseDown} style={{ width: 4, flexShrink: 0, cursor: "col-resize", background: isDragging ? "rgb(var(--aegis-primary))" : "transparent" }} />
        <div style={{ width: rightPanelWidth, flexShrink: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--aegis-border)", background: "var(--aegis-elevated)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--aegis-border)", flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "rgb(var(--aegis-text-secondary))", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {rightPanel === "files" ? "Files" : rightPanel === "git-changes" ? "Changes" : rightPanel === "git-history" ? "History" : rightPanel === "agents" ? "Agents" : ""}
            </span>
            <button onClick={() => setRightPanel(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "rgb(var(--aegis-text-dim))" }}>
              <X size={14} />
            </button>
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            {rightPanel === "files" && (
              <FileExplorer projectPath={projectPath} projectName={projectName} onFileSelect={() => {}} />
            )}
            {rightPanel === "git-changes" && (
              <GitChanges projectPath={projectPath} currentTaskCreatedAt={null} onFileSelect={() => {}} />
            )}
            {rightPanel === "git-history" && (
              <GitHistory projectPath={projectPath} onCommitSelect={() => {}} />
            )}
            {rightPanel === "agents" && (
              <AgentOverviewPanel
                projectPath={projectPath}
                mode={agentPanelMode}
                onModeChange={setAgentPanelMode}
              />
            )}
          </div>
        </div>
      </>)}

      {/* Right toolbar — outer-most 44px strip */}
      <div style={{ width: 44, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 4px", borderLeft: "1px solid var(--aegis-border)", background: "var(--aegis-surface)" }}>
        <IconBtn icon={Icon.chrome.grid} label="Agents" active={rightPanel === "agents"} onClick={() => togglePanel("agents")} />
        <IconBtn icon={Icon.nav.files} label="Files" active={rightPanel === "files"} onClick={() => togglePanel("files")} />
        <IconBtn icon={Icon.nav.git} label="Changes" active={rightPanel === "git-changes"} onClick={() => togglePanel("git-changes")} />
        <IconBtn icon={Icon.nav.history} label="History" active={rightPanel === "git-history"} onClick={() => togglePanel("git-history")} />
      </div>
      </div>

      {/* kooky InboxPanel — ⌘⇧I 通知收件箱 */}
      <InboxPanel
        open={inboxOpen}
        onClose={() => setInboxOpen(false)}
        events={inboxEvents}
        onMarkAllRead={() => setInboxEvents((prev) => prev.map((e) => ({ ...e, read: true })))}
        onClear={() => setInboxEvents([])}
      />
      {/* kooky CommandPalette — ⌘P */}
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

function IconBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8, border: "none", cursor: "pointer", background: active ? "rgba(var(--aegis-primary) / 0.10)" : "transparent", color: active ? "rgb(var(--aegis-primary))" : "rgb(var(--aegis-text-muted))", transition: "background 0.12s, color 0.12s" }}>
      {icon}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────
// kooky SidebarView 1:1 port — 工作区侧栏（三态：full 220px / compact 52px）
// ──────────────────────────────────────────────────────────────

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
  const displayName = ws.name?.trim() || '新工作区';
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
            title="关闭"
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
            onRename && { label: '重命名', action: startRename, icon: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' },
            onDuplicate && { label: '复制工作区', action: () => { onDuplicate(); setCtxMenu(null); }, icon: 'M8 17l4 4 4-4m-4-5v9M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10' },
            totalCount > 1 && onCloseOthers && { label: '关闭其他', action: () => { onCloseOthers(); setCtxMenu(null); }, icon: 'M18 6L6 18M6 6l12 12' },
            totalCount > 1 && onClose && { label: '关闭', action: () => { onClose(); setCtxMenu(null); }, icon: 'M18 6L6 18M6 6l12 12', danger: true },
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

// ──────────────────────────────────────────────────────────────
// WorkspaceSidebarPanel — redesigned (full 220px / compact 52px)
// ──────────────────────────────────────────────────────────────
function WorkspaceSidebarPanel({
  mode, onModeChange, workspaces, activeWorkspaceId,
  onSelectWorkspace, onCreateWorkspace, onCloseWorkspace, onRenameWorkspace,
}: {
  mode: 'full' | 'compact';
  onModeChange: (m: 'full' | 'compact' | 'hidden') => void;
  workspaces: Array<{ id: string; name: string; focusedPaneId: string; root: any }>;
  activeWorkspaceId: string | null;
  onSelectWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
  onCloseWorkspace: (id: string) => void;
  onRenameWorkspace?: (id: string, name: string) => void;
}) {
  const width = mode === 'full' ? 220 : 52;

  return (
    <div style={{
      width, flexShrink: 0, display: 'flex', flexDirection: 'column',
      borderRight: '1px solid rgb(255 255 255 / 0.07)',
      background: 'rgb(var(--aegis-surface))',
      transition: 'width 0.18s cubic-bezier(0.22,1,0.36,1)',
      overflow: 'hidden',
    }}>

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
          }}>Workspaces</span>
          {/* 新建按钮 */}
          <button
            onClick={onCreateWorkspace}
            title="新建工作区"
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
          {/* 折叠按钮 */}
          <button
            onClick={() => onModeChange('compact')}
            title="折叠侧栏"
            style={{
              width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', borderRadius: 5,
              color: 'rgb(var(--aegis-text-dim))', cursor: 'pointer',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.08)'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-dim))'; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        </div>
      ) : (
        /* compact 顶部：只有新建按钮 */
        <div style={{ height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <button
            onClick={onCreateWorkspace}
            title="新建工作区"
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
              暂无工作区
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
            新建工作区
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
            placeholder="搜索工作区、操作…"
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
// ──────────────────────────────────────────────────────────────
// kooky AgentInbox 1:1 port — ⌘⇧I 通知收件箱
// ──────────────────────────────────────────────────────────────

function InboxPanel({
  open, onClose, events, onMarkAllRead, onClear,
}: {
  open: boolean;
  onClose: () => void;
  events: Array<{ id: string; title: string; body: string; time: number; read: boolean }>;
  onMarkAllRead: () => void;
  onClear: () => void;
}) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
      <div style={{
        position: 'fixed', top: 40, right: 52, zIndex: 999,
        width: 360, maxHeight: 480,
        background: 'rgb(var(--aegis-elevated))',
        border: '1px solid rgb(255 255 255 / 0.10)',
        borderRadius: 10, boxShadow: '0 16px 48px rgb(0 0 0 / 0.5)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* 标题栏 */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 14px', height: 40, borderBottom: '1px solid rgb(255 255 255 / 0.07)', flexShrink: 0 }}>
          <span style={{ flex: 1, fontSize: 12, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600, color: 'rgb(var(--aegis-text))' }}>
            通知
          </span>
          <button onClick={onMarkAllRead} title="全部已读" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgb(var(--aegis-text-dim))', padding: '2px 6px', fontSize: 10, fontFamily: '"JetBrains Mono", monospace' }}>
            全部已读
          </button>
          <button onClick={onClear} title="清空" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgb(var(--aegis-text-dim))', padding: '2px 6px', fontSize: 10, fontFamily: '"JetBrains Mono", monospace' }}>
            清空
          </button>
        </div>
        {/* 内容 */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {events.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 160, gap: 8, color: 'rgb(var(--aegis-text-dim))', opacity: 0.5 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              <span style={{ fontSize: 11, fontFamily: '"JetBrains Mono", monospace' }}>暂无通知</span>
            </div>
          ) : (
            events.map((ev) => (
              <div key={ev.id} style={{ display: 'flex', gap: 10, padding: '10px 14px', borderBottom: '1px solid rgb(255 255 255 / 0.05)', opacity: ev.read ? 0.6 : 1 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 4, flexShrink: 0, background: ev.read ? 'transparent' : 'rgb(59 130 246)', border: ev.read ? '1.5px solid rgb(var(--aegis-text-dim))' : 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontFamily: '"JetBrains Mono", monospace', color: 'rgb(var(--aegis-text))', fontWeight: 500 }}>{ev.title}</div>
                  <div style={{ fontSize: 11, color: 'rgb(var(--aegis-text-dim))', marginTop: 2 }}>{ev.body}</div>
                </div>
                <span style={{ fontSize: 10, color: 'rgb(var(--aegis-text-dim))', opacity: 0.6, flexShrink: 0 }}>
                  {new Date(ev.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
