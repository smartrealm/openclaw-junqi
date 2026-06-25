import type React from "react";
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
import { Plus, Terminal as TerminalIcon, Trash2, X, SplitSquareHorizontal, SplitSquareVertical } from "lucide-react";
import { useI18n } from "./i18n-fallback";
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
  const home = '~';
  if (!cwd || cwd === '/' || cwd === '') return home;
  const trimmed = cwd.replace(/\/+$/, '');
  if (trimmed === '') return home;
  const seg = trimmed.split('/').pop() || home;
  return seg;
}

// ── kooky TabBarItem port: 40pt strip, cornerRadius 6, chromeActive bg,
//    opacity 0.6 inactive foreground, hover-to-show close button,
//    right-click context menu (Close / Close Others / Close All / Rename). ─

interface TabShellItemProps {
  title: string;
  selected: boolean;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
  onCloseOthers?: () => void;
  onCloseAll?: () => void;
  onRename?: (name: string) => void;
}

function TabShellItem({
  title,
  selected,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseAll,
  onRename,
}: TabShellItemProps) {
  const [hovered, setHovered] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  // Click-outside dismiss
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = () => setCtxMenu(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ctxMenu]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const menuItemStyle: React.CSSProperties = {
    padding: '4px 12px',
    fontSize: 11,
    cursor: 'pointer',
    color: 'rgb(var(--aegis-text))',
    fontFamily: '"JetBrains Mono", monospace',
    whiteSpace: 'nowrap',
    background: 'transparent',
    border: 'none',
    textAlign: 'left' as const,
    width: '100%',
  };

  return (
    <>
      <div
        onClick={onSelect}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "7px 12px", height: 40, minWidth: 0,
          borderRadius: 6, flexShrink: 0, cursor: "pointer",
          background: selected
            ? "rgb(var(--aegis-overlay)/0.10)"
            : hovered
              ? "rgb(var(--aegis-overlay)/0.06)"
              : "transparent",
          color: selected
            ? "rgb(var(--aegis-text))"
            : "rgb(var(--aegis-text)/0.6)",
          transition: "background 0.12s",
        }}
      >
        <TerminalIcon
          size={12}
          color={selected ? "rgb(var(--aegis-primary))" : "rgb(var(--aegis-text-dim))"}
        />
        <span style={{
          fontSize: 12, fontWeight: 400, whiteSpace: "nowrap",
          overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160,
        }}>
          {title}
        </span>
        <button
          onClick={onClose}
          title="Close"
          style={{
            background: "none", border: "none",
            color: "rgb(var(--aegis-text-dim))",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 1, borderRadius: 3, cursor: "pointer",
            opacity: (hovered || selected) ? 1 : 0,
            pointerEvents: (hovered || selected) ? "auto" : "none",
            transition: "opacity 0.1s",
          }}
        >
          <X size={12} />
        </button>
      </div>

      {/* Context menu (kooky right-click on tab) */}
      {ctxMenu && (
        <div
          style={{
            position: 'fixed',
            left: ctxMenu.x,
            top: ctxMenu.y,
            zIndex: 200,
            background: 'rgb(var(--aegis-elevated))',
            border: '1px solid rgb(255 255 255 / 0.08)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgb(0 0 0 / 0.4)',
            padding: '4px 0',
            minWidth: 140,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <button
            style={menuItemStyle}
            onClick={() => { onClose(null as any); setCtxMenu(null); }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.06)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            Close
          </button>
          {onCloseOthers && (
            <button
              style={menuItemStyle}
              onClick={() => { onCloseOthers(); setCtxMenu(null); }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.06)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              Close Others
            </button>
          )}
          {onCloseAll && (
            <button
              style={menuItemStyle}
              onClick={() => { onCloseAll(); setCtxMenu(null); }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.06)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              Close All
            </button>
          )}
          {onRename && (
            <button
              style={menuItemStyle}
              onClick={() => {
                const name = prompt('Rename tab:', title);
                if (name && name.trim()) onRename(name.trim());
                setCtxMenu(null);
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.06)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              Rename…
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
}

const MAX_SHELLS = 5;

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
}>(
  function ShellTerminalInstance(
    { shellId, projectPath, isActive, themeVariant, terminalFontSize, monoFontFamily, onReady },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<XTerm | null>(null);
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
        const linuxIME = attachLinuxIMEFix(term, (data) => {
          invoke("send_input", { taskId: shellId, data }).catch(() => {});
        });
        disposeOnData = { dispose: () => linuxIME.dispose() };

        resizeObserver = new ResizeObserver(() => {
          setTimeout(() => {
            if (isActiveRef.current) {
              fit();
            }
          }, 50);
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
    }, [isActive, shellId]);

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

    return (
      <div
        ref={containerRef}
        className="nezha-xterm-host nezha-shell-xterm-host"
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
    },
    ref,
  ) {
    const { t } = useI18n();
    const initialShellRef = useRef<ShellSession | null>(null);
    if (!initialShellRef.current) {
      initialShellRef.current = createShellSession(projectId, 1);
    }

    const nextShellIndexRef = useRef(2);
    const shellRefs = useRef<Record<string, ShellTerminalInstanceHandle | null>>({});
    const [shells, setShells] = useState<ShellSession[]>(() => [initialShellRef.current!]);
    const [activeShellId, setActiveShellId] = useState<string | null>(() => initialShellRef.current!.id);
    const activeShellIdRef = useRef(activeShellId);
    activeShellIdRef.current = activeShellId;

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
          <div style={{ display: "flex", alignItems: "center", height: 40, flexShrink: 0, padding: "0 8px", gap: 2, background: "var(--terminal-bg)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 2, flex: 1, overflowX: "auto", scrollbarWidth: "none" }}>
              {shells.map((shell) => {
                const selected = activeShellId === shell.id;
                const tabTitle = computeShellTitle(shell);
                return (
                  <TabShellItem
                    key={shell.id}
                    title={tabTitle}
                    selected={selected}
                    onSelect={() => setActiveShellId(shell.id)}
                    onClose={(e) => { e.stopPropagation(); handleCloseShell(shell.id); }}
                    onCloseOthers={() => {
                      const otherIds = shells.filter((s) => s.id !== shell.id).map((s) => s.id);
                      otherIds.forEach((id) => { delete shellRefs.current[id]; });
                      setShells([shell]);
                      setActiveShellId(shell.id);
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
                style={{ width: 28, height: 28, borderRadius: 5, border: "none", background: "transparent", color: "rgb(var(--aegis-text-secondary))", cursor: shells.length >= MAX_SHELLS ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                <Plus size={14} />
              </button>
              <button
                onClick={onSplitHorizontal ?? (() => {})}
                title="Split Right (⌘D)"
                style={{ width: 28, height: 28, borderRadius: 5, border: "none", background: "transparent", color: "rgb(var(--aegis-text-muted))", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                <SplitSquareHorizontal size={14} />
              </button>
              <button
                onClick={onSplitVertical ?? (() => {})}
                title="Split Down (⌘⇧D)"
                style={{ width: 28, height: 28, borderRadius: 5, border: "none", background: "transparent", color: "rgb(var(--aegis-text-muted))", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                <SplitSquareVertical size={14} />
              </button>
            </div>
          </div>
          {/* 1pt hairline between tab strip and terminal — kooky chromeHairline
              (foreground.opacity(0.07) in dark) */}
          <div style={{ height: 1, background: "rgb(255 255 255 / 0.07)", flexShrink: 0 }}></div>
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
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
              />
            ))}
          </div>
        </div>
      </div>
    );
  },
);
