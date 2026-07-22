import type React from "react";
import { createPortal } from "react-dom";
import { APP_PLATFORM } from "./platform";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, forwardRef, useImperativeHandle } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { attachSmartCopy, smartCopy } from "./terminalCopyHelper";
import { matchesTerminalNewline, TERMINAL_NEWLINE_SEQUENCE } from "@/junqi/shortcuts";
import { TERMINAL_CONTEXT_MENU_STYLE } from "./terminalMenuStyles";
import { Icon } from '@/components/shared/icons';
import { KookyAgentIcon } from './KookyAgentIcon';
import { TerminalKookyMenuDivider, TerminalKookyMenuItem } from './KookyMenu';
import type { TerminalFontSize, FontFamily, ThemeVariant } from "./terminalTypes";
import {
  applyTerminalThemeOnPanel,
  initTerminal,
  loadWebglAddon,
  safeFit,
  safeOpenTerminal,
  createSmartWriter,
  attachMacWebKitTerminalGuard,
  attachTerminalScrollbarAutoHide,
  applyTerminalFontSize,
  applyTerminalFontFamily,
  applyDomCharSizeOverride,
  refreshTerminalDisplay,
} from "./terminalShared";
import { attachLinuxIMEFix, attachMacWebKitShiftInputFix } from "./terminalInputFix";
import {
  advanceShellLaunchPath,
  applyTerminalToolCallEvent,
  beginShellRename,
  createShellRunId,
  markStalledTerminalToolCalls,
  migrateShellTitleState,
  normalizeShellCustomTitle,
  parseOsc7Cwd,
  parseJunqiAgentStatusTitle,
  recordClosedTerminalShell,
  resolveShellDisplayTitle,
  resolveShellRename,
  shellStateFromExit,
  takeRecentlyClosedTerminalShell,
  terminalAgentLaunchCommand,
  type TerminalAgentId,
  type TerminalAgentActivity,
  type TerminalHookEvent,
  type ShellRenameSession,
  type TerminalToolCall,
  type OpenShellResult,
  type ShellProxyInfo,
  type ShellLaunchPathState,
  type ShellExitEvent,
  type ShellOutputEvent,
  type ShellRuntimeState,
} from "./shellLifecycle";
import { pasteAndSubmit as pasteTerminalAndSubmit } from './terminalPaste';
import { useTerminalDropTarget } from './terminalDropTarget';
import {
  parseTerminalWorkspacePathDrop,
  TERMINAL_WORKSPACE_PATH_MIME,
} from './terminalWorkspacePathDrop';
import {
  imageFromClipboardEvent,
  readTerminalClipboardEvent,
  readTerminalClipboardText,
} from './terminalClipboard';
import { debugError } from "@/utils/debugLog";
import {
  FILE_TREE_POINTER_DRAG_EVENT,
  type FileTreePointerDragDetail,
} from "@/components/FileExplorer/pathDrag";
import {
  cancelTerminalPtyHandoff,
  completeTerminalPtyHandoff,
  createTerminalRendererInstanceId,
  prepareTerminalPtyHandoff,
  registerTerminalPtyOwner,
  terminalTransferMatchesRemote,
  takeTerminalPtyHandoffSnapshot,
  unregisterTerminalPtyOwner,
} from './terminalPtyHandoff';
import { combineUnlisteners, hasTauriEventBridge, subscribeTauriEvent, subscribeTauriEventReady } from '@/utils/tauriEvents';
import { useNotificationStore } from '@/stores/notificationStore';
import { PERSISTENT_NOTIFICATIONS_CHANGED_EVENT } from '@/hooks/usePersistentNotifications';
import { Code2, Plus, Terminal as TerminalIcon, X, SplitSquareHorizontal, SplitSquareVertical, RotateCcw } from "lucide-react";
import { useI18n } from "./i18n-fallback";
import { PaneStatusBar } from "./PaneStatusBar";
import { PaneComposerBar } from "./PaneComposerBar";
import { PaneSearchBar } from "./PaneSearchBar";
import { removeTerminalAgentOverview, upsertTerminalAgentOverview } from './terminalAgentRegistry';
import {
  isTerminalAgentId,
  terminalAgentLauncher,
  type TerminalAgentLauncher,
} from './terminalAgentCatalog';
import {
  ensureTerminalAgentAvailability,
  getTerminalAgentAvailabilitySnapshot,
  subscribeTerminalAgentAvailability,
} from './terminalAgentAvailability';
import {
  getTerminalAgentPreferencesSnapshot,
  subscribeTerminalAgentPreferences,
  visibleTerminalAgentIds,
} from './terminalAgentPreferences';
import {
  getTerminalPresetPreferencesSnapshot,
  subscribeTerminalPresetPreferences,
} from './terminalPresets';
import {
  getTerminalCustomAgentPreferencesSnapshot,
  subscribeTerminalCustomAgentPreferences,
} from './terminalCustomAgents';
import {
  buildTerminalLaunchTargets,
  findTerminalLaunchTarget,
  type TerminalLaunchTarget,
} from './terminalLaunchCatalog';
import {
  getTerminalAppearancePreferencesSnapshot,
  subscribeTerminalAppearancePreferences,
} from './terminalAppearancePreferences';
import { TERMINAL_AGENT_LAUNCH_EVENT } from './terminalChromeEvents';
import {
  removeTerminalSessionOverview,
  upsertTerminalSessionOverview,
} from './terminalSessionRegistry';
import { TerminalHookNotificationTracker } from './terminalNotifications';
import type { Terminal as XTermType } from '@xterm/xterm';
import "@xterm/xterm/css/xterm.css";

export interface ShellTerminalPanelHandle {
  sendCommand: (cmd: string) => boolean;
}

// ─────────────────────────────────────────────────────────────────
// Kooky title precedence: user rename first, then the session's current
// directory, then the generated terminal label.
// ─────────────────────────────────────────────────────────────────
function computeShellTitle(shell: ShellSession): string {
  return resolveShellDisplayTitle(shell);
}

// ── kooky TabBarItem port: 40pt strip, cornerRadius 6, chromeActive bg,
//    opacity 0.6 inactive foreground, hover-to-show close button,
//    right-click context menu: Close / Close Others / Close to Right / Rename
//    + HTML5 drag-and-drop reorder (Windows/macOS/Linux)
//    + inline rename popover (no native prompt())

