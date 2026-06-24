import type React from "react";
import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { attachSmartCopy } from "./terminalCopyHelper";
import type { TerminalFontSize, FontFamily, ThemeVariant } from "../types";
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
import { Plus, Terminal as TerminalIcon, Trash2, X } from "lucide-react";
import { useI18n } from "../i18n";
import "@xterm/xterm/css/xterm.css";

interface ShellOutputEvent {
  shell_id: string;
  data: string;
}

export interface ShellTerminalPanelHandle {
  sendCommand: (cmd: string) => void;
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
        <div
          style={{
            height: 32,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            padding: "0 10px 0 14px",
            borderBottom: "1px solid var(--aegis-border)",
            background: "var(--aegis-surface)",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: "rgb(var(--aegis-text))", flex: 1 }}>
            {t("terminal.title")}
          </span>
          <span style={{ fontSize: 11, color: "rgb(var(--aegis-text-muted))" }}>
            {shells.length}/{MAX_SHELLS}
          </span>
          <button
            onClick={onClose}
            title={t("terminal.closeTerminals")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 3,
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              color: "rgb(var(--aegis-text-dim))",
            }}
          >
            <X size={14} />
          </button>
        </div>
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
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
          <div
            style={{
              width: 104,
              flexShrink: 0,
              borderLeft: "1px solid var(--aegis-border)",
              background: "var(--aegis-surface)",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <div
              style={{
                height: 28,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                padding: "0 4px",
                borderBottom: "1px solid var(--aegis-border)",
              }}
            >
              <button
                onClick={handleAddShell}
                disabled={shells.length >= MAX_SHELLS}
                title={shells.length >= MAX_SHELLS ? t("terminal.limitReached") : t("terminal.newTerminal")}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  border: "none",
                  background: "transparent",
                  color:
                    shells.length >= MAX_SHELLS ? "rgb(var(--aegis-text-dim))" : "rgb(var(--aegis-text-secondary))",
                  cursor: shells.length >= MAX_SHELLS ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Plus size={13} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
              {shells.map((shell) => {
                const selected = activeShellId === shell.id;
                return (
                  <div
                    key={shell.id}
                    onClick={() => setActiveShellId(shell.id)}
                    style={{
                      height: 28,
                      padding: "0 4px 0 8px",
                      borderLeft: selected
                        ? "2px solid rgb(var(--aegis-primary))"
                        : "2px solid transparent",
                      background: selected ? "var(--aegis-hover)" : "transparent",
                      color: "rgb(var(--aegis-text))",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <TerminalIcon
                      size={13}
                      color={selected ? "rgb(var(--aegis-primary))" : "rgb(var(--aegis-text-dim))"}
                    />
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 11.5,
                        fontWeight: selected ? 600 : 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        color: selected ? "rgb(var(--aegis-text))" : "rgb(var(--aegis-text-secondary))",
                      }}
                    >
                      zsh
                    </div>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        handleCloseShell(shell.id);
                      }}
                      title={t("terminal.closeShell", { title: shell.title })}
                      style={{
                        background: "none",
                        border: "none",
                        color: "rgb(var(--aegis-text-dim))",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 1,
                        borderRadius: 4,
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  },
);
