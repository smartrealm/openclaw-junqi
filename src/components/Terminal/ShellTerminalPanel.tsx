import type React from "react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { attachSmartCopy } from "./terminalCopyHelper";
import type { TerminalFontSize, FontFamily, ThemeVariant } from "../../_nezha_root/types";
import {
  applyTerminalThemeOnPanel,
  initTerminal,
  loadWebglAddon,
  safeFit,
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
import { useTranslation } from "react-i18next";
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

const ShellTerminalInstance = forwardRef<
  ShellTerminalInstanceHandle,
  {
    shellId: string;
    projectPath: string;
    isActive: boolean;
    themeVariant: ThemeVariant;
    terminalFontSize: TerminalFontSize;
    monoFontFamily: FontFamily;
    onReady?: () => void;
  }
>(function ShellTerminalInstance(
  {
    shellId,
    projectPath,
    isActive,
    themeVariant,
    terminalFontSize,
    monoFontFamily,
    onReady,
  },
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
        invoke("send_input", { shellId, data: cmd }).catch(console.error);
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

    const { term, fitAddon, whenFontsReady } = initTerminal(
      themeVariantRef.current,
      5000,
      terminalFontSizeRef.current,
      monoFontFamilyRef.current,
    );
    applyTerminalThemeOnPanel(term, themeVariantRef.current, container);
    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    term.open(container);
    // Must be after term.open(): _charSizeService is only instantiated during open().
    const disposeCharSizeOverride = applyDomCharSizeOverride(term);
    const disposeScrollbarAutoHide = attachTerminalScrollbarAutoHide(
      term,
      container,
    );
    const disposeInputFix = attachMacWebKitShiftInputFix(term);
    const webglHandle = loadWebglAddon(term);
    const writer = createSmartWriter(term);
    const disposeMacWebKitGuard = attachMacWebKitTerminalGuard({
      term,
      container,
      writer,
    });

    const fit = () => {
      if (cleaned) return;
      const s = safeFit(fitAddon, term, container);
      if (!s) return;
      const last = lastSizeRef.current;
      if (last && last.cols === s.cols && last.rows === s.rows) return;
      lastSizeRef.current = { cols: s.cols, rows: s.rows };
      invoke("resize_pty", {
        shellId,
        cols: s.cols,
        rows: s.rows,
      }).catch(() => {});
    };

    // After font is ready, real cell width may change — fit again so cols/rows
    // catch up.
    whenFontsReady.then(() => {
      if (cleaned) return;
      fit();
    });

    initTimeoutId = window.setTimeout(() => {
      if (cleaned) return;
      fit();
      invoke("open_shell", {
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

    const disposeSmartCopy = attachSmartCopy(term);
    const linuxIME = attachLinuxIMEFix(term, (data) => {
      invoke("send_input", { shellId, data }).catch(() => {});
    });
    const disposeOnData = { dispose: () => linuxIME.dispose() };

    const resizeObserver = new ResizeObserver(() => {
      setTimeout(() => {
        if (isActiveRef.current) {
          fit();
        }
      }, 50);
    });
    resizeObserver.observe(container);

    const handleVisibilityChange = () => {
      if (
        document.visibilityState !== "visible" ||
        !terminalRef.current ||
        !isActiveRef.current
      )
        return;
      window.requestAnimationFrame(() => {
        fit();
        const t = terminalRef.current;
        if (t) {
          refreshTerminalDisplay(t);
          t.focus();
        }
      });
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    let unlisten: (() => void) | null = null;
    listen<ShellOutputEvent>("shell-output", (event) => {
      if (event.payload.shell_id === shellId && terminalRef.current) {
        writer.write(event.payload.data);
      }
    }).then((fn) => {
      if (cleaned) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cleaned = true;
      if (initTimeoutId !== null) {
        window.clearTimeout(initTimeoutId);
      }
      if (readyTimeoutId !== null) {
        window.clearTimeout(readyTimeoutId);
      }
      unlisten?.();
      disposeSmartCopy();
      disposeOnData.dispose();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      terminalRef.current = null;
      fitAddonRef.current = null;
      disposeCharSizeOverride();
      webglHandle.dispose();
      disposeScrollbarAutoHide();
      disposeMacWebKitGuard();
      disposeInputFix();
      term.dispose();
      invoke("kill_shell", { shellId }).catch(() => {});
    };
  }, [shellId, projectPath]);

  useEffect(() => {
    if (!isActive) return;
    window.requestAnimationFrame(() => {
      if (
        !fitAddonRef.current ||
        !terminalRef.current ||
        !containerRef.current
      )
        return;
      const s = safeFit(
        fitAddonRef.current,
        terminalRef.current,
        containerRef.current,
      );
      if (s) {
        const last = lastSizeRef.current;
        if (!last || last.cols !== s.cols || last.rows !== s.rows) {
          lastSizeRef.current = { cols: s.cols, rows: s.rows };
          invoke("resize_pty", {
            shellId,
            cols: s.cols,
            rows: s.rows,
          }).catch(() => {});
        }
      }
      refreshTerminalDisplay(terminalRef.current);
      terminalRef.current.focus();
    });
  }, [isActive, shellId]);

  useEffect(() => {
    if (terminalRef.current && containerRef.current) {
      applyTerminalThemeOnPanel(
        terminalRef.current,
        themeVariant,
        containerRef.current,
      );
      // Theme/contrast change recalculates xterm's final foreground color, but
      // the WebGL atlas still caches old-color glyph textures — without refresh
      // the user sees color and glyph misalignment.
      refreshTerminalDisplay(terminalRef.current);
    }
  }, [themeVariant]);

  useEffect(() => {
    if (
      !terminalRef.current ||
      !fitAddonRef.current ||
      !containerRef.current
    )
      return;
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
    invoke("resize_pty", {
      shellId,
      cols: size.cols,
      rows: size.rows,
    }).catch(() => {});
  }, [terminalFontSize, shellId]);

  useEffect(() => {
    if (
      !terminalRef.current ||
      !fitAddonRef.current ||
      !containerRef.current
    )
      return;
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
      invoke("resize_pty", {
        shellId,
        cols: size.cols,
        rows: size.rows,
      }).catch(() => {});
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
});

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
    const { t } = useTranslation();
    const initialShellRef = useRef<ShellSession | null>(null);
    if (!initialShellRef.current) {
      initialShellRef.current = createShellSession(projectId, 1);
    }

    const nextShellIndexRef = useRef(2);
    const shellRefs = useRef<Record<string, ShellTerminalInstanceHandle | null>>(
      {},
    );
    const [shells, setShells] = useState<ShellSession[]>(() => [
      initialShellRef.current!,
    ]);
    const [activeShellId, setActiveShellId] = useState<string | null>(
      () => initialShellRef.current!.id,
    );
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
      const nextShell = createShellSession(
        projectId,
        nextShellIndexRef.current++,
      );
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
          flexShrink: 0,
          height,
          borderTop: "1px solid var(--aegis-border)",
          display: "flex",
          flexDirection: "column",
          background: "var(--aegis-bg)",
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
            background: "var(--aegis-bg-secondary)",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--aegis-text)",
              flex: 1,
            }}
          >
            {t("terminal.title")}
          </span>
          <span
            style={{ fontSize: 11, color: "var(--aegis-text-dim)" }}
          >
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
              color: "var(--aegis-text-dim)",
            }}
          >
            <X size={14} />
          </button>
        </div>
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <div
            style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}
          >
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
              background: "var(--aegis-bg-secondary)",
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
                title={
                  shells.length >= MAX_SHELLS
                    ? t("terminal.limitReached")
                    : t("terminal.newTerminal")
                }
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  border: "none",
                  background: "transparent",
                  color:
                    shells.length >= MAX_SHELLS
                      ? "var(--aegis-text-dim)"
                      : "var(--aegis-text-secondary)",
                  cursor:
                    shells.length >= MAX_SHELLS ? "not-allowed" : "pointer",
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
                        ? "2px solid var(--aegis-primary)"
                        : "2px solid transparent",
                      background: selected
                        ? "var(--aegis-overlay-hover)"
                        : "transparent",
                      color: "var(--aegis-text)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <TerminalIcon
                      size={13}
                      color={
                        selected
                          ? "var(--aegis-primary)"
                          : "var(--aegis-text-dim)"
                      }
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
                        color: selected
                          ? "var(--aegis-text)"
                          : "var(--aegis-text-secondary)",
                      }}
                    >
                      zsh
                    </div>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        handleCloseShell(shell.id);
                      }}
                      title={t("terminal.closeShell", {
                        title: shell.title,
                      })}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--aegis-text-dim)",
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