interface TabShellItemProps {
  title: string;
  agent?: TerminalAgentId;
  status: ShellRuntimeState;
  exitCode?: number | null;
  selected: boolean;
  index: number;
  totalCount: number;
  onSelect: () => void;
  onClose: () => void;
  onCloseOthers?: () => void;
  onCloseToRight?: () => void;
  onRename?: (name: string) => void;
  onDuplicate?: () => void;
  onMoveToNewWindow?: () => void;
  onSplitH?: () => void;
  onSplitV?: () => void;
  onRevealDirectory?: () => void;
  onDragStart?: (event: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDragEnter?: (index: number) => void;
  onDragEnd?: () => void;
  onExternalDrop?: (event: React.DragEvent<HTMLDivElement>, index: number) => void;
  renameRequested?: boolean;
  onRenameRequestHandled?: () => void;
}

function TabShellItem({
  title, agent, status, exitCode, selected, index, totalCount,
  onSelect, onClose, onCloseOthers, onCloseToRight, onRename,
  onDuplicate, onMoveToNewWindow, onSplitH, onSplitV, onRevealDirectory,
  onDragStart, onDragEnter, onDragEnd, onExternalDrop, renameRequested = false, onRenameRequestHandled,
}: TabShellItemProps) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [renameSession, setRenameSession] = useState<ShellRenameSession | null>(null);
  const renaming = renameSession !== null;
  const hasCommandFailure = status === 'failed' || (status === 'exited' && exitCode !== 0 && exitCode != null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const pendingRenameFrameRef = useRef<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (!renameRequested) return;
    setCtxMenu(null);
    setRenameSession((current) => current ?? beginShellRename(title));
    onRenameRequestHandled?.();
  }, [onRenameRequestHandled, renameRequested, title]);

  useEffect(() => () => {
    if (pendingRenameFrameRef.current !== null) cancelAnimationFrame(pendingRenameFrameRef.current);
  }, []);

  useEffect(() => {
    if (!ctxMenu) return;
    const dismissOutside = (event: MouseEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setCtxMenu(null);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCtxMenu(null);
    };
    const dismiss = () => setCtxMenu(null);
    document.addEventListener('mousedown', dismissOutside);
    window.addEventListener('keydown', dismissOnEscape);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('mousedown', dismissOutside);
      window.removeEventListener('keydown', dismissOnEscape);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [ctxMenu]);

  const closeShortcut = APP_PLATFORM === 'macos' ? '⌘W' : 'Ctrl+W';
  const splitRightShortcut = APP_PLATFORM === 'macos' ? '⌘D' : 'Ctrl+Alt+D';
  const splitDownShortcut = APP_PLATFORM === 'macos' ? '⌘⇧D' : 'Ctrl+Alt+Shift+D';
  const renameShortcut = APP_PLATFORM === 'macos' ? '⌘R' : 'Ctrl+R';

  const startRename = (deferred = false) => {
    const open = () => {
      pendingRenameFrameRef.current = null;
      setRenameSession((current) => current ?? beginShellRename(title));
    };
    setCtxMenu(null);
    if (pendingRenameFrameRef.current !== null) cancelAnimationFrame(pendingRenameFrameRef.current);
    if (deferred) pendingRenameFrameRef.current = requestAnimationFrame(open);
    else open();
  };
  const commitRename = () => {
    if (!renameSession) return;
    const result = resolveShellRename(renameSession);
    setRenameSession(null);
    if (result.changed) onRename?.(result.value);
  };
  const cancelRename = () => setRenameSession(null);

  return (
    <>
      <div
        className="terminal-kooky-tab"
        draggable={!renaming}
        onClick={onSelect}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          startRename();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSelect();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setDragOver(false); }}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(e, index); }}
        onDragEnter={(e) => { e.preventDefault(); setDragOver(true); onDragEnter?.(index); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          if (!Array.from(event.dataTransfer.types).includes(TERMINAL_SHELL_TRANSFER_MIME)) return;
          event.preventDefault();
          event.stopPropagation();
          setDragOver(false);
          onExternalDrop?.(event, index);
        }}
        onDragEnd={() => { setDragOver(false); onDragEnd?.(); }}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "5px 10px", height: 28, minWidth: 0,
          borderRadius: 6, flexShrink: 0, cursor: "pointer",
          background: dragOver ? "rgb(var(--aegis-primary)/0.15)"
            : selected ? "rgb(var(--aegis-overlay)/0.15)"
            : hovered ? "rgb(var(--aegis-overlay)/0.07)"
            : "transparent",
          color: selected ? "rgb(var(--aegis-text))" : "rgb(var(--aegis-text)/0.6)",
          transition: "background 0.12s",
          outline: dragOver ? "1px solid rgb(var(--aegis-primary)/0.4)" : "none",
          outlineOffset: -1,
        }}
      >
        {hasCommandFailure && (
          <span
            title={exitCode != null ? `exit ${exitCode}` : t('terminal.failed', 'Terminal stopped unexpectedly')}
            style={{ width: 5, height: 5, flexShrink: 0, borderRadius: '50%', background: 'rgb(232 102 102)' }}
          />
        )}
        <span style={{ display: 'inline-flex', flexShrink: 0 }}>
          <KookyAgentIcon
            agent={agent}
            size={15}
            fallback={<TerminalIcon size={15} color={selected ? "rgb(var(--aegis-text))" : "rgb(var(--aegis-text)/0.6)"} />}
          />
        </span>
        {renaming ? (
          <input
            ref={renameInputRef}
            value={renameSession.draft}
            aria-label={t('terminal.rename', 'Rename terminal')}
            onChange={(e) => setRenameSession((current) => current ? { ...current, draft: e.target.value } : current)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            style={{
              fontSize: 12,
              background: 'rgb(var(--aegis-surface))',
              border: '1px solid rgb(var(--aegis-primary)/0.5)',
              borderRadius: 3, color: 'rgb(var(--aegis-text))',
              padding: '0 4px', height: 20, width: 120,
              fontFamily: '"JetBrains Mono", monospace', outline: 'none',
            }}
          />
        ) : (
          <span style={{ fontSize: 12, fontWeight: 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>
            {title}
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title={t('terminal.close', 'Close')}
          style={{
            background: "none", border: "none", color: "rgb(var(--aegis-text-dim))",
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 16, height: 16, padding: 0, borderRadius: 5, cursor: "pointer",
            opacity: !renaming && (hovered || selected) ? 1 : 0,
            pointerEvents: !renaming && (hovered || selected) ? "auto" : "none",
            transition: "opacity 0.1s, background 0.12s, color 0.12s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.10)'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-dim))'; }}
        >
          <X size={9} />
        </button>
      </div>

      {ctxMenu && createPortal(
        <div
          ref={contextMenuRef}
          role="menu"
          className="terminal-kooky-menu"
          onMouseDown={(event) => event.stopPropagation()}
          style={{
          position: 'fixed', left: Math.max(4, Math.min(ctxMenu.x, window.innerWidth - 248)), top: Math.max(4, Math.min(ctxMenu.y, window.innerHeight - 320)), zIndex: 2147482000,
          ...TERMINAL_CONTEXT_MENU_STYLE,
          borderRadius: 6,
          padding: 4, minWidth: 240, display: 'flex', flexDirection: 'column',
          }}
        >
          <TerminalKookyMenuItem label={t('terminal.close', 'Close')} shortcut={closeShortcut} onClick={() => { onClose(); setCtxMenu(null); }} />
          <TerminalKookyMenuItem
            label={t('terminal.closeOthers', 'Close Others')}
            disabled={!onCloseOthers || totalCount <= 1}
            onClick={() => { if (onCloseOthers && totalCount > 1) { onCloseOthers(); setCtxMenu(null); } }}
          />
          <TerminalKookyMenuItem
            label={t('terminal.closeTabsToRight', 'Close Tabs to the Right')}
            disabled={!onCloseToRight || index >= totalCount - 1}
            onClick={() => { if (onCloseToRight && index < totalCount - 1) { onCloseToRight(); setCtxMenu(null); } }}
          />
          <TerminalKookyMenuDivider />
          {onSplitH && (
            <TerminalKookyMenuItem label={t('terminal.splitRight', 'Split Right')} shortcut={splitRightShortcut} onClick={() => { onSplitH(); setCtxMenu(null); }} />
          )}
          {onSplitV && (
            <TerminalKookyMenuItem label={t('terminal.splitDown', 'Split Down')} shortcut={splitDownShortcut} onClick={() => { onSplitV(); setCtxMenu(null); }} />
          )}
          {onMoveToNewWindow && (
            <TerminalKookyMenuItem label={t('terminal.moveToNewWindow', 'Move to New Window')} onClick={() => { onMoveToNewWindow(); setCtxMenu(null); }} />
          )}
          <TerminalKookyMenuDivider />
          {onRename && (
            <TerminalKookyMenuItem label={t('terminal.rename', 'Rename...')} shortcut={renameShortcut} onClick={() => startRename(true)} />
          )}
          {onDuplicate && (
            <TerminalKookyMenuItem label={t('terminal.duplicateTab', 'Duplicate Tab')} onClick={() => { onDuplicate(); setCtxMenu(null); }} />
          )}
          {onRevealDirectory && (
            <>
              <TerminalKookyMenuDivider />
              <TerminalKookyMenuItem label={t('terminal.revealInFileManager', 'Reveal in file manager')} onClick={() => { onRevealDirectory(); setCtxMenu(null); }} />
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function TerminalLaunchMenuItem({ icon, label, onClick, disabled = false, meta }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  meta?: string;
}) {
  return (
    <TerminalKookyMenuItem
      label={label}
      disabled={disabled}
      leading={<span style={{ color: 'rgb(var(--aegis-text-dim))' }}>{icon}</span>}
      trailing={meta ? <span style={{ color: 'rgb(var(--aegis-text-dim))', fontSize: 10 }}>{meta}</span> : undefined}
      onClick={onClick}
    />
  );
}

interface ShellTerminalInstanceHandle {
  sendCommand: (cmd: string) => boolean;
  pasteText: (text: string) => boolean;
  pasteAndSubmit: (text: string) => boolean;
  serializeSnapshot: () => string;
}

interface TerminalDropHoverEvent {
  target_id: string | null;
}

interface TerminalFileDropEvent {
  target_id: string;
  input: string;
}

interface TerminalCommandEvent {
  command?: unknown;
  projectPath?: unknown;
}

interface TerminalPasteEvent {
  input?: unknown;
}

interface ShellSession {
  id: string;
  generatedTitle: string;
  customTitle?: string;
  cwd?: string;
  status: ShellRuntimeState;
  exitCode?: number | null;
  proxy?: ShellProxyInfo | null;
  /** Runtime-only PTY identity. Never persisted: restored tabs start fresh shells. */
  runId?: string;
  /** Serialized xterm state supplied by a separate terminal window. */
  handoffSnapshot?: string;
  agentActivity?: TerminalAgentActivity;
  /** Launcher visual only; runtime activity still comes from real hooks. */
  launcherAgent?: TerminalAgentId;
  toolCalls?: TerminalToolCall[];
  restartNonce: number;
}

function terminalLauncherIcon(id: string): React.ReactNode {
  const registered = Icon.agent[id];
  return <KookyAgentIcon
    agent={id}
    size={16}
    fallback={registered
      ? <span style={{ color: `#${registered.tint}`, display: 'inline-flex' }}>{registered.icon}</span>
      : <Code2 size={13} />}
  />;
}

const TERMINAL_SHELL_TRANSFER_MIME = 'application/x-junqi-terminal-shell';
const TERMINAL_SHELL_MOVED_EVENT = 'junqi:terminal-shell-moved';

interface TerminalShellTransferPayload {
  sourceProjectId: string;
  shell: Pick<ShellSession, 'id' | 'generatedTitle' | 'customTitle' | 'cwd' | 'proxy' | 'launcherAgent'>;
  runId?: string;
  /** Spawn-pinned SSH workspace host. Runtime-only, like the PTY id. */
  sshHost?: string;
}

interface TerminalWindowHandoff {
  shell: Pick<ShellSession, 'id' | 'generatedTitle' | 'customTitle' | 'cwd' | 'proxy' | 'launcherAgent'>;
  runId: string;
  snapshot: string;
  sshHost?: string;
}

function parseTerminalShellTransfer(raw: string): TerminalShellTransferPayload | null {
  try {
    const value = JSON.parse(raw) as Partial<TerminalShellTransferPayload>;
    if (!value || typeof value.sourceProjectId !== 'string' || !value.shell || typeof value.shell.id !== 'string') return null;
      return {
      sourceProjectId: value.sourceProjectId,
      shell: {
        id: value.shell.id,
        generatedTitle: typeof value.shell.generatedTitle === 'string' ? value.shell.generatedTitle : 'Terminal',
        ...(typeof value.shell.customTitle === 'string' ? { customTitle: value.shell.customTitle } : {}),
        ...(typeof value.shell.cwd === 'string' && value.shell.cwd ? { cwd: value.shell.cwd } : {}),
        ...(value.shell.proxy && typeof value.shell.proxy === 'object' ? { proxy: value.shell.proxy as ShellProxyInfo } : {}),
        ...(typeof value.shell.launcherAgent === 'string' && isTerminalAgentId(value.shell.launcherAgent) ? { launcherAgent: value.shell.launcherAgent } : {}),
      },
      ...(typeof value.runId === 'string' && value.runId ? { runId: value.runId } : {}),
      ...(typeof value.sshHost === 'string' && value.sshHost.trim() ? { sshHost: value.sshHost.trim() } : {}),
    };
  } catch {
    return null;
  }
}

interface Props {
  projectPath: string;
  /** Remote workspace destination. When set, each tab owns an SSH PTY. */
  sshHost?: string;
  projectId: string;
  /** Owning terminal workspace; used by the live command-palette index. */
  workspaceId?: string;
  isActive?: boolean;
  onClose: () => void;
  themeVariant: ThemeVariant;
  terminalFontSize: TerminalFontSize;
  terminalScrollback: number;
  terminalShiftEnterNewline: boolean;
  monoFontFamily: FontFamily;
  onReady?: () => void;
  height?: number;
  onResizeStart?: (e: React.MouseEvent) => void;
  /** kooky TabBarView.splitButtons: split Right / Down triggers. */
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  /** Only the focused pane is allowed to claim keyboard focus / global shortcuts. */
  paneFocused?: boolean;
  /** Makes this panel's workspace visible before a cross-workspace tab jump. */
  onWorkspaceFocus?: () => void;
  onPaneFocus?: () => void;
  onDirectoryChange?: (cwd: string) => void;
  /** kooky StatusBarIconButton zoom — wired from PaneTreeView */
  canZoom?: boolean;
  isZoomed?: boolean;
  onZoom?: () => void;
  /** Parent split divider is moving; defer PTY resizes until its final size. */
  resizeSuspended?: boolean;
}

const MAX_PENDING_TERMINAL_COMMANDS = 32;

function shellPersistKey(projectId: string): string {
  return `junqi:terminal-shells:${projectId}`;
}

function loadShellState(projectId: string): { shells: ShellSession[]; activeShellId: string | null; nextIndex: number } | null {
  try {
    const raw = localStorage.getItem(shellPersistKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const rawShells: unknown[] = Array.isArray(parsed?.shells) ? parsed.shells as unknown[] : [];
    const shells: ShellSession[] = rawShells
        .filter((s: unknown): s is Record<string, unknown> & { id: string } => (
          typeof s === 'object' && s !== null
          && typeof (s as { id?: unknown }).id === 'string'
        ))
        .map((shell, index): ShellSession => {
          const titleState = migrateShellTitleState(shell, `Terminal ${index + 1}`);
          return {
            id: shell.id,
            ...titleState,
            ...(typeof shell.cwd === 'string' && shell.cwd.trim() ? { cwd: shell.cwd.trim() } : {}),
            ...(typeof shell.launcherAgent === 'string' && isTerminalAgentId(shell.launcherAgent) ? { launcherAgent: shell.launcherAgent } : {}),
            status: 'starting' as const,
            restartNonce: 0,
          };
        });
    if (shells.length === 0) return null;
    return {
      shells,
      activeShellId: shells.some((s: ShellSession) => s.id === parsed?.activeShellId) ? parsed.activeShellId : shells[0].id,
      nextIndex: Number.isFinite(parsed?.nextIndex) ? Math.max(2, Number(parsed.nextIndex)) : shells.length + 1,
    };
  } catch {
    return null;
  }
}

function saveShellState(projectId: string, shells: ShellSession[], activeShellId: string | null, nextIndex: number): void {
  try {
    const persistedShells = shells.map(({ id, generatedTitle, customTitle, cwd, launcherAgent }) => ({
      id,
      generatedTitle,
      ...(customTitle ? { customTitle } : {}),
      ...(cwd ? { cwd } : {}),
      ...(launcherAgent ? { launcherAgent } : {}),
    }));
    localStorage.setItem(shellPersistKey(projectId), JSON.stringify({ shells: persistedShells, activeShellId, nextIndex }));
  } catch {}
}

function createShellSession(projectId: string, index: number, cwd?: string): ShellSession {
  return {
    id: `shell:${projectId}:${index}:${Date.now()}`,
    generatedTitle: `Terminal ${index}`,
    ...(cwd ? { cwd } : {}),
    status: 'starting',
    restartNonce: 0,
  };
}

const ShellTerminalInstance = forwardRef<ShellTerminalInstanceHandle, {
  shellId: string;
  projectPath: string;
  sshHost?: string;
  isActive: boolean;
  isFocused: boolean;
  runtimeState: ShellRuntimeState;
  restartNonce: number;
  existingRunId?: string;
  handoffSnapshot?: string;
  themeVariant: ThemeVariant;
  terminalFontSize: TerminalFontSize;
  terminalScrollback: number;
  terminalShiftEnterNewline: boolean;
  monoFontFamily: FontFamily;
  onReady?: () => void;
  onActiveTermChange?: (term: XTermType | null) => void;
  onLifecycleChange?: (state: ShellRuntimeState, exitCode?: number | null) => void;
  onRunIdChange?: (runId: string | null) => void;
  onAgentActivityChange?: (activity: TerminalAgentActivity | null) => void;
  onTerminalHookEvent?: (event: TerminalHookEvent) => void;
  onCwdChange?: (cwd: string) => void;
  onFocus?: () => void;
  onRestart?: () => void;
  onAskAgent?: (agent: TerminalAgentId, selection: string) => void;
  askAgentLaunchers?: readonly TerminalAgentLauncher[];
  onProxyChange?: (proxy: ShellProxyInfo | null) => void;
  canZoom?: boolean;
  isZoomed?: boolean;
  onZoom?: () => void;
  resizeSuspended?: boolean;
}>(
  function ShellTerminalInstance(
    {
      shellId,
      projectPath,
      sshHost,
      isActive,
      isFocused,
      runtimeState,
      restartNonce,
      existingRunId,
      handoffSnapshot,
      themeVariant,
      terminalFontSize,
      terminalScrollback,
      terminalShiftEnterNewline,
      monoFontFamily,
      onReady,
      onActiveTermChange,
      onLifecycleChange,
      onRunIdChange,
      onAgentActivityChange,
      onTerminalHookEvent,
      onCwdChange,
      onFocus,
      onRestart,
      onAskAgent,
      askAgentLaunchers = [],
      onProxyChange,
      canZoom = false,
      isZoomed = false,
      onZoom,
      resizeSuspended = false,
    },
    ref,
  ) {
    const { t } = useI18n();
    const terminalAppearance = useSyncExternalStore(
      subscribeTerminalAppearancePreferences,
      getTerminalAppearancePreferencesSnapshot,
      getTerminalAppearancePreferencesSnapshot,
    );
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<XTerm | null>(null);
    const [termCtxMenu, setTermCtxMenu] = useState<{ x: number; y: number } | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const serializeAddonRef = useRef<SerializeAddon | null>(null);
    const themeVariantRef = useRef(themeVariant);
    const isActiveRef = useRef(isActive);
    const isFocusedRef = useRef(isFocused);
    const terminalFontSizeRef = useRef(terminalFontSize);
    const terminalScrollbackRef = useRef(terminalScrollback);
    const terminalShiftEnterNewlineRef = useRef(terminalShiftEnterNewline);
    const monoFontFamilyRef = useRef(monoFontFamily);
    const terminalCursorStyleRef = useRef(terminalAppearance.cursorStyle);
    const onReadyRef = useRef(onReady);
    const onActiveTermChangeRef = useRef(onActiveTermChange);
    const onLifecycleChangeRef = useRef(onLifecycleChange);
    const onRunIdChangeRef = useRef(onRunIdChange);
    const onAgentActivityChangeRef = useRef(onAgentActivityChange);
    const onTerminalHookEventRef = useRef(onTerminalHookEvent);
    const onCwdChangeRef = useRef(onCwdChange);
    const onFocusRef = useRef(onFocus);
    const onAskAgentRef = useRef(onAskAgent);
    const onZoomRef = useRef(onZoom);
    const runIdRef = useRef<string | null>(existingRunId ?? null);
    // A run id is only an adoption contract on the initial target mount.
    // Subsequent state updates from open_shell must never recreate this effect.
    const initialExistingRunIdRef = useRef<string | null>(existingRunId ?? null);
    const rendererInstanceIdRef = useRef(createTerminalRendererInstanceId());
    const launchPathStateRef = useRef<ShellLaunchPathState | null>(null);
    const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const pendingResizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const resizeSuspendedRef = useRef(resizeSuspended);
    themeVariantRef.current = themeVariant;
    isActiveRef.current = isActive;
    isFocusedRef.current = isFocused;
    terminalFontSizeRef.current = terminalFontSize;
    terminalScrollbackRef.current = terminalScrollback;
    terminalShiftEnterNewlineRef.current = terminalShiftEnterNewline;
    monoFontFamilyRef.current = monoFontFamily;
    terminalCursorStyleRef.current = terminalAppearance.cursorStyle;
    onReadyRef.current = onReady;
    onActiveTermChangeRef.current = onActiveTermChange;
    onLifecycleChangeRef.current = onLifecycleChange;
    onRunIdChangeRef.current = onRunIdChange;
    onAgentActivityChangeRef.current = onAgentActivityChange;
    onTerminalHookEventRef.current = onTerminalHookEvent;
    onCwdChangeRef.current = onCwdChange;
    onFocusRef.current = onFocus;
    onAskAgentRef.current = onAskAgent;
    onZoomRef.current = onZoom;
    resizeSuspendedRef.current = resizeSuspended;
    const initialExistingRunId = initialExistingRunIdRef.current;
    launchPathStateRef.current = advanceShellLaunchPath(
      launchPathStateRef.current,
      projectPath,
      restartNonce,
    );
    const launchProjectPath = launchPathStateRef.current.path;

    useEffect(() => {
      if (!terminalRef.current) return;
      terminalRef.current.options.cursorStyle = terminalAppearance.cursorStyle;
      refreshTerminalDisplay(terminalRef.current);
    }, [terminalAppearance.cursorStyle]);

    const sendInput = useCallback((data: string) => {
      const runId = runIdRef.current;
      if (!runId || !data) return false;
      invoke("send_input", { taskId: shellId, runId, data }).catch((err) => {
        debugError("terminal", "[ShellTerminalPanel] send_input failed:", err);
      });
      return true;
    }, [shellId]);

    const pasteFromSystemClipboard = useCallback(async () => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      const text = await readTerminalClipboardText();
      if (text) {
        terminal.focus();
        terminal.paste(text);
      }
    }, []);

    const sendPtyResize = useCallback((size: { cols: number; rows: number }) => {
      const runId = runIdRef.current;
      if (!runId) return false;
      void invoke('resize_pty', {
        taskId: shellId,
        runId,
        cols: size.cols,
        rows: size.rows,
      }).catch(() => undefined);
      return true;
    }, [shellId]);

    const flushPendingResize = useCallback(() => {
      const pending = pendingResizeRef.current;
      if (!pending || resizeSuspendedRef.current) return false;
      if (!sendPtyResize(pending)) return false;
      pendingResizeRef.current = null;
      return true;
    }, [sendPtyResize]);

    const requestResize = useCallback((size: { cols: number; rows: number } | null) => {
      if (!size) return;
      const last = lastSizeRef.current;
      if (last && last.cols === size.cols && last.rows === size.rows) return;
      lastSizeRef.current = size;
      if (resizeSuspendedRef.current) {
        pendingResizeRef.current = size;
        return;
      }
      sendPtyResize(size);
    }, [sendPtyResize]);

    useEffect(() => {
      if (!resizeSuspended) flushPendingResize();
    }, [flushPendingResize, resizeSuspended]);

    useImperativeHandle(
      ref,
      () => ({
        sendCommand: (cmd: string) => {
          return sendInput(cmd);
        },
        pasteText: (text: string) => {
          const terminal = terminalRef.current;
          if (!terminal || !text) return false;
          terminal.focus();
          terminal.paste(text);
          return true;
        },
        pasteAndSubmit: (text: string) => {
          const terminal = terminalRef.current;
          if (!terminal) return false;
          terminal.focus();
          return pasteTerminalAndSubmit(
            (value) => terminal.paste(value),
            sendInput,
            text,
          );
        },
        serializeSnapshot: () => {
          try {
            return serializeAddonRef.current?.serialize({ scrollback: 10_000 }) ?? '';
          } catch (error) {
            debugError('terminal', 'serialize terminal snapshot failed:', error);
            return '';
          }
        },
      }),
      [sendInput],
    );

    useEffect(() => {
      if (!containerRef.current) return;
      const container = containerRef.current;
      let cleaned = false;
      let initTimeoutId: number | null = null;
      let readyTimeoutId: number | null = null;
      let disposeSafeOpen: (() => void) | null = null;
      let unlistenOutput: (() => void) | null = null;
      let unlistenExit: (() => void) | null = null;
      let unlistenHook: (() => void) | null = null;
      let listenersReady = false;
      let shellStarted = false;
      let startShell: (() => void) | null = null;

      const { term, fitAddon, whenFontsReady } = initTerminal(
        themeVariantRef.current,
        terminalScrollbackRef.current,
        terminalFontSizeRef.current,
        monoFontFamilyRef.current,
        terminalCursorStyleRef.current,
      );
      applyTerminalThemeOnPanel(term, themeVariantRef.current, container);
      terminalRef.current = term;
      if (isActiveRef.current) onActiveTermChangeRef.current?.(term as unknown as XTermType);
      fitAddonRef.current = fitAddon;

      let disposeCharSizeOverride: (() => void) | null = null;
      let disposeScrollbarAutoHide: (() => void) | null = null;
      let disposeInputFix: (() => void) | null = null;
      let webglHandle: { dispose(): void } | null = null;
      let writer: ReturnType<typeof createSmartWriter> | null = null;
      let disposeMacWebKitGuard: (() => void) | null = null;
      let disposeSmartCopy: (() => void) | null = null;
      let serializeAddon: SerializeAddon | null = null;
      let disposeNativeImagePaste: (() => void) | null = null;
      let disposeOnData: { dispose(): void } | null = null;
      let disposeTermFocus: { dispose(): void } | null = null;
      let disposeOscCwd: { dispose(): void } | null = null;
      let disposeOscAgentStatus: { dispose(): void } | null = null;
      let resizeObserver: ResizeObserver | null = null;
      let visibilityHandler: (() => void) | null = null;
      let opened = false;

      const subscribe = async () => {
        const [outputUnlisten, exitUnlisten, hookUnlisten] = await Promise.all([
          subscribeTauriEventReady<ShellOutputEvent>('shell-output', (event) => {
            if (
              event.payload.shell_id === shellId
              && event.payload.run_id === runIdRef.current
              && terminalRef.current
              && writer
            ) {
              writer.write(event.payload.data);
            }
          }),
          subscribeTauriEventReady<ShellExitEvent>('shell-exit', (event) => {
            if (event.payload.shell_id !== shellId || event.payload.run_id !== runIdRef.current) return;
            onLifecycleChangeRef.current?.(
              shellStateFromExit(event.payload),
              event.payload.exit_code,
            );
            onRunIdChangeRef.current?.(null);
            unregisterTerminalPtyOwner(shellId, rendererInstanceIdRef.current);
          }),
          subscribeTauriEventReady<TerminalHookEvent>('terminal-hook', (event) => {
            const hook = event.payload;
            if (hook.shellId !== shellId || hook.runId !== runIdRef.current) return;
              if (hook.kind === 'lifecycle') {
                if (hook.event === 'ended') onAgentActivityChangeRef.current?.(null);
                else if (
                  (hook.event === 'running' || hook.event === 'attention')
                && isTerminalAgentId(hook.agent)
              ) {
                onAgentActivityChangeRef.current?.({ agent: hook.agent, state: hook.event });
              }
            }
            onTerminalHookEventRef.current?.(hook);
          }),
        ]);
        if (cleaned) {
          outputUnlisten();
          exitUnlisten();
          hookUnlisten();
          return;
        }
        unlistenOutput = outputUnlisten;
        unlistenExit = exitUnlisten;
        unlistenHook = hookUnlisten;
        listenersReady = true;
        startShell?.();
      };
      if (hasTauriEventBridge()) {
        void subscribe().catch((error) => {
          if (cleaned) return;
          onLifecycleChangeRef.current?.('failed');
          debugError('terminal', '[ShellTerminalPanel] unable to subscribe to PTY events:', error);
        });
      } else {
        // Browser previews have no native PTY bridge. Render xterm without
        // registering callbacks that only exist inside the desktop runtime.
        listenersReady = true;
      }

      // safeOpenTerminal waits for non-zero layout dimensions. The PTY is
      // deliberately not spawned until both xterm and its event listeners are
      // ready, so the initial prompt/banner cannot race past the renderer.
      const openAndWire = () => {
        if (opened || cleaned) return;
        opened = true;

        disposeCharSizeOverride = applyDomCharSizeOverride(term);
        disposeScrollbarAutoHide = attachTerminalScrollbarAutoHide(term, container);
        disposeInputFix = attachMacWebKitShiftInputFix(term);
        webglHandle = loadWebglAddon(term);
        writer = createSmartWriter(term);
        serializeAddon = new SerializeAddon();
        term.loadAddon(serializeAddon);
        serializeAddonRef.current = serializeAddon;
        disposeMacWebKitGuard = attachMacWebKitTerminalGuard({ term, container, writer });
        disposeSmartCopy = attachSmartCopy(term, {
          onPaste: pasteFromSystemClipboard,
          matchesNewline: (event) => matchesTerminalNewline(event, terminalShiftEnterNewlineRef.current),
          onNewline: () => { sendInput(TERMINAL_NEWLINE_SEQUENCE); },
        });
        const handleNativeImagePaste = (event: ClipboardEvent) => {
          if (!imageFromClipboardEvent(event)) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          void readTerminalClipboardEvent(event).then((text) => {
            if (!cleaned && text) term.paste(text);
          });
        };
        term.textarea?.addEventListener('paste', handleNativeImagePaste, true);
        disposeNativeImagePaste = () => term.textarea?.removeEventListener('paste', handleNativeImagePaste, true);
        const handleTerminalFocus = () => onFocusRef.current?.();
        term.textarea?.addEventListener('focus', handleTerminalFocus);
        disposeTermFocus = {
          dispose: () => term.textarea?.removeEventListener('focus', handleTerminalFocus),
        };
        disposeOscCwd = term.parser.registerOscHandler(7, (payload) => {
          const cwd = parseOsc7Cwd(payload, APP_PLATFORM === 'windows' ? 'windows' : 'posix');
          if (cwd) onCwdChangeRef.current?.(cwd);
          return true;
        });
        disposeOscAgentStatus = term.parser.registerOscHandler(2, (payload) => {
          const activity = parseJunqiAgentStatusTitle(payload);
          if (activity !== undefined) onAgentActivityChangeRef.current?.(activity);
          // OSC 2 is a private state signal for JunQi, never a tab title.
          return activity !== undefined;
        });

        const fit = () => {
          if (cleaned) return;
          requestResize(safeFit(fitAddon, term, container));
        };

        whenFontsReady.then(() => {
          if (!cleaned) fit();
        });

        startShell = () => {
          if (!listenersReady || shellStarted || cleaned) return;
          shellStarted = true;
          if (initialExistingRunId) {
            // The source pane has already opened this PTY. Reattach to its
            // process-global Rust registry rather than invoking open_shell,
            // which intentionally replaces duplicate shell ids.
            runIdRef.current = initialExistingRunId;
            registerTerminalPtyOwner(shellId, initialExistingRunId, rendererInstanceIdRef.current);
            onRunIdChangeRef.current?.(initialExistingRunId);
            onLifecycleChangeRef.current?.('running');
            const size = safeFit(fitAddon, term, container);
            if (size) {
              lastSizeRef.current = size;
              sendPtyResize(size);
            }
            const restoreHandoffSnapshot = (remainingAttempts: number) => {
              const snapshot = handoffSnapshot ?? takeTerminalPtyHandoffSnapshot(shellId, initialExistingRunId);
              if (snapshot !== null) {
                if (snapshot) term.write(snapshot);
                return;
              }
              // React runs effect cleanups before new effects in the normal
              // transfer path. Keep one short retry for concurrent commits.
              if (remainingAttempts > 0) {
                window.setTimeout(() => restoreHandoffSnapshot(remainingAttempts - 1), 16);
              }
            };
            restoreHandoffSnapshot(2);
            readyTimeoutId = window.setTimeout(() => {
              if (!cleaned) onReadyRef.current?.();
            }, 0);
            if (isFocusedRef.current) term.focus();
            return;
          }
          initTimeoutId = window.setTimeout(() => {
            if (cleaned) return;
            const requestedRunId = createShellRunId();
            runIdRef.current = requestedRunId;
            onLifecycleChangeRef.current?.('starting');
            const size = safeFit(fitAddon, term, container);
            if (size) lastSizeRef.current = size;
            invoke<OpenShellResult>('open_shell', {
              shellId,
              projectPath: launchProjectPath,
              sshHost,
              cols: size?.cols ?? term.cols,
              rows: size?.rows ?? term.rows,
              runId: requestedRunId,
            })
              .then((result) => {
                if (cleaned || result.run_id !== requestedRunId) return;
                runIdRef.current = result.run_id;
                registerTerminalPtyOwner(shellId, result.run_id, rendererInstanceIdRef.current);
                onRunIdChangeRef.current?.(result.run_id);
                onCwdChangeRef.current?.(result.cwd);
                onProxyChange?.(result.proxy);
                onLifecycleChangeRef.current?.('running');
                flushPendingResize();
                readyTimeoutId = window.setTimeout(() => {
                  if (!cleaned) onReadyRef.current?.();
                }, 300);
              })
              .catch((error) => {
                if (cleaned) return;
                onLifecycleChangeRef.current?.('failed');
                debugError('terminal', '[ShellTerminalPanel] open_shell failed:', error);
              });
            if (isFocusedRef.current) term.focus();
          }, 50);
        };
        startShell();

        // Some remote-desktop WebViews inject one onData call per character.
        // Coalesce only that microtask-sized burst; ordinary keyboard latency is
        // unchanged and all data is still sent through the run-id guard.
        let inputBuf = '';
        let inputFlushPending = false;
        const flushInputBuf = () => {
          inputFlushPending = false;
          if (!inputBuf) return;
          const data = inputBuf;
          inputBuf = '';
          sendInput(data);
        };
        const sendInputBuffered = (data: string) => {
          inputBuf += data;
          if (!inputFlushPending) {
            inputFlushPending = true;
            queueMicrotask(flushInputBuf);
          }
        };
        const linuxIME = attachLinuxIMEFix(term, sendInputBuffered);
        disposeOnData = { dispose: () => linuxIME.dispose() };

        let rafId: number | null = null;
        resizeObserver = new ResizeObserver(() => {
          if (rafId !== null) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => {
            rafId = null;
            if (isActiveRef.current && !cleaned) fit();
          });
        });
        resizeObserver.observe(container);

        const handleVisibilityChange = () => {
          if (document.visibilityState !== 'visible' || !terminalRef.current || !isActiveRef.current) return;
          window.requestAnimationFrame(() => {
            fit();
            const current = terminalRef.current;
            if (!current) return;
            refreshTerminalDisplay(current);
            if (isFocusedRef.current) current.focus();
          });
        };
        visibilityHandler = handleVisibilityChange;
        document.addEventListener('visibilitychange', handleVisibilityChange);
      };

      disposeSafeOpen = safeOpenTerminal(term, container, openAndWire);

      return () => {
        cleaned = true;
        const runId = runIdRef.current;
        runIdRef.current = null;
        let keepPtyForHandoff = false;
        if (runId) {
          let snapshot = '';
          try {
            snapshot = serializeAddon?.serialize({ scrollback: 10_000 }) ?? '';
          } catch (error) {
            debugError('terminal', 'serialize terminal handoff failed:', error);
          }
          keepPtyForHandoff = completeTerminalPtyHandoff(
            shellId,
            runId,
            rendererInstanceIdRef.current,
            snapshot,
          );
          if (!keepPtyForHandoff) {
            unregisterTerminalPtyOwner(shellId, rendererInstanceIdRef.current);
          }
        }
        disposeSafeOpen?.();
        if (initTimeoutId !== null) window.clearTimeout(initTimeoutId);
        if (readyTimeoutId !== null) window.clearTimeout(readyTimeoutId);
        unlistenOutput?.();
        unlistenExit?.();
        unlistenHook?.();
        disposeSmartCopy?.();
        disposeNativeImagePaste?.();
        disposeOnData?.dispose();
        disposeTermFocus?.dispose();
        disposeOscCwd?.dispose();
        disposeOscAgentStatus?.dispose();
        resizeObserver?.disconnect();
        if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
        if (isActiveRef.current) onActiveTermChangeRef.current?.(null);
        terminalRef.current = null;
        fitAddonRef.current = null;
        serializeAddonRef.current = null;
        disposeCharSizeOverride?.();
        try { webglHandle?.dispose(); } catch { /* addon may not have loaded */ }
        disposeScrollbarAutoHide?.();
        disposeMacWebKitGuard?.();
        disposeInputFix?.();
        try { term.dispose(); } catch { /* already gone — rapid tab close */ }
        if (runId && !keepPtyForHandoff) invoke('kill_shell', { shellId, runId }).catch(() => {});
      };
    }, [flushPendingResize, handoffSnapshot, launchProjectPath, pasteFromSystemClipboard, requestResize, restartNonce, sendInput, shellId, sshHost]);

    useEffect(() => {
      if (!isActive) return;
      if (terminalRef.current) onActiveTermChangeRef.current?.(terminalRef.current as unknown as XTermType);
      window.requestAnimationFrame(() => {
        if (!fitAddonRef.current || !terminalRef.current || !containerRef.current) return;
        const s = safeFit(fitAddonRef.current, terminalRef.current, containerRef.current);
        requestResize(s);
        refreshTerminalDisplay(terminalRef.current);
        if (isFocused) terminalRef.current.focus();
      });
    }, [isActive, isFocused, requestResize]);

    useEffect(() => {
      if (terminalRef.current && containerRef.current) {
        applyTerminalThemeOnPanel(terminalRef.current, themeVariant, containerRef.current);
        // 主题/对比度变化后 xterm 算出的最终前景色变了，但 WebGL atlas 仍缓存
        // 旧色的 glyph 纹理，不刷新会看到颜色和字形错位。
        refreshTerminalDisplay(terminalRef.current);
      }
    }, [themeVariant]);

    useEffect(() => {
      if (!terminalRef.current || !fitAddonRef.current || !containerRef.current) return;
      const size = applyTerminalFontSize(
        terminalRef.current,
        fitAddonRef.current,
        terminalFontSize,
        containerRef.current,
      );
      if (!size) return;
      requestResize(size);
    }, [requestResize, terminalFontSize]);

    useEffect(() => {
      if (!terminalRef.current) return;
      terminalRef.current.options.scrollback = terminalScrollback;
    }, [terminalScrollback]);

    useEffect(() => {
      if (!termCtxMenu) return;
      const close = () => setTermCtxMenu(null);
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
      document.addEventListener('mousedown', close);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', close);
        document.removeEventListener('keydown', onKey);
      };
    }, [termCtxMenu]);

    const copySelection = async () => {
      const terminal = terminalRef.current;
      if (terminal) await smartCopy(terminal);
      setTermCtxMenu(null);
      terminal?.focus();
    };

    const pasteClipboard = async () => {
      await pasteFromSystemClipboard();
      setTermCtxMenu(null);
      terminalRef.current?.focus();
    };

    const selectAllTerminal = () => {
      terminalRef.current?.selectAll?.();
      setTermCtxMenu(null);
      terminalRef.current?.focus();
    };

    const clearTerminal = () => {
      terminalRef.current?.clear?.();
      setTermCtxMenu(null);
      terminalRef.current?.focus();
    };

    const askAgent = (agent: TerminalAgentId) => {
      const selection = terminalRef.current?.getSelection?.() ?? '';
      if (selection) onAskAgentRef.current?.(agent, selection);
      setTermCtxMenu(null);
    };

    const togglePaneZoom = () => {
      setTermCtxMenu(null);
      onFocusRef.current?.();
      onZoomRef.current?.();
    };

    useEffect(() => {
      if (!terminalRef.current || !fitAddonRef.current || !containerRef.current) return;
      const result = applyTerminalFontFamily(
        terminalRef.current,
        fitAddonRef.current,
        monoFontFamily,
        containerRef.current,
      );
      if (!result) return;
      requestResize(result.immediate);
      let cancelled = false;
      result.whenSettled.then((s) => {
        if (cancelled) return;
        requestResize(s);
      });
      return () => {
        cancelled = true;
      };
    }, [monoFontFamily, requestResize]);

    const menuItemStyle: React.CSSProperties = {
      padding: '5px 12px',
      fontSize: 11,
      cursor: 'pointer',
      color: 'rgb(var(--aegis-text))',
      fontFamily: '"JetBrains Mono", monospace',
      whiteSpace: 'nowrap',
      background: 'transparent',
      border: 'none',
      textAlign: 'left',
      width: '100%',
    };

    const selectedText = terminalRef.current?.getSelection?.() ?? '';
    const terminalMenu = termCtxMenu ? createPortal(
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: Math.max(8, Math.min(termCtxMenu.x, window.innerWidth - 248)),
          top: Math.max(8, Math.min(termCtxMenu.y, window.innerHeight - 488)),
          zIndex: 2147482000,
          width: 240,
          maxHeight: 480,
          overflowY: 'auto',
          padding: 6,
          borderRadius: 6,
          ...TERMINAL_CONTEXT_MENU_STYLE,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {selectedText && askAgentLaunchers.length > 0 && <>
          {askAgentLaunchers.map((launcher) => (
            <button
              key={launcher.id}
              style={{ ...menuItemStyle, display: 'flex', alignItems: 'center', gap: 8 }}
              onMouseEnter={(event) => { event.currentTarget.style.background = 'rgb(var(--aegis-overlay)/0.08)'; }}
              onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}
              onClick={() => askAgent(launcher.id)}
            >
              <span style={{ display: 'flex', width: 16, justifyContent: 'center' }}>{terminalLauncherIcon(launcher.id)}</span>
              <span>{`Ask ${launcher.label}`}</span>
            </button>
          ))}
          <div style={{ height: 1, background: 'rgb(var(--aegis-overlay)/0.08)', margin: '3px 0' }} />
        </>}
        <button disabled={!selectedText} style={{ ...menuItemStyle, opacity: selectedText ? 1 : 0.45, cursor: selectedText ? 'pointer' : 'default' }} onMouseEnter={(e) => { if (selectedText) e.currentTarget.style.background = 'rgb(var(--aegis-overlay)/0.08)'; }} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')} onClick={() => void copySelection()}>{t('terminal.copy', 'Copy')}</button>
        <button style={menuItemStyle} onMouseEnter={(e) => (e.currentTarget.style.background = 'rgb(var(--aegis-overlay)/0.08)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')} onClick={() => void pasteClipboard()}>{t('terminal.paste', 'Paste')}</button>
        <button style={menuItemStyle} onMouseEnter={(e) => (e.currentTarget.style.background = 'rgb(var(--aegis-overlay)/0.08)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')} onClick={selectAllTerminal}>{t('terminal.selectAll', 'Select All')}</button>
        <div style={{ height: 1, background: 'rgb(var(--aegis-overlay)/0.08)', margin: '3px 0' }} />
        {canZoom && <>
          <button style={menuItemStyle} onMouseEnter={(e) => (e.currentTarget.style.background = 'rgb(var(--aegis-overlay)/0.08)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')} onClick={togglePaneZoom}>{t(isZoomed ? 'terminal.exitZoom' : 'terminal.zoom')}</button>
          <div style={{ height: 1, background: 'rgb(var(--aegis-overlay)/0.08)', margin: '3px 0' }} />
        </>}
        <button style={menuItemStyle} onMouseEnter={(e) => (e.currentTarget.style.background = 'rgb(var(--aegis-overlay)/0.08)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')} onClick={clearTerminal}>{t('terminal.clear', 'Clear')}</button>
      </div>,
      document.body,
    ) : null;

    return (
      <>
        <div
          ref={containerRef}
          className="junqi-xterm-host junqi-shell-xterm-host"
          onMouseDown={() => {
            onFocusRef.current?.();
            terminalRef.current?.focus();
          }}
          onContextMenu={(e) => {
            if (!isActive) return;
            e.preventDefault();
            e.stopPropagation();
            onFocusRef.current?.();
            terminalRef.current?.focus();
            setTermCtxMenu({ x: e.clientX, y: e.clientY });
          }}
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            // Kooky PaneTreeView gives the terminal surface one uniform 8pt inset.
            padding: "8px",
            cursor: "text",
            visibility: isActive ? "visible" : "hidden",
            pointerEvents: isActive ? "auto" : "none",
          }}
        />
        {isActive && (runtimeState === 'exited' || runtimeState === 'failed') && (
          <div
            style={{
              position: 'absolute', right: 12, bottom: 30, zIndex: 4,
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 8px', borderRadius: 5,
              background: 'rgb(var(--aegis-elevated))',
              border: `1px solid ${runtimeState === 'failed' ? 'rgb(239 68 68 / 0.45)' : 'rgb(var(--aegis-overlay) / 0.14)'}`,
              color: 'rgb(var(--aegis-text-secondary))',
              fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
            }}
          >
            <span>{runtimeState === 'failed' ? t('terminal.failed', 'Terminal stopped unexpectedly') : t('terminal.exited', 'Terminal exited')}</span>
            <button
              type="button"
              onClick={onRestart}
              title={t('terminal.restart', 'Restart terminal')}
              style={{
                width: 22, height: 22, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgb(var(--aegis-primary))', background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
              }}
            >
              <RotateCcw size={13} />
            </button>
          </div>
        )}
        {terminalMenu}
      </>
    );
  },
);

export const ShellTerminalPanel = forwardRef<ShellTerminalPanelHandle, Props>(
  function ShellTerminalPanel(
    {
      projectPath,
      sshHost,
      projectId,
      workspaceId,
      isActive = true,
      onClose,
      themeVariant,
      terminalFontSize,
      terminalScrollback,
      terminalShiftEnterNewline,
      monoFontFamily,
      onReady,
      onSplitHorizontal,
      onSplitVertical,
      height = 240,
      onResizeStart,
      canZoom,
      isZoomed,
      onZoom,
      paneFocused = isActive,
      onWorkspaceFocus,
      onPaneFocus,
      onDirectoryChange,
      resizeSuspended = false,
    },
    ref,
  ) {
    const { t } = useI18n();
    const addToast = useNotificationStore((state) => state.addToast);
    const isRemoteWorkspace = Boolean(sshHost?.trim());
    const initialStateRef = useRef<{ shells: ShellSession[]; activeShellId: string | null; nextIndex: number } | null>(null);
    if (!initialStateRef.current) {
      const restored = loadShellState(projectId);
      initialStateRef.current = restored
        ? {
            ...restored,
            shells: isRemoteWorkspace
              ? restored.shells.map(({ cwd: _cwd, ...shell }) => shell)
              : restored.shells,
          }
        : (() => {
        const initial = createShellSession(projectId, 1, isRemoteWorkspace ? undefined : projectPath);
        return { shells: [initial], activeShellId: initial.id, nextIndex: 2 };
      })();
    }

    const nextShellIndexRef = useRef(initialStateRef.current.nextIndex);
    const dragSrcIdxRef = useRef<number | null>(null);
    const dragDstIdxRef = useRef<number | null>(null);
    const shellRefs = useRef<Record<string, ShellTerminalInstanceHandle | null>>({});
    const panelRef = useRef<HTMLDivElement>(null);
    const pendingTerminalPasteRef = useRef<string | null>(null);
    const pendingTerminalCommandsRef = useRef<string[]>([]);
    const [shells, setShells] = useState<ShellSession[]>(() => initialStateRef.current!.shells);
    const [activeShellId, setActiveShellId] = useState<string | null>(() => initialStateRef.current!.activeShellId);
    const [renameShellRequestId, setRenameShellRequestId] = useState<string | null>(null);
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const addMenuRef = useRef<HTMLDivElement>(null);
    const addMenuPopupRef = useRef<HTMLDivElement>(null);
    const addMenuButtonRef = useRef<HTMLButtonElement>(null);
    const agentAvailability = useSyncExternalStore(
      subscribeTerminalAgentAvailability,
      getTerminalAgentAvailabilitySnapshot,
      getTerminalAgentAvailabilitySnapshot,
    );
    const agentPreferences = useSyncExternalStore(
      subscribeTerminalAgentPreferences,
      getTerminalAgentPreferencesSnapshot,
      getTerminalAgentPreferencesSnapshot,
    );
    const presetPreferences = useSyncExternalStore(
      subscribeTerminalPresetPreferences,
      getTerminalPresetPreferencesSnapshot,
      getTerminalPresetPreferencesSnapshot,
    );
    const customAgentPreferences = useSyncExternalStore(
      subscribeTerminalCustomAgentPreferences,
      getTerminalCustomAgentPreferencesSnapshot,
      getTerminalCustomAgentPreferencesSnapshot,
    );
    const visibleAgentIds = useMemo(() => visibleTerminalAgentIds(agentPreferences), [agentPreferences]);
    const availableAgentIds = useMemo(
      () => new Set(agentAvailability.agents),
      [agentAvailability.agents],
    );
    const availableLaunchers = useMemo(
      () => visibleAgentIds.filter((agent) => availableAgentIds.has(agent)).map(terminalAgentLauncher),
      [availableAgentIds, visibleAgentIds],
    );
    const launchTargets = useMemo(() => buildTerminalLaunchTargets({
      availableAgentIds,
      agentPreferences,
      presetPreferences,
      customAgentPreferences,
      platform: APP_PLATFORM === 'windows' ? 'windows' : 'posix',
    }), [agentPreferences, availableAgentIds, customAgentPreferences, presetPreferences]);
    const defaultLauncher = findTerminalLaunchTarget(agentPreferences.defaultLauncherId, launchTargets);
    const [terminalDropActive, setTerminalDropActive] = useState(false);
    const [workspacePathDropActive, setWorkspacePathDropActive] = useState(false);
    const activeShellIdRef = useRef(activeShellId);
    const trackedAgentShellIdsRef = useRef(new Set<string>());
    const trackedSessionShellIdsRef = useRef(new Set<string>());
    const terminalNotificationTrackerRef = useRef(new TerminalHookNotificationTracker());
    activeShellIdRef.current = activeShellId;
    const onDirectoryChangeRef = useRef(onDirectoryChange);
    onDirectoryChangeRef.current = onDirectoryChange;
    useTerminalDropTarget(projectId, panelRef);

    useEffect(() => {
      void ensureTerminalAgentAvailability();
    }, []);

    // Palette navigation indexes the real mounted tabs. It never reconstructs
    // a shell from localStorage, so focusing an entry preserves its live PTY.
    useEffect(() => {
      const liveSessionShellIds = new Set<string>();
      for (const shell of shells) {
        liveSessionShellIds.add(shell.id);
        const displayAgent = shell.agentActivity?.agent ?? shell.launcherAgent;
        upsertTerminalSessionOverview({
          shellId: shell.id,
          paneId: projectId,
          ...(workspaceId ? { workspaceId } : {}),
          title: computeShellTitle(shell),
          projectPath: isRemoteWorkspace
            ? `ssh://${sshHost?.trim() || 'remote'}`
            : shell.cwd || projectPath,
          ...(displayAgent ? { agent: displayAgent } : {}),
          ...(isRemoteWorkspace && sshHost?.trim() ? { remoteHost: sshHost.trim() } : {}),
          runtimeState: shell.status,
          focus: () => {
            onWorkspaceFocus?.();
            setActiveShellId(shell.id);
            if (!isRemoteWorkspace && shell.cwd) onDirectoryChangeRef.current?.(shell.cwd);
            onPaneFocus?.();
          },
        });
      }

      for (const shellId of trackedSessionShellIdsRef.current) {
        if (!liveSessionShellIds.has(shellId)) removeTerminalSessionOverview(shellId);
      }
      trackedSessionShellIdsRef.current = liveSessionShellIds;
    }, [isRemoteWorkspace, onPaneFocus, onWorkspaceFocus, projectId, projectPath, shells, sshHost, workspaceId]);

    useEffect(() => () => {
      for (const shellId of trackedSessionShellIdsRef.current) {
        removeTerminalSessionOverview(shellId);
      }
      trackedSessionShellIdsRef.current.clear();
    }, []);

    // Kooky keeps the agent monitor scoped to live terminal sessions. Mirror
    // that here from JunQi's real shell-hook state, rather than guessing from
    // task history or process ids.
    useEffect(() => {
      const liveAgentShellIds = new Set<string>();
      for (const shell of shells) {
        if (!shell.agentActivity) continue;
        liveAgentShellIds.add(shell.id);
        upsertTerminalAgentOverview({
          shellId: shell.id,
          agent: shell.agentActivity.agent,
          state: shell.agentActivity.state,
          title: computeShellTitle(shell),
          projectPath: isRemoteWorkspace
            ? `ssh://${sshHost?.trim() || 'remote'}`
            : shell.cwd || projectPath,
          focus: () => {
            onWorkspaceFocus?.();
            setActiveShellId(shell.id);
            if (!isRemoteWorkspace && shell.cwd) onDirectoryChangeRef.current?.(shell.cwd);
            onPaneFocus?.();
          },
        });
      }

      for (const shellId of trackedAgentShellIdsRef.current) {
        if (!liveAgentShellIds.has(shellId)) removeTerminalAgentOverview(shellId);
      }
      trackedAgentShellIdsRef.current = liveAgentShellIds;
    }, [isRemoteWorkspace, onPaneFocus, onWorkspaceFocus, projectPath, shells, sshHost]);

    useEffect(() => () => {
      for (const shellId of trackedAgentShellIdsRef.current) {
        removeTerminalAgentOverview(shellId);
      }
      trackedAgentShellIdsRef.current.clear();
    }, []);

    const reopenLastClosedShell = useCallback(() => {
      const closed = takeRecentlyClosedTerminalShell();
      if (!closed) return false;
      const reopened = createShellSession(
        projectId,
        nextShellIndexRef.current++,
        isRemoteWorkspace ? undefined : closed.cwd || projectPath,
      );
      reopened.generatedTitle = closed.generatedTitle;
      if (closed.customTitle) reopened.customTitle = closed.customTitle;
      setShells((previous) => [...previous, reopened]);
      setActiveShellId(reopened.id);
      if (!isRemoteWorkspace && reopened.cwd) onDirectoryChangeRef.current?.(reopened.cwd);
      onPaneFocus?.();
      return true;
    }, [isRemoteWorkspace, onPaneFocus, projectId, projectPath]);

    useEffect(() => {
      const cycleTab = (event: Event) => {
        if (!paneFocused || shells.length < 2) return;
        const direction = (event as CustomEvent<{ direction?: unknown }>).detail?.direction === -1 ? -1 : 1;
        const currentIndex = shells.findIndex((shell) => shell.id === activeShellIdRef.current);
        const nextIndex = (Math.max(currentIndex, 0) + direction + shells.length) % shells.length;
        const next = shells[nextIndex];
        if (!next) return;
        setActiveShellId(next.id);
        if (next.cwd) onDirectoryChangeRef.current?.(next.cwd);
        onPaneFocus?.();
      };
      window.addEventListener('junqi:cycle-terminal-tab', cycleTab);
      return () => window.removeEventListener('junqi:cycle-terminal-tab', cycleTab);
    }, [onPaneFocus, paneFocused, shells]);

    useEffect(() => {
      const reopenTab = () => {
        if (paneFocused) reopenLastClosedShell();
      };
      window.addEventListener('junqi:reopen-terminal-tab', reopenTab);
      return () => window.removeEventListener('junqi:reopen-terminal-tab', reopenTab);
    }, [paneFocused, reopenLastClosedShell]);

    useEffect(() => {
      const renameTab = () => {
        if (paneFocused && activeShellIdRef.current) {
          setRenameShellRequestId(activeShellIdRef.current);
        }
      };
      window.addEventListener('junqi:rename-terminal-tab', renameTab);
      return () => window.removeEventListener('junqi:rename-terminal-tab', renameTab);
    }, [paneFocused]);

    const toggleWindowZoom = useCallback(() => {
      void import('@tauri-apps/api/webviewWindow')
        .then(({ getCurrentWebviewWindow }) => getCurrentWebviewWindow().toggleMaximize())
        .catch((error) => debugError('terminal', 'toggle terminal window zoom failed:', error));
    }, []);

    const revealShellDirectory = useCallback((cwd: string) => {
      if (!cwd.trim()) return;
      void invoke('open_folder', { path: cwd }).catch((error) => {
        debugError('terminal', 'reveal terminal directory failed:', error);
        addToast(
          'error',
          t('terminal.fileRevealFailedTitle', 'Cannot reveal file'),
          t('terminal.fileRevealFailed', 'The path could not be revealed in the system file manager.'),
        );
      });
    }, [addToast, t]);

    const flushPendingTerminalPaste = useCallback(() => {
      const input = pendingTerminalPasteRef.current;
      const shellId = activeShellIdRef.current;
      if (!input || !shellId) return false;
      const pasted = shellRefs.current[shellId]?.pasteText(input) ?? false;
      if (pasted) pendingTerminalPasteRef.current = null;
      return pasted;
    }, []);

    const queueTerminalPaste = useCallback((input: string) => {
      if (!input) return false;
      pendingTerminalPasteRef.current = input;
      return flushPendingTerminalPaste();
    }, [flushPendingTerminalPaste]);

    useEffect(() => {
      if (!isActive || !paneFocused || isRemoteWorkspace) return;
      const handleFileTreeDrop = (event: Event) => {
        const detail = (event as CustomEvent<FileTreePointerDragDetail>).detail;
        if (detail.type !== 'drop' || detail.paths.length === 0) return;
        const panel = panelRef.current;
        if (!panel) return;
        const rect = panel.getBoundingClientRect();
        if (detail.x < rect.left || detail.x > rect.right || detail.y < rect.top || detail.y > rect.bottom) return;
        const target = document.elementFromPoint(detail.x, detail.y);
        if (target && !panel.contains(target)) return;
        onPaneFocus?.();
        void Promise.all(detail.paths.map((path) => invoke<string>('terminal_escape_project_path', {
          path,
          projectPath,
        }))).then((paths) => {
          queueTerminalPaste(`${paths.join(' ')} `);
        }).catch((error) => debugError('terminal', 'file tree path drop failed', error));
      };
      window.addEventListener(FILE_TREE_POINTER_DRAG_EVENT, handleFileTreeDrop);
      return () => window.removeEventListener(FILE_TREE_POINTER_DRAG_EVENT, handleFileTreeDrop);
    }, [isActive, isRemoteWorkspace, onPaneFocus, paneFocused, projectPath, queueTerminalPaste]);

    const sendCommandToActiveShell = useCallback((command: string) => {
      const normalized = command.trim() ? command : '';
      if (!normalized) return false;
      const shellId = activeShellIdRef.current;
      if (shellId && shellRefs.current[shellId]?.sendCommand(command)) return true;

      const pending = pendingTerminalCommandsRef.current;
      if (pending.length >= MAX_PENDING_TERMINAL_COMMANDS) pending.shift();
      pending.push(command);
      return false;
    }, []);

    const flushPendingTerminalCommands = useCallback(() => {
      const shellId = activeShellIdRef.current;
      if (!shellId) return false;
      const terminal = shellRefs.current[shellId];
      if (!terminal) return false;
      const pending = pendingTerminalCommandsRef.current;
      while (pending.length > 0) {
        if (!terminal.sendCommand(pending[0])) return false;
        pending.shift();
      }
      return true;
    }, []);

    const deliverTerminalCommand = useCallback(async (command: string, projectPath?: string) => {
      if (!projectPath?.trim()) {
        sendCommandToActiveShell(command);
        return;
      }

      try {
        const changeDirectory = await invoke<string>('terminal_change_directory_command', {
          path: projectPath,
        });
        sendCommandToActiveShell(`${changeDirectory}${command}`);
      } catch (error) {
        // Never run a project command in an arbitrary current directory when
        // the selected File Manager root has disappeared.
        debugError('terminal', '[terminal] unable to change command directory:', error);
        addToast(
          'error',
          t('terminal.commandNotRun', 'Command not run'),
          t('terminal.commandDirectoryUnavailable', 'The selected project directory is unavailable.'),
        );
      }
    }, [addToast, sendCommandToActiveShell, t]);

    useEffect(() => {
      const unlisten = combineUnlisteners([
        subscribeTauriEvent<TerminalDropHoverEvent>('aegis:terminal-drag-target', (event) => {
          setTerminalDropActive(event.payload?.target_id === projectId);
        }),
        subscribeTauriEvent<TerminalFileDropEvent>('aegis:terminal-file-dropped', (event) => {
          if (event.payload?.target_id !== projectId) return;
          setTerminalDropActive(false);
          queueTerminalPaste(event.payload.input);
        }),
      ]);
      return unlisten;
    }, [projectId, queueTerminalPaste]);

    useEffect(() => {
      const handler = (event: Event) => {
        if (!paneFocused) return;
        const detail = (event as CustomEvent<TerminalCommandEvent>).detail;
        if (typeof detail?.command !== 'string') return;
        void deliverTerminalCommand(
          detail.command,
          typeof detail.projectPath === 'string' ? detail.projectPath : undefined,
        );
      };
      window.addEventListener('junqi:deliver-terminal-command', handler);
      return () => window.removeEventListener('junqi:deliver-terminal-command', handler);
    }, [deliverTerminalCommand, paneFocused]);

    useEffect(() => {
      const handler = (event: Event) => {
        if (!paneFocused) return;
        const detail = (event as CustomEvent<TerminalPasteEvent>).detail;
        if (typeof detail?.input !== 'string') return;
        queueTerminalPaste(detail.input);
      };
      window.addEventListener('junqi:paste-terminal-input', handler);
      return () => window.removeEventListener('junqi:paste-terminal-input', handler);
    }, [paneFocused, queueTerminalPaste]);

    useEffect(() => {
      flushPendingTerminalPaste();
      flushPendingTerminalCommands();
    }, [activeShellId, flushPendingTerminalCommands, flushPendingTerminalPaste]);

    useEffect(() => {
      saveShellState(projectId, shells, activeShellId, nextShellIndexRef.current);
    }, [projectId, shells, activeShellId]);

    useImperativeHandle(
      ref,
      () => ({
        sendCommand: (cmd: string) => {
          return sendCommandToActiveShell(cmd);
        },
      }),
      [sendCommandToActiveShell],
    );

    // ── kooky ComposerBar 状态 ──
    const [composerOpen, setComposerOpen] = useState(false);
    const [composerDraft, setComposerDraft] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);
    const activeTermRef = useRef<XTermType | null>(null);

    // ── ⌘L / Ctrl+L 快捷键 — 切换 ComposerBar ──
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (!paneFocused) return;
        if ((e.metaKey || e.ctrlKey) && e.key === "l") {
          e.preventDefault();
          setComposerOpen((v) => !v);
        }
        // Ctrl+F / Cmd+F — kooky PaneSearchBar
        if ((e.metaKey || e.ctrlKey) && e.key === "f") {
          e.preventDefault();
          setSearchOpen((v) => !v);
        }
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }, [paneFocused]);

    const handleAddShell = useCallback((launch?: {
      command?: string;
      title?: string;
      cwd?: string;
      iconAgent?: TerminalAgentId;
    }) => {
      const activeCwd = isRemoteWorkspace
        ? undefined
        : launch?.cwd || shells.find((shell) => shell.id === activeShellId)?.cwd || projectPath;
      const nextShell = createShellSession(projectId, nextShellIndexRef.current++, activeCwd);
      if (launch?.title) nextShell.generatedTitle = launch.title;
      if (launch?.iconAgent) nextShell.launcherAgent = launch.iconAgent;
      if (launch?.command) {
        pendingTerminalCommandsRef.current.push(`${launch.command}\n`);
      }
      setShells((prev) => [...prev, nextShell]);
      setActiveShellId(nextShell.id);
      if (!isRemoteWorkspace && activeCwd) onDirectoryChangeRef.current?.(activeCwd);
    }, [activeShellId, isRemoteWorkspace, projectId, projectPath, shells]);

    const launchTarget = useCallback(async (target: TerminalLaunchTarget) => {
      if (target.kind === 'terminal') {
        handleAddShell();
        return;
      }
      if (target.kind === 'agent') {
        handleAddShell({ command: target.command, title: target.label, iconAgent: target.iconAgent });
        return;
      }
      if (isRemoteWorkspace) {
        addToast(
          'info',
          t('terminal.presetUnavailableRemoteTitle', 'Terminal preset stays local'),
          t('terminal.presetUnavailableRemote', 'Choose a local workspace before opening this directory preset.'),
        );
        return;
      }
      try {
        const directory = await invoke<{ path: string }>('open_terminal_workspace_directory', { path: target.path });
        if (!directory?.path) throw new Error('directory is unavailable');
        handleAddShell({ cwd: directory.path });
      } catch (error) {
        addToast(
          'error',
          t('terminal.presetOpenFailedTitle', 'Cannot open terminal preset'),
          error instanceof Error ? error.message : t('terminal.presetOpenFailed', 'The preset directory is unavailable.'),
        );
      }
    }, [addToast, handleAddShell, isRemoteWorkspace, t]);

    const handleAskAgent = useCallback((agent: TerminalAgentId, selection: string) => {
        handleAddShell({
          command: terminalAgentLaunchCommand(agent, selection, APP_PLATFORM === 'windows' ? 'windows' : 'posix'),
          title: terminalAgentLauncher(agent).label,
          iconAgent: agent,
        });
    }, [handleAddShell]);

    useEffect(() => {
      const launchAgent = (event: Event) => {
        if (!isActive || !paneFocused) return;
        const launcherId = (event as CustomEvent<{ launcherId?: unknown }>).detail?.launcherId;
        if (typeof launcherId !== 'string') return;
        const target = findTerminalLaunchTarget(launcherId, launchTargets);
        if (!target) return;
        void launchTarget(target);
      };
      window.addEventListener(TERMINAL_AGENT_LAUNCH_EVENT, launchAgent);
      return () => window.removeEventListener(TERMINAL_AGENT_LAUNCH_EVENT, launchAgent);
    }, [isActive, launchTargets, launchTarget, paneFocused]);

    useEffect(() => {
      const addTab = () => {
        if (paneFocused) handleAddShell();
      };
      window.addEventListener('junqi:new-terminal-tab', addTab);
      return () => window.removeEventListener('junqi:new-terminal-tab', addTab);
    }, [handleAddShell, paneFocused]);

    useEffect(() => {
      const togglePaneZoom = () => {
        if (paneFocused) onZoom?.();
      };
      window.addEventListener('junqi:toggle-terminal-pane-zoom', togglePaneZoom);
      return () => window.removeEventListener('junqi:toggle-terminal-pane-zoom', togglePaneZoom);
    }, [onZoom, paneFocused]);

    useEffect(() => {
      if (!addMenuOpen) return;
      const close = (event: MouseEvent) => {
        const target = event.target as Node;
        if (!addMenuRef.current?.contains(target) && !addMenuPopupRef.current?.contains(target)) {
          setAddMenuOpen(false);
        }
      };
      document.addEventListener('mousedown', close);
      return () => document.removeEventListener('mousedown', close);
    }, [addMenuOpen]);

    const updateShell = useCallback((shellId: string, patch: Partial<ShellSession>) => {
      setShells((previous) => previous.map((shell) => (
        shell.id === shellId ? { ...shell, ...patch } : shell
      )));
    }, []);

    useEffect(() => {
      const sweep = () => {
        setShells((previous) => previous.map((shell) => {
          const toolCalls = markStalledTerminalToolCalls(shell.toolCalls);
          return toolCalls === shell.toolCalls ? shell : { ...shell, toolCalls };
        }));
      };
      const timer = window.setInterval(sweep, 1_000);
      return () => window.clearInterval(timer);
    }, []);

    const restartShell = useCallback((shellId: string) => {
      setShells((previous) => previous.map((shell) => (
        (() => {
          if (shell.id !== shellId) return shell;
          const next = { ...shell, status: 'starting' as const, exitCode: undefined, restartNonce: shell.restartNonce + 1 };
          delete next.runId;
          return next;
        })()
      )));
    }, []);

    const handleWorkspacePathDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
      if (!Array.from(event.dataTransfer.types).includes(TERMINAL_WORKSPACE_PATH_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setWorkspacePathDropActive(true);
    }, []);

    const handleWorkspacePathDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget;
      if (!panelRef.current?.contains(nextTarget as Node | null)) {
        setWorkspacePathDropActive(false);
      }
    }, []);

    const handleWorkspacePathDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
      const raw = event.dataTransfer.getData(TERMINAL_WORKSPACE_PATH_MIME);
      if (!raw) return;
      event.preventDefault();
      event.stopPropagation();
      setWorkspacePathDropActive(false);

      const payload = parseTerminalWorkspacePathDrop(raw);
      if (!payload) return;
      onPaneFocus?.();
      try {
        const input = await invoke<string>('terminal_escape_project_path', {
          path: payload.path,
          projectPath: payload.projectPath,
        });
        queueTerminalPaste(input);
      } catch (error) {
        debugError('terminal', '[terminal] unable to insert workspace path:', error);
        addToast(
          'error',
          t('terminal.pathInsertFailedTitle'),
          t('terminal.pathInsertFailed'),
        );
      }
    }, [addToast, onPaneFocus, queueTerminalPaste, t]);

    const handleCloseShell = useCallback(
      (shellId: string) => {
        const closingIndex = shells.findIndex((shell) => shell.id === shellId);
        if (closingIndex === -1) return;
        const closing = shells[closingIndex];
        if (closing) recordClosedTerminalShell(closing);

        const nextShells = shells.filter((shell) => shell.id !== shellId);
        setShells(nextShells);
        delete shellRefs.current[shellId];

        if (nextShells.length === 0) {
          onClose();
          return;
        }

        if (activeShellId === shellId) {
          setActiveShellId(
            nextShells[closingIndex]?.id ??
              nextShells[closingIndex - 1]?.id ??
              nextShells[0]?.id ??
              null,
          );
        }
      },
      [activeShellId, onClose, shells],
    );

    const moveShellToNewWindow = useCallback(async (shell: ShellSession) => {
      if (!shell.runId || !prepareTerminalPtyHandoff(shell.id, shell.runId)) {
        addToast(
          'error',
          t('terminal.moveWindowFailedTitle', 'Cannot move terminal'),
          t('terminal.moveWindowFailed', 'The terminal is not ready to move yet.'),
        );
        return;
      }

      const handoff: TerminalWindowHandoff = {
        shell: {
          id: shell.id,
          generatedTitle: shell.generatedTitle,
          ...(shell.customTitle ? { customTitle: shell.customTitle } : {}),
          ...(shell.cwd ? { cwd: shell.cwd } : {}),
          ...(shell.proxy ? { proxy: shell.proxy } : {}),
          ...(shell.launcherAgent ? { launcherAgent: shell.launcherAgent } : {}),
        },
        runId: shell.runId,
        snapshot: shellRefs.current[shell.id]?.serializeSnapshot() ?? '',
        ...(isRemoteWorkspace ? { sshHost: sshHost?.trim() } : {}),
      };
      try {
        await invoke('open_terminal_window', { handoff });
        window.dispatchEvent(new CustomEvent(TERMINAL_SHELL_MOVED_EVENT, {
          detail: { sourceProjectId: projectId, sourceShellId: shell.id },
        }));
      } catch (error) {
        cancelTerminalPtyHandoff(shell.id, shell.runId);
        debugError('terminal', 'open terminal window failed:', error);
        addToast(
          'error',
          t('terminal.moveWindowFailedTitle', 'Cannot move terminal'),
          t('terminal.moveWindowFailed', 'The terminal window could not be opened.'),
        );
      }
    }, [addToast, isRemoteWorkspace, projectId, sshHost, t]);

    useEffect(() => {
      const closeTab = () => {
        if (!paneFocused || !activeShellIdRef.current) return;
        handleCloseShell(activeShellIdRef.current);
      };
      window.addEventListener('junqi:close-terminal-tab', closeTab);
      return () => window.removeEventListener('junqi:close-terminal-tab', closeTab);
    }, [handleCloseShell, paneFocused]);

    // Kooky moves a tab between panes without killing its terminal engine.
    // Keep JunQi's shell id/run id when its renderer has registered ownership;
    // the target pane then attaches to the existing Rust PTY and restores the
    // source xterm scrollback snapshot during its own mount.
    const importTransferredShell = useCallback((
      payload: TerminalShellTransferPayload,
      insertIndex: number,
      options: { replaceExisting?: boolean; snapshot?: string } = {},
    ) => {
      if (payload.sourceProjectId === projectId) return false;
      if (!terminalTransferMatchesRemote(payload.sshHost, sshHost)) return false;
      const keepsLivePty = Boolean(
        payload.runId && prepareTerminalPtyHandoff(payload.shell.id, payload.runId),
      );
      const importsExternalPty = Boolean(payload.runId && options.snapshot !== undefined);
      const imported = (keepsLivePty || importsExternalPty) && payload.runId
        ? {
            id: payload.shell.id,
            generatedTitle: payload.shell.generatedTitle,
            ...(payload.shell.customTitle ? { customTitle: payload.shell.customTitle } : {}),
            ...(!isRemoteWorkspace && payload.shell.cwd ? { cwd: payload.shell.cwd } : {}),
            ...(payload.shell.proxy ? { proxy: payload.shell.proxy } : {}),
            ...(payload.shell.launcherAgent ? { launcherAgent: payload.shell.launcherAgent } : {}),
            runId: payload.runId,
            ...(options.snapshot !== undefined ? { handoffSnapshot: options.snapshot } : {}),
            status: 'running' as const,
            restartNonce: 0,
          }
        : createShellSession(
          projectId,
          nextShellIndexRef.current++,
          isRemoteWorkspace ? undefined : payload.shell.cwd || projectPath,
        );
      if (!keepsLivePty && !importsExternalPty) {
        imported.generatedTitle = payload.shell.generatedTitle;
        if (payload.shell.customTitle) imported.customTitle = payload.shell.customTitle;
        if (payload.shell.launcherAgent) imported.launcherAgent = payload.shell.launcherAgent;
      }
      setShells((previous) => {
        if (options.replaceExisting) return [imported];
        const next = [...previous];
        next.splice(Math.max(0, Math.min(insertIndex, next.length)), 0, imported);
        return next;
      });
      setActiveShellId(imported.id);
      if (!isRemoteWorkspace && imported.cwd) onDirectoryChangeRef.current?.(imported.cwd);
      onPaneFocus?.();
      window.dispatchEvent(new CustomEvent(TERMINAL_SHELL_MOVED_EVENT, {
        detail: { sourceProjectId: payload.sourceProjectId, sourceShellId: payload.shell.id },
      }));
      return true;
    }, [isRemoteWorkspace, onPaneFocus, projectId, projectPath, sshHost]);

    const acceptTransferredShell = useCallback((event: React.DragEvent<HTMLDivElement>, insertIndex: number) => {
      const payload = parseTerminalShellTransfer(event.dataTransfer.getData(TERMINAL_SHELL_TRANSFER_MIME));
      if (!payload) return;
      importTransferredShell(payload, insertIndex);
    }, [importTransferredShell]);

    useEffect(() => {
      const handler = (event: Event) => {
        const detail = (event as CustomEvent<{
          handoff?: TerminalWindowHandoff;
          replaceExisting?: boolean;
        }>).detail;
        const handoff = detail?.handoff;
        if (!handoff || typeof handoff.runId !== 'string' || !handoff.runId) return;
        if (shells.some((shell) => shell.id === handoff.shell.id)) {
          window.dispatchEvent(new CustomEvent('junqi:terminal-shell-imported', {
            detail: { shellId: handoff.shell.id },
          }));
          return;
        }
        const imported = importTransferredShell({
          sourceProjectId: '__terminal_window__',
          shell: handoff.shell,
          runId: handoff.runId,
          sshHost: handoff.sshHost,
        }, 0, {
          replaceExisting: detail?.replaceExisting === true,
          snapshot: typeof handoff.snapshot === 'string' ? handoff.snapshot : '',
        });
        if (imported) {
          window.dispatchEvent(new CustomEvent('junqi:terminal-shell-imported', {
            detail: { shellId: handoff.shell.id },
          }));
        }
      };
      window.addEventListener('junqi:import-terminal-shell', handler);
      return () => window.removeEventListener('junqi:import-terminal-shell', handler);
    }, [importTransferredShell, shells]);

    useEffect(() => {
      const handleTransfer = (event: Event) => {
        const detail = (event as CustomEvent<{ sourceProjectId?: unknown; sourceShellId?: unknown }>).detail;
        if (detail?.sourceProjectId !== projectId || typeof detail.sourceShellId !== 'string') return;
        const sourceShellId = detail.sourceShellId;
        const sourceIndex = shells.findIndex((shell) => shell.id === sourceShellId);
        if (sourceIndex < 0) return;
        const nextShells = shells.filter((shell) => shell.id !== sourceShellId);
        delete shellRefs.current[sourceShellId];
        setShells(nextShells);
        if (nextShells.length === 0) {
          onClose();
          return;
        }
        if (activeShellIdRef.current === sourceShellId) {
          setActiveShellId(nextShells[sourceIndex]?.id ?? nextShells[sourceIndex - 1]?.id ?? nextShells[0]?.id ?? null);
        }
      };
      window.addEventListener(TERMINAL_SHELL_MOVED_EVENT, handleTransfer);
      return () => window.removeEventListener(TERMINAL_SHELL_MOVED_EVENT, handleTransfer);
    }, [onClose, projectId, shells]);

    // Kooky keeps this control directly after the last tab; the split buttons
    // are a separate trailing group and must not push the `+` to the edge.
    const addTabControl = (
      <div ref={addMenuRef} style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
        <button
          ref={addMenuButtonRef}
          onClick={() => {
            if (defaultLauncher) {
              void launchTarget(defaultLauncher);
            } else if (launchTargets.length <= 1) {
              void launchTarget(launchTargets[0]!);
            } else {
              setAddMenuOpen((open) => !open);
            }
          }}
          title={t('terminal.newTerminal')}
          style={{ width: 28, height: 28, borderRadius: 5, border: 'none', background: addMenuOpen ? 'rgb(var(--aegis-overlay)/0.08)' : 'transparent', color: 'rgb(var(--aegis-text-secondary))', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.12s, color 0.12s' }}
          onMouseEnter={(event) => { event.currentTarget.style.background = 'rgb(var(--aegis-overlay)/0.08)'; event.currentTarget.style.color = 'rgb(var(--aegis-text))'; }}
          onMouseLeave={(event) => { if (!addMenuOpen) { event.currentTarget.style.background = 'transparent'; event.currentTarget.style.color = 'rgb(var(--aegis-text-secondary))'; } }}
        >
          <Plus size={14} />
        </button>
        {addMenuOpen && createPortal(
          <div
            ref={addMenuPopupRef}
            role="menu"
            className="terminal-kooky-menu"
            style={{
              position: 'fixed',
              left: Math.max(8, Math.min(addMenuButtonRef.current?.getBoundingClientRect().left ?? 8, window.innerWidth - 228)),
              top: Math.max(8, Math.min((addMenuButtonRef.current?.getBoundingClientRect().bottom ?? 32) + 4, window.innerHeight - 368)),
              zIndex: 2147482000,
              width: 220,
              maxHeight: 360,
              overflowY: 'auto',
              padding: 4,
              borderRadius: 6,
              ...TERMINAL_CONTEXT_MENU_STYLE,
            }}
          >
            {launchTargets.map((target) => (
              <TerminalLaunchMenuItem
                key={target.id}
                icon={target.kind === 'agent'
                  ? terminalLauncherIcon(target.iconAgent ?? target.id)
                  : <TerminalIcon size={13} />}
                label={target.label}
                onClick={() => {
                  void launchTarget(target);
                  setAddMenuOpen(false);
                }}
              />
            ))}
          </div>,
          document.body,
        )}
      </div>
    );

    return (
      <div
        ref={panelRef}
        className="terminal-kooky-pane"
        onDragOverCapture={handleWorkspacePathDragOver}
        onDragLeaveCapture={handleWorkspacePathDragLeave}
        onDropCapture={handleWorkspacePathDrop}
        style={{
          flex: 1,
          height: height != null ? height : undefined,
          borderTop: "none",
          display: "flex",
          flexDirection: "column",
          background: "var(--aegis-elevated)",
          position: 'relative',
        }}
      >
        {onResizeStart && (
          <div
            onMouseDown={onResizeStart}
            style={{
              height: 4,
              flexShrink: 0,
              cursor: "row-resize",
              background: "transparent",
            }}
          />
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Tab strip — kooky TabBarView 1:1 (chromeBackground = terminal-bg) */}
          <div
            className="terminal-kooky-pane-tabs"
            onDoubleClick={(event) => {
              // Kooky zooms the native window only from the tab strip's empty
              // chrome; controls and tabs retain their own double-click behavior.
              if (event.target === event.currentTarget) toggleWindowZoom();
            }}
            style={{ display: "flex", alignItems: "center", height: 40, flexShrink: 0, padding: "0 8px", gap: 2, background: "var(--terminal-bg)" }}
          >
            <div
              onDragOver={(event) => {
                if (Array.from(event.dataTransfer.types).includes(TERMINAL_SHELL_TRANSFER_MIME)) event.preventDefault();
              }}
              onDrop={(event) => {
                if (!Array.from(event.dataTransfer.types).includes(TERMINAL_SHELL_TRANSFER_MIME)) return;
                event.preventDefault();
                acceptTransferredShell(event, shells.length);
              }}
              style={{ display: "flex", alignItems: "center", gap: 2, flex: 1, overflowX: "auto", scrollbarWidth: "none" }}
            >
              {shells.map((shell, idx) => {
                const selected = activeShellId === shell.id;
                const tabTitle = computeShellTitle(shell);
                return (
                  <TabShellItem
                    key={shell.id}
                    title={tabTitle}
                    agent={shell.agentActivity?.agent ?? shell.launcherAgent}
                    status={shell.status}
                    exitCode={shell.exitCode}
                    selected={selected}
                    index={idx}
                    totalCount={shells.length}
                    onSelect={() => {
                      setActiveShellId(shell.id);
                      if (shell.cwd) onDirectoryChangeRef.current?.(shell.cwd);
                      onPaneFocus?.();
                    }}
                    onClose={() => { handleCloseShell(shell.id); }}
                    onCloseOthers={() => {
                      const toClose = shells.filter((s) => s.id !== shell.id);
                      toClose.forEach((s) => {
                        recordClosedTerminalShell(s);
                        delete shellRefs.current[s.id];
                      });
                      setShells([shell]);
                      setActiveShellId(shell.id);
                    }}
                    onCloseToRight={() => {
                      const toClose = shells.slice(idx + 1);
                      toClose.forEach((s) => {
                        recordClosedTerminalShell(s);
                        delete shellRefs.current[s.id];
                      });
                      const next = shells.slice(0, idx + 1);
                      setShells(next);
                      if (activeShellId && toClose.some((s) => s.id === activeShellId)) {
                        setActiveShellId(shell.id);
                      }
                    }}
                    onRename={(name) => {
                      const customTitle = normalizeShellCustomTitle(name);
                      setShells((prev) => prev.map((s) => {
                        if (s.id !== shell.id) return s;
                        const next = { ...s };
                        if (customTitle) next.customTitle = customTitle;
                        else delete next.customTitle;
                        return next;
                      }));
                    }}
                    onDragStart={(event, i) => {
                      dragSrcIdxRef.current = i;
                      event.dataTransfer.setData(TERMINAL_SHELL_TRANSFER_MIME, JSON.stringify({
                        sourceProjectId: projectId,
                        shell: {
                          id: shell.id,
                          generatedTitle: shell.generatedTitle,
                          ...(shell.customTitle ? { customTitle: shell.customTitle } : {}),
                          ...(shell.cwd ? { cwd: shell.cwd } : {}),
                          ...(shell.proxy ? { proxy: shell.proxy } : {}),
                          ...(shell.launcherAgent ? { launcherAgent: shell.launcherAgent } : {}),
                        },
                        ...(shell.runId ? { runId: shell.runId } : {}),
                        ...(isRemoteWorkspace ? { sshHost: sshHost?.trim() } : {}),
                      } satisfies TerminalShellTransferPayload));
                    }}
                    onDragEnter={(i) => { dragDstIdxRef.current = i; }}
                    onDragEnd={() => {
                      const si = dragSrcIdxRef.current;
                      const di = dragDstIdxRef.current;
                      if (si !== null && di !== null && si !== di) {
                        setShells((prev) => {
                          const next = [...prev];
                          const [moved] = next.splice(si, 1);
                          next.splice(di, 0, moved);
                          return next;
                        });
                      }
                      dragSrcIdxRef.current = null;
                      dragDstIdxRef.current = null;
                    }}
                    onExternalDrop={acceptTransferredShell}
                    onDuplicate={() => {
                      const dup = createShellSession(
                        projectId,
                        nextShellIndexRef.current++,
                        isRemoteWorkspace ? undefined : shell.cwd || projectPath,
                      );
                      setShells((prev) => [...prev, dup]);
                      setActiveShellId(dup.id);
                      if (!isRemoteWorkspace && shell.cwd) onDirectoryChangeRef.current?.(shell.cwd);
                    }}
                    onRevealDirectory={isRemoteWorkspace ? undefined : () => revealShellDirectory(shell.cwd || projectPath)}
                    onMoveToNewWindow={() => { void moveShellToNewWindow(shell); }}
                    renameRequested={renameShellRequestId === shell.id}
                    onRenameRequestHandled={() => setRenameShellRequestId(null)}
                    onSplitH={onSplitHorizontal}
                    onSplitV={onSplitVertical}
                  />
                );
              })}
              {addTabControl}
            </div>
            {/* Trailing split buttons (kooky TabBarView.splitButtons pattern) */}
            <div style={{ display: "flex", gap: 2, paddingRight: 4, flexShrink: 0 }}>
              <button
                onClick={onSplitHorizontal ?? (() => {})}
                title={APP_PLATFORM === 'macos' ? t('terminal.splitRightShortcutMac', 'Split Right (⌘D)') : t('terminal.splitRightShortcut', 'Split Right (Ctrl+Alt+D)')}
                style={{ width: 28, height: 28, borderRadius: 5, border: "none", background: "transparent", color: "rgb(var(--aegis-text-muted))", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.12s, color 0.12s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.08)'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-muted))'; }}
              >
                <SplitSquareHorizontal size={14} />
              </button>
              <button
                onClick={onSplitVertical ?? (() => {})}
                title={APP_PLATFORM === 'macos' ? t('terminal.splitDownShortcutMac', 'Split Down (⌘⇧D)') : t('terminal.splitDownShortcut', 'Split Down (Ctrl+Alt+Shift+D)')}
                style={{ width: 28, height: 28, borderRadius: 5, border: "none", background: "transparent", color: "rgb(var(--aegis-text-muted))", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.12s, color 0.12s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.08)'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-muted))'; }}
              >
                <SplitSquareVertical size={14} />
              </button>
            </div>
          </div>
          {/* 1pt hairline between tab strip and terminal — kooky chromeHairline
              (foreground.opacity(0.07) in dark) */}
          <div style={{ height: 1, background: "rgb(255 255 255 / 0.07)", flexShrink: 0 }}></div>
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
            <PaneSearchBar
              term={activeTermRef.current}
              isOpen={searchOpen}
              onClose={() => setSearchOpen(false)}
            />
            {shells.map((shell) => (
              <ShellTerminalInstance
                key={shell.id}
                ref={(instance) => {
                  shellRefs.current[shell.id] = instance;
                }}
                shellId={shell.id}
                projectPath={isRemoteWorkspace ? '' : shell.cwd || projectPath}
                sshHost={sshHost}
                isActive={isActive && activeShellId === shell.id}
                isFocused={paneFocused && activeShellId === shell.id}
                runtimeState={shell.status}
                restartNonce={shell.restartNonce}
                existingRunId={shell.runId}
                handoffSnapshot={shell.handoffSnapshot}
                themeVariant={themeVariant}
                terminalFontSize={terminalFontSize}
                terminalScrollback={terminalScrollback}
                terminalShiftEnterNewline={terminalShiftEnterNewline}
                monoFontFamily={monoFontFamily}
                onReady={() => {
                  flushPendingTerminalPaste();
                  flushPendingTerminalCommands();
                  onReady?.();
                }}
                onActiveTermChange={(term) => {
                  if (activeShellIdRef.current === shell.id) activeTermRef.current = term;
                }}
                onLifecycleChange={(status, exitCode) => {
                  updateShell(shell.id, { status, ...(exitCode !== undefined ? { exitCode } : {}) });
                }}
                onRunIdChange={(runId) => updateShell(shell.id, runId ? { runId } : { runId: undefined })}
                onAgentActivityChange={(agentActivity) => updateShell(shell.id, { agentActivity: agentActivity ?? undefined })}
                onTerminalHookEvent={(event) => {
                  const toolCalls = applyTerminalToolCallEvent(shell.toolCalls, event);
                  if (toolCalls !== shell.toolCalls) updateShell(shell.id, { toolCalls });
                  const notification = terminalNotificationTrackerRef.current.next(
                    event,
                    shell.id,
                    computeShellTitle(shell),
                  );
                  if (!notification) return;
                  const visible = isActive
                    && paneFocused
                    && activeShellIdRef.current === shell.id
                    && document.visibilityState === 'visible'
                    && document.hasFocus();
                  void invoke<{ id: string }>('push_notification', {
                    level: notification.level,
                    agent: notification.agent,
                    title: notification.title,
                    body: notification.body,
                    url: notification.url,
                  })
                    .then(async (created) => {
                      if (visible && created?.id) {
                        try {
                          await invoke('mark_notification_read', { id: created.id });
                        } catch {
                          // The notification itself is durable even if the
                          // visibility read-state write races a shutdown.
                        }
                      }
                      window.dispatchEvent(new Event(PERSISTENT_NOTIFICATIONS_CHANGED_EVENT));
                    })
                    .catch((error) => debugError('terminal', 'persist terminal notification failed:', error));
                }}
                onCwdChange={(cwd) => {
                  if (isRemoteWorkspace) return;
                  updateShell(shell.id, { cwd });
                  if (activeShellIdRef.current === shell.id) onDirectoryChangeRef.current?.(cwd);
                }}
                onFocus={() => {
                  setActiveShellId(shell.id);
                  onPaneFocus?.();
                }}
                onRestart={() => restartShell(shell.id)}
                onAskAgent={handleAskAgent}
                askAgentLaunchers={availableLaunchers}
                onProxyChange={(proxy) => updateShell(shell.id, { proxy })}
                canZoom={canZoom}
                isZoomed={isZoomed}
                onZoom={onZoom}
                resizeSuspended={resizeSuspended}
              />
            ))}
          </div>
          {/* kooky PaneStatusBar — 底部状态栏 */}
          <PaneStatusBar
            projectPath={isRemoteWorkspace ? '' : shells.find((shell) => shell.id === activeShellId)?.cwd || projectPath}
            proxy={shells.find((shell) => shell.id === activeShellId)?.proxy ?? null}
            agentActivity={shells.find((shell) => shell.id === activeShellId)?.agentActivity}
            toolCalls={shells.find((shell) => shell.id === activeShellId)?.toolCalls}
            remoteHost={isRemoteWorkspace ? sshHost?.trim() : undefined}
            paneId={projectId}
            onToggleComposer={() => setComposerOpen((v) => !v)}
            composerActive={composerOpen}
            canZoom={canZoom}
            isZoomed={isZoomed}
            onZoom={onZoom}
          />
          {/* kooky PaneComposerBar — ⌘L 内嵌输入框 */}
          <PaneComposerBar
            isOpen={composerOpen}
            draft={composerDraft}
            onDraftChange={setComposerDraft}
            onSend={(text) => {
              const sid = activeShellIdRef.current;
              if (sid) shellRefs.current[sid]?.pasteAndSubmit(text);
              setComposerOpen(false);
            }}
            onClose={() => setComposerOpen(false)}
          />
        </div>
        {(terminalDropActive || workspacePathDropActive) && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 4,
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              border: '1px dashed rgb(var(--aegis-primary) / 0.78)',
              background: 'rgb(var(--aegis-primary) / 0.08)',
              color: 'rgb(var(--aegis-text))',
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 12,
            }}
          >
            <span
              style={{
                padding: '6px 10px',
                borderRadius: 5,
                background: 'rgb(var(--aegis-elevated) / 0.94)',
                border: '1px solid rgb(var(--aegis-overlay) / 0.12)',
              }}
            >
              {t('terminal.dropPaths', 'Release to paste file paths')}
            </span>
          </div>
        )}
      </div>
    );
  },
);
