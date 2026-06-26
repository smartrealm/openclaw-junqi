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
import { Plus, Terminal as TerminalIcon, Trash2, X, SplitSquareHorizontal, SplitSquareVertical, PanelLeft } from "lucide-react";
import { useI18n } from "./i18n-fallback";
import { PaneStatusBar } from "./PaneStatusBar";
import { PaneComposerBar } from "./PaneComposerBar";
import { PaneSearchBar } from "./PaneSearchBar";
import type { Terminal as XTermType } from '@xterm/xterm';
import "@xterm/xterm/css/xterm.css";

interface ShellOutputEvent {
  shell_id: string;
  data: string;
}

export interface ShellTerminalPanelHandle {
  sendCommand: (cmd: string) => void;
}

// ─────────────────────────────────────────────────────────────────
// computeShellTitle — kooky Session.title precedence:
//   1. customTitle (user-set)         — not yet supported via UI
//   2. terminalTitle (OSC 0/2 report)  — wired via agent_task_pty backend
//   3. "~" if cwd == $HOME              — never reached (backend always sets terminalTitle)
//   4. lastPathComponent(cwd)          — fallback
// In practice (2) dominates; fall-through is rare.
// ─────────────────────────────────────────────────────────────────
function computeShellTitle(shell: ShellSession): string {
  if (shell.title && shell.title.trim()) return shell.title;
  const cwd = (shell as ShellSession & { cwd?: string }).cwd ?? '';
  if (!cwd) return '~';
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
  title, selected, index, totalCount,
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
        <TerminalIcon size={12} color={selected ? "rgb(var(--aegis-primary))" : "rgb(var(--aegis-text-dim))"} />
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
  sendCommand: (cmd: string) => void;
}

interface ShellSession {
  id: string;
  title: string;
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
  /** PaneNode leaf config — overrides defaults when inside a PaneTreeView. */
  paneConfig?: {
    kind?: string;
    agent?: string;
    label?: string;
    projectPath?: string;
  };
  /** kooky StatusBarIconButton zoom — wired from PaneTreeView */
  canZoom?: boolean;
  isZoomed?: boolean;
  onZoom?: () => void;
  onToggleSidebar?: () => void;
  sidebarActive?: boolean;
}

const MAX_SHELLS = 5;

function shellPersistKey(projectId: string): string {
  return `junqi:terminal-shells:${projectId}`;
}

