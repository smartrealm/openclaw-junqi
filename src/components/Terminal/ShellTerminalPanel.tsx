import type React from "react";
import { createPortal } from "react-dom";
import { APP_PLATFORM } from "./_nezha-platform";
import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { attachSmartCopy } from "./terminalCopyHelper";
import type { TerminalFontSize, FontFamily, ThemeVariant } from "./_nezha-types";
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
  createShellRunId,
  isGeneratedShellTitle,
  parseOsc7Cwd,
  shellStateFromExit,
  type OpenShellResult,
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
import { combineUnlisteners, subscribeTauriEvent } from '@/utils/tauriEvents';
import { useNotificationStore } from '@/stores/notificationStore';
import { Plus, Terminal as TerminalIcon, X, SplitSquareHorizontal, SplitSquareVertical, PanelLeft, RotateCcw } from "lucide-react";
import { useI18n } from "./i18n-fallback";
import { PaneStatusBar } from "./PaneStatusBar";
import { PaneComposerBar } from "./PaneComposerBar";
import { PaneSearchBar } from "./PaneSearchBar";
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
  if (shell.title && shell.title.trim() && !isGeneratedShellTitle(shell.title)) return shell.title;
  const cwd = shell.cwd ?? '';
  if (!cwd) return shell.title || '~';
  // Support both Unix '/' and Windows '\' path separators
  const trimmed = cwd.replace(/[\/\\]+$/, '');
  if (!trimmed) return '~';
  const seg = trimmed.split(/[\/\\]/).pop() || '~';
  return seg;
}

// ── kooky TabBarItem port: 40pt strip, cornerRadius 6, chromeActive bg,
//    opacity 0.6 inactive foreground, hover-to-show close button,
//    right-click context menu: Close / Close Others / Close to Right / Close All / Rename
//    + HTML5 drag-and-drop reorder (Windows/macOS/Linux)
//    + inline rename popover (no native prompt())

interface TabShellItemProps {
  title: string;
  status: ShellRuntimeState;
  selected: boolean;
  index: number;
  totalCount: number;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
  onCloseOthers?: () => void;
  onCloseAll?: () => void;
  onCloseToRight?: () => void;
  onRename?: (name: string) => void;
  onDuplicate?: () => void;
  onSplitH?: () => void;
  onSplitV?: () => void;
  onDragStart?: (index: number) => void;
  onDragEnter?: (index: number) => void;
  onDragEnd?: () => void;
}

function TabShellItem({
  title, status, selected, index, totalCount,
  onSelect, onClose, onCloseOthers, onCloseAll, onCloseToRight, onRename,
  onDuplicate, onSplitH, onSplitV,
  onDragStart, onDragEnter, onDragEnd,
}: TabShellItemProps) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (!ctxMenu) return;
    const handler = () => setCtxMenu(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ctxMenu]);

  const menuItemStyle: React.CSSProperties = {
    padding: '4px 12px', fontSize: 11, cursor: 'pointer',
    color: 'rgb(var(--aegis-text))', fontFamily: '"JetBrains Mono", monospace',
    whiteSpace: 'nowrap', background: 'transparent', border: 'none',
    textAlign: 'left' as const, width: '100%',
  };
  const menuHover = (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.06)'; };
  const menuLeave = (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; };

  const startRename = () => { setRenameValue(title); setRenaming(true); setCtxMenu(null); };
  const commitRename = () => { const v = renameValue.trim(); if (v) onRename?.(v); setRenaming(false); };

  return (
    <>
      <div
        draggable
        onClick={onSelect}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setDragOver(false); }}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(index); }}
        onDragEnter={(e) => { e.preventDefault(); setDragOver(true); onDragEnter?.(index); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
        onDragLeave={() => setDragOver(false)}
        onDragEnd={() => { setDragOver(false); onDragEnd?.(); }}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "5px 10px", height: 32, minWidth: 0,
          borderRadius: 6, flexShrink: 0, cursor: "pointer",
          background: dragOver ? "rgb(var(--aegis-primary)/0.15)"
            : selected ? "rgb(var(--aegis-overlay)/0.10)"
            : hovered ? "rgb(var(--aegis-overlay)/0.06)"
            : "transparent",
          color: selected ? "rgb(var(--aegis-text))" : "rgb(var(--aegis-text)/0.6)",
          transition: "background 0.12s",
          outline: dragOver ? "1px solid rgb(var(--aegis-primary)/0.4)" : "none",
          outlineOffset: -1,
        }}
      >
        <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
          <TerminalIcon size={12} color={selected ? "rgb(var(--aegis-primary))" : "rgb(var(--aegis-text-dim))"} />
          {status !== 'running' && (
            <span
              title={status === 'starting' ? t('terminal.starting', 'Starting') : t('terminal.exited', 'Exited')}
              style={{
                position: 'absolute', right: -3, bottom: -2, width: 5, height: 5, borderRadius: '50%',
                background: status === 'starting' ? 'rgb(var(--aegis-primary))' : 'rgb(239 68 68)',
                border: '1px solid rgb(var(--terminal-bg))',
              }}
            />
          )}
        </span>
        {renaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
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
          onClick={(e) => { e.stopPropagation(); onClose(e); }}
          title={t('terminal.close', 'Close')}
          style={{
            background: "none", border: "none", color: "rgb(var(--aegis-text-dim))",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 1, borderRadius: 3, cursor: "pointer",
            opacity: (hovered || selected) ? 1 : 0,
            pointerEvents: (hovered || selected) ? "auto" : "none",
            transition: "opacity 0.1s, background 0.12s, color 0.12s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.10)'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-dim))'; }}
        >
          <X size={12} />
        </button>
      </div>

      {ctxMenu && (
        <div style={{
          position: 'fixed', left: Math.min(ctxMenu.x, window.innerWidth - 220), top: Math.min(ctxMenu.y, window.innerHeight - 280), zIndex: 2147482000,
          background: 'rgb(var(--aegis-elevated))', border: '1px solid rgb(255 255 255 / 0.08)',
          borderRadius: 6, boxShadow: '0 8px 24px rgb(0 0 0 / 0.4)',
          padding: '4px 0', minWidth: 180, display: 'flex', flexDirection: 'column',
        }}>
          <button style={menuItemStyle} onMouseEnter={menuHover} onMouseLeave={menuLeave}
            onClick={() => { onClose(null as any); setCtxMenu(null); }}>{t('terminal.close', 'Close')}</button>
          {onCloseOthers && totalCount > 1 && (
            <button style={menuItemStyle} onMouseEnter={menuHover} onMouseLeave={menuLeave}
              onClick={() => { onCloseOthers(); setCtxMenu(null); }}>{t('terminal.closeOthers', 'Close Others')}</button>
          )}
          {onCloseToRight && index < totalCount - 1 && (
            <button style={menuItemStyle} onMouseEnter={menuHover} onMouseLeave={menuLeave}
              onClick={() => { onCloseToRight(); setCtxMenu(null); }}>{t('terminal.closeTabsToRight', 'Close Tabs to the Right')}</button>
          )}
          {onCloseAll && (
            <button style={menuItemStyle} onMouseEnter={menuHover} onMouseLeave={menuLeave}
              onClick={() => { onCloseAll(); setCtxMenu(null); }}>{t('terminal.closeAll', 'Close All')}</button>
          )}
          <div style={{ height: 1, background: 'rgb(255 255 255 / 0.07)', margin: '3px 0' }} />
          {onRename && (
            <button style={menuItemStyle} onMouseEnter={menuHover} onMouseLeave={menuLeave}
              onClick={startRename}>{t('terminal.rename', 'Rename...')}</button>
          )}
          {onDuplicate && (
            <button style={menuItemStyle} onMouseEnter={menuHover} onMouseLeave={menuLeave}
              onClick={() => { onDuplicate(); setCtxMenu(null); }}>{t('terminal.duplicateTab', 'Duplicate Tab')}</button>
          )}
          {(onSplitH || onSplitV) && <div style={{ height: 1, background: 'rgb(255 255 255 / 0.07)', margin: '3px 0' }} />}
          {onSplitH && (
            <button style={menuItemStyle} onMouseEnter={menuHover} onMouseLeave={menuLeave}
              onClick={() => { onSplitH(); setCtxMenu(null); }}>
              {t('terminal.splitRight', 'Split Right')}
            </button>
          )}
          {onSplitV && (
            <button style={menuItemStyle} onMouseEnter={menuHover} onMouseLeave={menuLeave}
              onClick={() => { onSplitV(); setCtxMenu(null); }}>
              {t('terminal.splitDown', 'Split Down')}
            </button>
          )}
        </div>
      )}
    </>
  );
}
interface ShellTerminalInstanceHandle {
  sendCommand: (cmd: string) => boolean;
  pasteText: (text: string) => boolean;
  pasteAndSubmit: (text: string) => boolean;
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
  title: string;
  cwd?: string;
  status: ShellRuntimeState;
  exitCode?: number | null;
  restartNonce: number;
}

interface Props {
  projectPath: string;
  projectId: string;
  isActive?: boolean;
  onClose: () => void;
  themeVariant: ThemeVariant;
  terminalFontSize: TerminalFontSize;
  monoFontFamily: FontFamily;
  onReady?: () => void;
  height?: number;
  onResizeStart?: (e: React.MouseEvent) => void;
  /** kooky TabBarView.splitButtons: split Right / Down triggers. */
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  /** Only the focused pane is allowed to claim keyboard focus / global shortcuts. */
  paneFocused?: boolean;
  onPaneFocus?: () => void;
  onDirectoryChange?: (cwd: string) => void;
  /** kooky StatusBarIconButton zoom — wired from PaneTreeView */
  canZoom?: boolean;
  isZoomed?: boolean;
  onZoom?: () => void;
  onToggleSidebar?: () => void;
  sidebarActive?: boolean;
  /** Parent split divider is moving; defer PTY resizes until its final size. */
  resizeSuspended?: boolean;
}

const MAX_SHELLS = 5;
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
        .filter((s: unknown): s is { id: string; title: string; cwd?: string } => (
          typeof s === 'object' && s !== null
          && typeof (s as { id?: unknown }).id === 'string'
          && typeof (s as { title?: unknown }).title === 'string'
        ))
        .map((shell): ShellSession => ({
          id: shell.id,
          title: shell.title,
          ...(typeof shell.cwd === 'string' && shell.cwd.trim() ? { cwd: shell.cwd.trim() } : {}),
          status: 'starting' as const,
          restartNonce: 0,
        }));
    if (shells.length === 0) return null;
    return {
      shells: shells.slice(0, MAX_SHELLS),
      activeShellId: shells.some((s: ShellSession) => s.id === parsed?.activeShellId) ? parsed.activeShellId : shells[0].id,
      nextIndex: Number.isFinite(parsed?.nextIndex) ? Math.max(2, Number(parsed.nextIndex)) : shells.length + 1,
    };
  } catch {
    return null;
  }
}