function loadShellState(projectId: string): { shells: ShellSession[]; activeShellId: string | null; nextIndex: number } | null {
  try {
    const raw = localStorage.getItem(shellPersistKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const shells = Array.isArray(parsed?.shells)
      ? parsed.shells.filter((s: any): s is ShellSession => typeof s?.id === 'string' && typeof s?.title === 'string')
      : [];
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
    localStorage.setItem(shellPersistKey(projectId), JSON.stringify({ shells, activeShellId, nextIndex }));
  } catch {}
}

function createShellSession(projectId: string, index: number): ShellSession {
  return {
    id: `shell:${projectId}:${index}:${Date.now()}`,
    title: `Terminal ${index}`,
  };
}

const ShellTerminalInstance = forwardRef<ShellTerminalInstanceHandle, {
  shellId: string;
  projectPath: string;
  isActive: boolean;
  themeVariant: ThemeVariant;
  terminalFontSize: TerminalFontSize;
  monoFontFamily: FontFamily;
  onReady?: () => void;
  onActiveTermChange?: (term: XTermType | null) => void;
}>(
  function ShellTerminalInstance(
    { shellId, projectPath, isActive, themeVariant, terminalFontSize, monoFontFamily, onReady, onActiveTermChange },
    ref,
  ) {
    const { t } = useI18n();
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<XTerm | null>(null);
    const [termCtxMenu, setTermCtxMenu] = useState<{ x: number; y: number } | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const themeVariantRef = useRef(themeVariant);
    const isActiveRef = useRef(isActive);
    const terminalFontSizeRef = useRef(terminalFontSize);
    const monoFontFamilyRef = useRef(monoFontFamily);
    const onReadyRef = useRef(onReady);
    const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    themeVariantRef.current = themeVariant;
    isActiveRef.current = isActive;
    terminalFontSizeRef.current = terminalFontSize;
    monoFontFamilyRef.current = monoFontFamily;
    onReadyRef.current = onReady;

    useImperativeHandle(
      ref,
      () => ({
        sendCommand: (cmd: string) => {
          invoke("send_input", { taskId: shellId, data: cmd }).catch(console.error);
        },
      }),
      [shellId],
    );

    useEffect(() => {
      if (!containerRef.current) return;
      const container = containerRef.current;
      let cleaned = false;
      let initTimeoutId: number | null = null;
      let readyTimeoutId: number | null = null;
      let disposeSafeOpen: (() => void) | null = null;

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

      // Holders for addons wired in openAndWire so the cleanup function can
      // dispose them even when term.open() was deferred.
      let disposeCharSizeOverride: (() => void) | null = null;
      let disposeScrollbarAutoHide: (() => void) | null = null;
      let disposeInputFix: (() => void) | null = null;
      let webglHandle: { dispose(): void } | null = null;
      let writer: ReturnType<typeof createSmartWriter> | null = null;
      let disposeMacWebKitGuard: (() => void) | null = null;
      let disposeSmartCopy: (() => void) | null = null;
      let disposeOnData: { dispose(): void } | null = null;
      let resizeObserver: ResizeObserver | null = null;
      let unlisten: (() => void) | null = null;
      let visibilityHandler: (() => void) | null = null;
      let opened = false;

      // safeOpenTerminal defers term.open() until the container has non-zero
      // dimensions. xterm.js throws "dimensions" / "syncScrollArea" errors
      // when open() runs against a 0-size container (common with flex:1
      // layouts whose final size isn't resolved on the first effect tick).
      // All addons must be wired AFTER open — they depend on term.element.
      const openAndWire = () => {
        if (opened || cleaned) return;
        opened = true;

        // 必须在 term.open() 之后挂：_charSizeService 在 open 时才实例化。
        disposeCharSizeOverride = applyDomCharSizeOverride(term);
        disposeScrollbarAutoHide = attachTerminalScrollbarAutoHide(term, container);
        disposeInputFix = attachMacWebKitShiftInputFix(term);
        webglHandle = loadWebglAddon(term);
        writer = createSmartWriter(term);
        disposeMacWebKitGuard = attachMacWebKitTerminalGuard({ term, container, writer });

        const fit = () => {
          if (cleaned) return;
          const s = safeFit(fitAddon, term, container);
          if (!s) return;
          const last = lastSizeRef.current;
          if (last && last.cols === s.cols && last.rows === s.rows) return;
          lastSizeRef.current = { cols: s.cols, rows: s.rows };
          invoke("resize_pty", { taskId: shellId, cols: s.cols, rows: s.rows }).catch(() => {});
        };

        // 字体 ready 后真实 cell 宽度可能变化，再 fit 一次让 cols/rows 跟上。
        whenFontsReady.then(() => {
          if (cleaned) return;
          fit();
        });

        initTimeoutId = window.setTimeout(() => {
          if (cleaned) return;
          fit();
          invoke<void>("open_shell", {
            shellId,
            projectPath,
            cols: term.cols,
            rows: term.rows,
          })
            .then(() => {
              if (cleaned) return;
              readyTimeoutId = window.setTimeout(() => {
                if (!cleaned) {
                  onReadyRef.current?.();
                }
              }, 300);
            })
            .catch(console.error);
          if (isActiveRef.current) {
            term.focus();
          }
        }, 50);

        disposeSmartCopy = attachSmartCopy(term);

        // ── 微批处理缓冲：解决 UU远程桌面/VNC 等工具通过 WKWebView insertText:
        //    逐字符注入时每字符单独触发 onData 的问题。
        //
        //    原理：原生终端（Terminal.app）走 NSTextInputClient.insertText:，
        //    AppKit 天然批量；WKWebView 只有 keydown 事件，每字符一次。
        //    用 queueMicrotask 把同一微任务检查点内收到的所有字符合并成一次
        //    send_input，延迟 < 1ms，对正常键盘（字符间隔 > 30ms）完全透明。
        let inputBuf = '';
        let inputFlushPending = false;
        const flushInputBuf = () => {
          inputFlushPending = false;
          if (!inputBuf) return;
          const data = inputBuf;
          inputBuf = '';
          invoke("send_input", { taskId: shellId, data }).catch(() => {});
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

        // Use rAF instead of setTimeout so fit() runs outside the ResizeObserver
        // notification cycle, preventing the benign but noisy Tauri JS error:
        // "ResizeObserver loop completed with undelivered notifications"
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
          if (document.visibilityState !== "visible" || !terminalRef.current || !isActiveRef.current) return;
          window.requestAnimationFrame(() => {
            fit();
            const t = terminalRef.current;
            if (t) {
              refreshTerminalDisplay(t);
              t.focus();
            }
          });
        };
        visibilityHandler = handleVisibilityChange;
        document.addEventListener("visibilitychange", handleVisibilityChange);

        listen<ShellOutputEvent>("shell-output", (event) => {
          if (event.payload.shell_id === shellId && terminalRef.current && writer) {
            writer.write(event.payload.data);
          }
        }).then((fn) => {
          if (cleaned) {
            fn();
          } else {
            unlisten = fn;
          }
        });
      };

      disposeSafeOpen = safeOpenTerminal(term, container, openAndWire);

      return () => {
        cleaned = true;
        disposeSafeOpen?.();
        if (initTimeoutId !== null) {
          window.clearTimeout(initTimeoutId);
        }
        if (readyTimeoutId !== null) {
          window.clearTimeout(readyTimeoutId);
        }
        unlisten?.();
        disposeSmartCopy?.();
        disposeOnData?.dispose();
        resizeObserver?.disconnect();
        if (visibilityHandler) {
          document.removeEventListener("visibilitychange", visibilityHandler);
        }
        if (isActiveRef.current) onActiveTermChange?.(null);
        terminalRef.current = null;
        fitAddonRef.current = null;
        disposeCharSizeOverride?.();
        try { webglHandle?.dispose(); } catch { /* addon may not have loaded */ }
        disposeScrollbarAutoHide?.();
        disposeMacWebKitGuard?.();
        disposeInputFix?.();
        try { term.dispose(); } catch { /* already gone — rapid tab close */ }
        invoke("kill_shell", { shellId }).catch(() => {});
      };
    }, [shellId, projectPath]);

    useEffect(() => {
      if (!isActive) return;
      if (terminalRef.current) onActiveTermChange?.(terminalRef.current as unknown as XTermType);
      window.requestAnimationFrame(() => {
        if (!fitAddonRef.current || !terminalRef.current || !containerRef.current) return;
        const s = safeFit(fitAddonRef.current, terminalRef.current, containerRef.current);
        if (s) {
          const last = lastSizeRef.current;
          if (!last || last.cols !== s.cols || last.rows !== s.rows) {
            lastSizeRef.current = { cols: s.cols, rows: s.rows };
            invoke("resize_pty", { taskId: shellId, cols: s.cols, rows: s.rows }).catch(() => {});
          }
        }
        refreshTerminalDisplay(terminalRef.current);
        terminalRef.current.focus();
      });
    }, [isActive, shellId, onActiveTermChange]);

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
      const last = lastSizeRef.current;
      if (last && last.cols === size.cols && last.rows === size.rows) return;
      lastSizeRef.current = { cols: size.cols, rows: size.rows };
      invoke("resize_pty", { taskId: shellId, cols: size.cols, rows: size.rows }).catch(() => {});
    }, [terminalFontSize, shellId]);

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
      const data = await navigator.clipboard.readText().catch(() => '');
      if (data) invoke('send_input', { taskId: shellId, data }).catch(() => {});
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
      const pushResize = (size: { cols: number; rows: number } | null) => {
        if (!size) return;
        const last = lastSizeRef.current;
        if (last && last.cols === size.cols && last.rows === size.rows) return;
        lastSizeRef.current = { cols: size.cols, rows: size.rows };
        invoke("resize_pty", { taskId: shellId, cols: size.cols, rows: size.rows }).catch(() => {});
      };
      pushResize(result.immediate);
      let cancelled = false;
      result.whenSettled.then((s) => {
        if (cancelled) return;
        pushResize(s);
      });
      return () => {
        cancelled = true;
      };
    }, [monoFontFamily, shellId]);

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
          onMouseDown={() => terminalRef.current?.focus()}
          onContextMenu={(e) => {
            if (!isActive) return;
            e.preventDefault();
            e.stopPropagation();
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
    },
    ref,
  ) {
    const { t } = useI18n();
    const initialStateRef = useRef<{ shells: ShellSession[]; activeShellId: string | null; nextIndex: number } | null>(null);
    if (!initialStateRef.current) {
      initialStateRef.current = loadShellState(projectId) ?? (() => {
        const initial = createShellSession(projectId, 1);
        return { shells: [initial], activeShellId: initial.id, nextIndex: 2 };
      })();
    }

    const nextShellIndexRef = useRef(initialStateRef.current.nextIndex);
    const dragSrcIdxRef = useRef<number | null>(null);
    const dragDstIdxRef = useRef<number | null>(null);
    const shellRefs = useRef<Record<string, ShellTerminalInstanceHandle | null>>({});
    const [shells, setShells] = useState<ShellSession[]>(() => initialStateRef.current!.shells);
    const [activeShellId, setActiveShellId] = useState<string | null>(() => initialStateRef.current!.activeShellId);
    const activeShellIdRef = useRef(activeShellId);
    activeShellIdRef.current = activeShellId;

    useEffect(() => {
      saveShellState(projectId, shells, activeShellId, nextShellIndexRef.current);
    }, [projectId, shells, activeShellId]);

    useImperativeHandle(
      ref,
      () => ({
        sendCommand: (cmd: string) => {
          const currentShellId = activeShellIdRef.current;
          if (!currentShellId) return;
          shellRefs.current[currentShellId]?.sendCommand(cmd);
        },
      }),
      [],
    );

    // ── kooky ComposerBar 状态 ──
    const [composerOpen, setComposerOpen] = useState(false);
    const [composerDraft, setComposerDraft] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);
    const activeTermRef = useRef<XTermType | null>(null);

    // ── ⌘L / Ctrl+L 快捷键 — 切换 ComposerBar ──
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
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
    }, []);

    const handleAddShell = useCallback(() => {
      if (shells.length >= MAX_SHELLS) return;
      const nextShell = createShellSession(projectId, nextShellIndexRef.current++);
      setShells((prev) => [...prev, nextShell]);
      setActiveShellId(nextShell.id);
    }, [projectId, shells.length]);

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
        style={{
          flex: 1,
          height: height != null ? height : undefined,
          borderTop: "1px solid var(--aegis-border)",
          display: "flex",
          flexDirection: "column",
          background: "var(--aegis-elevated)",
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
                    selected={selected}
                    index={idx}
                    totalCount={shells.length}
                    onSelect={() => setActiveShellId(shell.id)}
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
                      const dup = createShellSession(projectId, nextShellIndexRef.current++);
                      setShells((prev) => [...prev, { ...dup, title: shell.title }]);
                      setActiveShellId(dup.id);
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
                projectPath={projectPath}
                isActive={isActive && activeShellId === shell.id}
                themeVariant={themeVariant}
                terminalFontSize={terminalFontSize}
                monoFontFamily={monoFontFamily}
                onReady={onReady}
                onActiveTermChange={(term) => {
                  if (activeShellIdRef.current === shell.id) activeTermRef.current = term;
                }}
              />
            ))}
          </div>
          {/* kooky PaneStatusBar — 底部状态栏 */}
          <PaneStatusBar
            projectPath={projectPath}
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
              if (sid) invoke("send_input", { taskId: sid, data: text + "\n" }).catch(() => {});
              setComposerOpen(false);
            }}
            onClose={() => setComposerOpen(false)}
          />
        </div>
      </div>
    );
  },
);