function saveShellState(projectId: string, shells: ShellSession[], activeShellId: string | null, nextIndex: number): void {
  try {
    const persistedShells = shells.map(({ id, title, cwd }) => ({ id, title, ...(cwd ? { cwd } : {}) }));
    localStorage.setItem(shellPersistKey(projectId), JSON.stringify({ shells: persistedShells, activeShellId, nextIndex }));
  } catch {}
}

function createShellSession(projectId: string, index: number, cwd?: string): ShellSession {
  return {
    id: `shell:${projectId}:${index}:${Date.now()}`,
    title: `Terminal ${index}`,
    ...(cwd ? { cwd } : {}),
    status: 'starting',
    restartNonce: 0,
  };
}

const ShellTerminalInstance = forwardRef<ShellTerminalInstanceHandle, {
  shellId: string;
  projectPath: string;
  isActive: boolean;
  isFocused: boolean;
  runtimeState: ShellRuntimeState;
  restartNonce: number;
  themeVariant: ThemeVariant;
  terminalFontSize: TerminalFontSize;
  monoFontFamily: FontFamily;
  onReady?: () => void;
  onActiveTermChange?: (term: XTermType | null) => void;
  onLifecycleChange?: (state: ShellRuntimeState, exitCode?: number | null) => void;
  onCwdChange?: (cwd: string) => void;
  onFocus?: () => void;
  onRestart?: () => void;
  resizeSuspended?: boolean;
}>(
  function ShellTerminalInstance(
    {
      shellId,
      projectPath,
      isActive,
      isFocused,
      runtimeState,
      restartNonce,
      themeVariant,
      terminalFontSize,
      monoFontFamily,
      onReady,
      onActiveTermChange,
      onLifecycleChange,
      onCwdChange,
      onFocus,
      onRestart,
      resizeSuspended = false,
    },
    ref,
  ) {
    const { t } = useI18n();
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<XTerm | null>(null);
    const [termCtxMenu, setTermCtxMenu] = useState<{ x: number; y: number } | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const themeVariantRef = useRef(themeVariant);
    const isActiveRef = useRef(isActive);
    const isFocusedRef = useRef(isFocused);
    const terminalFontSizeRef = useRef(terminalFontSize);
    const monoFontFamilyRef = useRef(monoFontFamily);
    const onReadyRef = useRef(onReady);
    const onLifecycleChangeRef = useRef(onLifecycleChange);
    const onCwdChangeRef = useRef(onCwdChange);
    const onFocusRef = useRef(onFocus);
    const runIdRef = useRef<string | null>(null);
    const launchPathStateRef = useRef<ShellLaunchPathState | null>(null);
    const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const pendingResizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const resizeSuspendedRef = useRef(resizeSuspended);
    themeVariantRef.current = themeVariant;
    isActiveRef.current = isActive;
    isFocusedRef.current = isFocused;
    terminalFontSizeRef.current = terminalFontSize;
    monoFontFamilyRef.current = monoFontFamily;
    onReadyRef.current = onReady;
    onLifecycleChangeRef.current = onLifecycleChange;
    onCwdChangeRef.current = onCwdChange;
    onFocusRef.current = onFocus;
    resizeSuspendedRef.current = resizeSuspended;
    launchPathStateRef.current = advanceShellLaunchPath(
      launchPathStateRef.current,
      projectPath,
      restartNonce,
    );
    const launchProjectPath = launchPathStateRef.current.path;

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
      let listenersReady = false;
      let shellStarted = false;
      let startShell: (() => void) | null = null;

      const { term, fitAddon, whenFontsReady } = initTerminal(
        themeVariantRef.current,
        5000,
        terminalFontSizeRef.current,
        monoFontFamilyRef.current,
      );
      applyTerminalThemeOnPanel(term, themeVariantRef.current, container);
      terminalRef.current = term;
      if (isActiveRef.current) onActiveTermChange?.(term as unknown as XTermType);
      fitAddonRef.current = fitAddon;

      let disposeCharSizeOverride: (() => void) | null = null;
      let disposeScrollbarAutoHide: (() => void) | null = null;
      let disposeInputFix: (() => void) | null = null;
      let webglHandle: { dispose(): void } | null = null;
      let writer: ReturnType<typeof createSmartWriter> | null = null;
      let disposeMacWebKitGuard: (() => void) | null = null;
      let disposeSmartCopy: (() => void) | null = null;
      let disposeNativeImagePaste: (() => void) | null = null;
      let disposeOnData: { dispose(): void } | null = null;
      let disposeTermFocus: { dispose(): void } | null = null;
      let disposeOscCwd: { dispose(): void } | null = null;
      let resizeObserver: ResizeObserver | null = null;
      let visibilityHandler: (() => void) | null = null;
      let opened = false;

      const subscribe = async () => {
        const [outputUnlisten, exitUnlisten] = await Promise.all([
          listen<ShellOutputEvent>('shell-output', (event) => {
            if (
              event.payload.shell_id === shellId
              && event.payload.run_id === runIdRef.current
              && terminalRef.current
              && writer
            ) {
              writer.write(event.payload.data);
            }
          }),
          listen<ShellExitEvent>('shell-exit', (event) => {
            if (event.payload.shell_id !== shellId || event.payload.run_id !== runIdRef.current) return;
            onLifecycleChangeRef.current?.(
              shellStateFromExit(event.payload),
              event.payload.exit_code,
            );
          }),
        ]);
        if (cleaned) {
          outputUnlisten();
          exitUnlisten();
          return;
        }
        unlistenOutput = outputUnlisten;
        unlistenExit = exitUnlisten;
        listenersReady = true;
        startShell?.();
      };
      void subscribe();

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
        disposeMacWebKitGuard = attachMacWebKitTerminalGuard({ term, container, writer });
        disposeSmartCopy = attachSmartCopy(term, { onPaste: pasteFromSystemClipboard });
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
              cols: size?.cols ?? term.cols,
              rows: size?.rows ?? term.rows,
              runId: requestedRunId,
            })
              .then((result) => {
                if (cleaned || result.run_id !== requestedRunId) return;
                runIdRef.current = result.run_id;
                onCwdChangeRef.current?.(result.cwd);
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
        disposeSafeOpen?.();
        if (initTimeoutId !== null) window.clearTimeout(initTimeoutId);
        if (readyTimeoutId !== null) window.clearTimeout(readyTimeoutId);
        unlistenOutput?.();
        unlistenExit?.();
        disposeSmartCopy?.();
        disposeNativeImagePaste?.();
        disposeOnData?.dispose();
        disposeTermFocus?.dispose();
        disposeOscCwd?.dispose();
        resizeObserver?.disconnect();
        if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
        if (isActiveRef.current) onActiveTermChange?.(null);
        terminalRef.current = null;
        fitAddonRef.current = null;
        disposeCharSizeOverride?.();
        try { webglHandle?.dispose(); } catch { /* addon may not have loaded */ }
        disposeScrollbarAutoHide?.();
        disposeMacWebKitGuard?.();
        disposeInputFix?.();
        try { term.dispose(); } catch { /* already gone — rapid tab close */ }
        if (runId) invoke('kill_shell', { shellId, runId }).catch(() => {});
      };
    }, [flushPendingResize, launchProjectPath, pasteFromSystemClipboard, requestResize, restartNonce, sendInput, shellId]);

    useEffect(() => {
      if (!isActive) return;
      if (terminalRef.current) onActiveTermChange?.(terminalRef.current as unknown as XTermType);
      window.requestAnimationFrame(() => {
        if (!fitAddonRef.current || !terminalRef.current || !containerRef.current) return;
        const s = safeFit(fitAddonRef.current, terminalRef.current, containerRef.current);
        requestResize(s);
        refreshTerminalDisplay(terminalRef.current);
        if (isFocused) terminalRef.current.focus();
      });
    }, [isActive, isFocused, onActiveTermChange, requestResize]);

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
      const selected = terminalRef.current?.getSelection?.() ?? '';
      if (selected) await navigator.clipboard.writeText(selected);
      setTermCtxMenu(null);
      terminalRef.current?.focus();
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

    const terminalMenu = termCtxMenu ? createPortal(
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: Math.max(8, Math.min(termCtxMenu.x, window.innerWidth - 180)),
          top: Math.max(8, Math.min(termCtxMenu.y, window.innerHeight - 180)),
          zIndex: 2147482000,
          minWidth: 150,
          padding: '4px 0',
          borderRadius: 6,
          background: 'rgb(var(--aegis-elevated))',
          border: '1px solid rgb(var(--aegis-overlay)/0.10)',
          boxShadow: '0 8px 24px rgb(0 0 0 / 0.4)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <button style={menuItemStyle} onMouseEnter={(e) => (e.currentTarget.style.background = 'rgb(var(--aegis-overlay)/0.08)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')} onClick={copySelection}>{t('terminal.copy', 'Copy')}</button>
        <button style={menuItemStyle} onMouseEnter={(e) => (e.currentTarget.style.background = 'rgb(var(--aegis-overlay)/0.08)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')} onClick={() => void pasteClipboard()}>{t('terminal.paste', 'Paste')}</button>
        <button style={menuItemStyle} onMouseEnter={(e) => (e.currentTarget.style.background = 'rgb(var(--aegis-overlay)/0.08)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')} onClick={selectAllTerminal}>{t('terminal.selectAll', 'Select All')}</button>
        <div style={{ height: 1, background: 'rgb(var(--aegis-overlay)/0.08)', margin: '3px 0' }} />
        <button style={menuItemStyle} onMouseEnter={(e) => (e.currentTarget.style.background = 'rgb(var(--aegis-overlay)/0.08)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')} onClick={clearTerminal}>{t('terminal.clear', 'Clear')}</button>
      </div>,
      document.body,
    ) : null;

    return (
      <>
        <div
          ref={containerRef}
          className="nezha-xterm-host nezha-shell-xterm-host"
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
            padding: "4px 0 16px 6px",
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
      projectId,
      isActive = true,
      onClose,
      themeVariant,
      terminalFontSize,
      monoFontFamily,
      onReady,
      onSplitHorizontal,
      onSplitVertical,
      height = 240,
      onResizeStart,
      canZoom,
      isZoomed,
      onZoom,
      onToggleSidebar,
      sidebarActive,
      paneFocused = isActive,
      onPaneFocus,
      onDirectoryChange,
      resizeSuspended = false,
    },
    ref,
  ) {
    const { t } = useI18n();
    const addToast = useNotificationStore((state) => state.addToast);
    const initialStateRef = useRef<{ shells: ShellSession[]; activeShellId: string | null; nextIndex: number } | null>(null);
    if (!initialStateRef.current) {
      initialStateRef.current = loadShellState(projectId) ?? (() => {
        const initial = createShellSession(projectId, 1, projectPath);
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
    const [terminalDropActive, setTerminalDropActive] = useState(false);
    const [workspacePathDropActive, setWorkspacePathDropActive] = useState(false);
    const activeShellIdRef = useRef(activeShellId);
    activeShellIdRef.current = activeShellId;
    const onDirectoryChangeRef = useRef(onDirectoryChange);
    onDirectoryChangeRef.current = onDirectoryChange;
    useTerminalDropTarget(projectId, panelRef);

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

    const handleAddShell = useCallback(() => {
      if (shells.length >= MAX_SHELLS) return;
      const activeCwd = shells.find((shell) => shell.id === activeShellId)?.cwd || projectPath;
      const nextShell = createShellSession(projectId, nextShellIndexRef.current++, activeCwd);
      setShells((prev) => [...prev, nextShell]);
      setActiveShellId(nextShell.id);
      if (activeCwd) onDirectoryChangeRef.current?.(activeCwd);
    }, [activeShellId, projectId, projectPath, shells]);

    const updateShell = useCallback((shellId: string, patch: Partial<ShellSession>) => {
      setShells((previous) => previous.map((shell) => (
        shell.id === shellId ? { ...shell, ...patch } : shell
      )));
    }, []);

    const restartShell = useCallback((shellId: string) => {
      setShells((previous) => previous.map((shell) => (
        shell.id === shellId
          ? { ...shell, status: 'starting', exitCode: undefined, restartNonce: shell.restartNonce + 1 }
          : shell
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

    return (
      <div
        ref={panelRef}
        onDragOverCapture={handleWorkspacePathDragOver}
        onDragLeaveCapture={handleWorkspacePathDragLeave}
        onDropCapture={handleWorkspacePathDrop}
        style={{
          flex: 1,
          height: height != null ? height : undefined,
          borderTop: "1px solid var(--aegis-border)",
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
          <div style={{ display: "flex", alignItems: "center", height: 32, flexShrink: 0, padding: "0 8px", gap: 2, background: "var(--terminal-bg)" }}>
            {onToggleSidebar && (
              <button
                onClick={onToggleSidebar}
                title={t('terminal.workspaceToggleSidebar', 'Toggle sidebar')}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 5,
                  border: 'none',
                  background: sidebarActive ? 'rgb(var(--aegis-primary)/0.12)' : 'transparent',
                  color: sidebarActive ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text-muted))',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'background 0.12s, color 0.12s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = sidebarActive ? 'rgb(var(--aegis-primary)/0.16)' : 'rgb(var(--aegis-overlay)/0.08)'; (e.currentTarget as HTMLElement).style.color = sidebarActive ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text))'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = sidebarActive ? 'rgb(var(--aegis-primary)/0.12)' : 'transparent'; (e.currentTarget as HTMLElement).style.color = sidebarActive ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text-muted))'; }}
              >
                <PanelLeft size={14} />
              </button>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 2, flex: 1, overflowX: "auto", scrollbarWidth: "none" }}>
              {shells.map((shell, idx) => {
                const selected = activeShellId === shell.id;
                const tabTitle = computeShellTitle(shell);
                return (
                  <TabShellItem
                    key={shell.id}
                    title={tabTitle}
                    status={shell.status}
                    selected={selected}
                    index={idx}
                    totalCount={shells.length}
                    onSelect={() => {
                      setActiveShellId(shell.id);
                      if (shell.cwd) onDirectoryChangeRef.current?.(shell.cwd);
                      onPaneFocus?.();
                    }}
                    onClose={(e) => { e.stopPropagation(); handleCloseShell(shell.id); }}
                    onCloseOthers={() => {
                      const toClose = shells.filter((s) => s.id !== shell.id);
                      toClose.forEach((s) => { delete shellRefs.current[s.id]; });
                      setShells([shell]);
                      setActiveShellId(shell.id);
                    }}
                    onCloseToRight={() => {
                      const toClose = shells.slice(idx + 1);
                      toClose.forEach((s) => { delete shellRefs.current[s.id]; });
                      const next = shells.slice(0, idx + 1);
                      setShells(next);
                      if (activeShellId && toClose.some((s) => s.id === activeShellId)) {
                        setActiveShellId(shell.id);
                      }
                    }}
                    onCloseAll={() => {
                      shells.forEach((s) => { delete shellRefs.current[s.id]; });
                      setShells([]);
                      onClose();
                    }}
                    onRename={(name) => {
                      setShells((prev) => prev.map((s) =>
                        s.id === shell.id ? { ...s, title: name } : s,
                      ));
                    }}
                    onDragStart={(i) => { dragSrcIdxRef.current = i; }}
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
                    onDuplicate={() => {
                      const dup = createShellSession(projectId, nextShellIndexRef.current++, shell.cwd || projectPath);
                      setShells((prev) => [...prev, { ...dup, title: shell.title }]);
                      setActiveShellId(dup.id);
                      if (shell.cwd) onDirectoryChangeRef.current?.(shell.cwd);
                    }}
                    onSplitH={onSplitHorizontal}
                    onSplitV={onSplitVertical}
                  />
                );
              })}
            </div>
            {/* Trailing split buttons (kooky TabBarView.splitButtons pattern) */}
            <div style={{ display: "flex", gap: 2, paddingRight: 4, flexShrink: 0 }}>
              <button
                onClick={handleAddShell}
                disabled={shells.length >= MAX_SHELLS}
                title={shells.length >= MAX_SHELLS ? t("terminal.limitReached") : t("terminal.newTerminal")}
                style={{ width: 28, height: 28, borderRadius: 5, border: "none", background: "transparent", color: "rgb(var(--aegis-text-secondary))", cursor: shells.length >= MAX_SHELLS ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.12s, color 0.12s" }}
                onMouseEnter={(e) => { if (shells.length < MAX_SHELLS) { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.08)'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; } }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-secondary))'; }}
              >
                <Plus size={14} />
              </button>
              <button
                onClick={onSplitHorizontal ?? (() => {})}
                title={APP_PLATFORM === 'macos' ? t('terminal.splitRightShortcutMac', 'Split Right (⌘D)') : t('terminal.splitRightShortcut', 'Split Right (Ctrl+D)')}
                style={{ width: 28, height: 28, borderRadius: 5, border: "none", background: "transparent", color: "rgb(var(--aegis-text-muted))", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.12s, color 0.12s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.08)'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-muted))'; }}
              >
                <SplitSquareHorizontal size={14} />
              </button>
              <button
                onClick={onSplitVertical ?? (() => {})}
                title={APP_PLATFORM === 'macos' ? t('terminal.splitDownShortcutMac', 'Split Down (⌘⇧D)') : t('terminal.splitDownShortcut', 'Split Down (Ctrl+Shift+D)')}
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
                projectPath={shell.cwd || projectPath}
                isActive={isActive && activeShellId === shell.id}
                isFocused={paneFocused && activeShellId === shell.id}
                runtimeState={shell.status}
                restartNonce={shell.restartNonce}
                themeVariant={themeVariant}
                terminalFontSize={terminalFontSize}
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
                onCwdChange={(cwd) => {
                  updateShell(shell.id, { cwd });
                  if (activeShellIdRef.current === shell.id) onDirectoryChangeRef.current?.(cwd);
                }}
                onFocus={() => {
                  setActiveShellId(shell.id);
                  onPaneFocus?.();
                }}
                onRestart={() => restartShell(shell.id)}
                resizeSuspended={resizeSuspended}
              />
            ))}
          </div>
          {/* kooky PaneStatusBar — 底部状态栏 */}
          <PaneStatusBar
            projectPath={shells.find((shell) => shell.id === activeShellId)?.cwd || projectPath}
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
