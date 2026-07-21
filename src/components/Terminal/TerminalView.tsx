import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { attachSmartCopy } from "./terminalCopyHelper";
import {
  DEFAULT_SHIFT_ENTER_NEWLINE,
  matchesTerminalNewline,
  normalizeShiftEnterNewline,
  TERMINAL_NEWLINE_SEQUENCE,
} from "@/junqi/shortcuts";
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
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onRegisterTerminal: (
    writeFn: ((data: string, callback?: () => void) => void) | null,
  ) => number;
  onReady?: (generation: number) => void;
  themeVariant: ThemeVariant;
  terminalFontSize: TerminalFontSize;
  terminalScrollback?: number;
  monoFontFamily: FontFamily;
  isActive?: boolean;
  initialData?: string;
  initialSnapshot?: string;
  onSnapshot?: (snapshot: string) => void;
}

export function TerminalView({
  onInput,
  onResize,
  onRegisterTerminal,
  onReady,
  themeVariant,
  terminalFontSize,
  terminalScrollback = 1000,
  monoFontFamily,
  isActive = true,
  initialData,
  initialSnapshot,
  onSnapshot,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const onRegisterRef = useRef(onRegisterTerminal);
  const onReadyRef = useRef(onReady);
  const onSnapshotRef = useRef(onSnapshot);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const shiftEnterNewlineRef = useRef<boolean>(DEFAULT_SHIFT_ENTER_NEWLINE);
  const initialConfigRef = useRef({
    themeVariant,
    terminalFontSize,
    terminalScrollback,
    monoFontFamily,
    initialData,
    initialSnapshot,
  });
  onReadyRef.current = onReady;
  onSnapshotRef.current = onSnapshot;

  // Keep refs current on every render
  onInputRef.current = onInput;
  onResizeRef.current = onResize;
  onRegisterRef.current = onRegisterTerminal;

  // 仅在 cols/rows 真正变化时回调；否则会触发 resize_pty → SIGWINCH →
  // 下游 TUI（Claude Code / Codex）全屏重绘，导致每次切回都看到一次多余重画。
  const notifyResize = useCallback((cols: number, rows: number) => {
    const last = lastSizeRef.current;
    if (last && last.cols === cols && last.rows === rows) return;
    lastSizeRef.current = { cols, rows };
    onResizeRef.current(cols, rows);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const initialConfig = initialConfigRef.current;

    const { term, fitAddon, whenFontsReady } = initTerminal(
      initialConfig.themeVariant,
      initialConfig.terminalScrollback,
      initialConfig.terminalFontSize,
      initialConfig.monoFontFamily,
    );
    applyTerminalThemeOnPanel(term, initialConfig.themeVariant, container);
    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    let disposed = false;

    const serializeAddon = new SerializeAddon();
    term.loadAddon(serializeAddon);

    // Holders wired in openAndWire so the cleanup function can dispose them
    // even when term.open() was deferred by safeOpenTerminal.
    let disposeCharSizeOverride: (() => void) | null = null;
    let disposeScrollbarAutoHide: (() => void) | null = null;
    let disposeInputFix: (() => void) | null = null;
    let webglHandle: { dispose(): void } | null = null;
    let disposeMacWebKitGuard: (() => void) | null = null;
    let disposeSmartCopy: (() => void) | null = null;
    let disposeOnData: { dispose(): void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let pointerHandler: ((e: PointerEvent) => void) | null = null;
    let visibilityHandler: (() => void) | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let opened = false;

    const openAndWire = () => {
      if (opened || disposed) return;
      opened = true;

      // 必须在 term.open() 之后挂：_charSizeService 在 open 时才实例化。
      disposeCharSizeOverride = applyDomCharSizeOverride(term);
      disposeScrollbarAutoHide = attachTerminalScrollbarAutoHide(term, container);
      disposeInputFix = attachMacWebKitShiftInputFix(term);
      webglHandle = loadWebglAddon(term);

      const size = safeFit(fitAddon, term, container);
      if (size) notifyResize(size.cols, size.rows);

      whenFontsReady.then(() => {
        if (disposed) return;
        const s = safeFit(fitAddon, term, container);
        if (s) notifyResize(s.cols, s.rows);
      });

      const focusTerminal = () => {
        window.requestAnimationFrame(() => {
          term.focus();
        });
      };

      const writer = createSmartWriter(term);
      disposeMacWebKitGuard = attachMacWebKitTerminalGuard({ term, container, writer });

      const terminalGeneration = onRegisterRef.current(writer.write);

      const completeRestore = () => {
        onReadyRef.current?.(terminalGeneration);
        focusTerminal();
      };

      window.requestAnimationFrame(() => {
        const s = safeFit(fitAddon, term, container);
        if (s) notifyResize(s.cols, s.rows);
        if (initialConfig.initialSnapshot) {
          term.write(initialConfig.initialSnapshot, () => {
            if (initialConfig.initialData) {
              term.write(initialConfig.initialData, completeRestore);
              return;
            }
            completeRestore();
          });
          return;
        }
        if (initialConfig.initialData) {
          term.write(initialConfig.initialData, completeRestore);
          return;
        }
        completeRestore();
      });

      disposeSmartCopy = attachSmartCopy(term, {
        matchesNewline: (e) => matchesTerminalNewline(e, shiftEnterNewlineRef.current),
        onNewline: () => onInputRef.current(TERMINAL_NEWLINE_SEQUENCE),
      });
      const linuxIME = attachLinuxIMEFix(term, (data) => onInputRef.current(data));
      disposeOnData = { dispose: () => linuxIME.dispose() };

      pointerHandler = (e: PointerEvent) => {
        if (e.button === 0) {
          focusTerminal();
        }
      };
      visibilityHandler = () => {
        if (document.visibilityState !== "visible") return;
        window.requestAnimationFrame(() => {
          const s = safeFit(fitAddon, term, container);
          if (s) notifyResize(s.cols, s.rows);
          refreshTerminalDisplay(term);
          term.focus();
        });
      };

      container.addEventListener("pointerdown", pointerHandler as EventListener);
      document.addEventListener("visibilitychange", visibilityHandler);

      resizeObserver = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const s = safeFit(fitAddon, term, container);
          if (s) notifyResize(s.cols, s.rows);
        }, 50);
      });
      resizeObserver.observe(container);
    };

    const disposeSafeOpen = safeOpenTerminal(term, container, openAndWire);

    return () => {
      disposed = true;
      disposeSafeOpen();
      try {
        const snapshot = serializeAddon.serialize();
        if (snapshot) onSnapshotRef.current?.(snapshot);
      } catch {
        /* ignore */
      }
      onRegisterRef.current(null);
      fitAddonRef.current = null;
      disposeCharSizeOverride?.();
      try { webglHandle?.dispose(); } catch { /* */ }
      disposeScrollbarAutoHide?.();
      disposeMacWebKitGuard?.();
      disposeInputFix?.();
      disposeSmartCopy?.();
      disposeOnData?.dispose();
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      if (pointerHandler) {
        container.removeEventListener("pointerdown", pointerHandler as EventListener);
      }
      if (visibilityHandler) {
        document.removeEventListener("visibilitychange", visibilityHandler);
      }
      terminalRef.current = null;
      term.dispose();
    };
  }, [notifyResize]);

  // Keep the configured "insert newline" combo in sync with app settings.
  // Mirrors NewTaskView: load once, then react to the global settings event.
  useEffect(() => {
    function loadNewlineShortcut() {
      invoke<{ terminal_shift_enter_newline?: unknown }>("load_app_settings")
        .then((settings) => {
          shiftEnterNewlineRef.current = normalizeShiftEnterNewline(
            settings.terminal_shift_enter_newline,
          );
        })
        .catch(() => {
          shiftEnterNewlineRef.current = DEFAULT_SHIFT_ENTER_NEWLINE;
        });
    }
    loadNewlineShortcut();
    window.addEventListener("junqi:app-settings-changed", loadNewlineShortcut);
    return () => window.removeEventListener("junqi:app-settings-changed", loadNewlineShortcut);
  }, []);

  useEffect(() => {
    if (!isActive) return;
    window.requestAnimationFrame(() => {
      if (!fitAddonRef.current || !terminalRef.current || !containerRef.current) return;
      const s = safeFit(fitAddonRef.current, terminalRef.current, containerRef.current);
      if (s) notifyResize(s.cols, s.rows);
      refreshTerminalDisplay(terminalRef.current);
      terminalRef.current.focus();
    });
  }, [isActive, notifyResize]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.cursorBlink = isActive;
    }
  }, [isActive]);

  useEffect(() => {
    if (!terminalRef.current || !containerRef.current) return;
    applyTerminalThemeOnPanel(terminalRef.current, themeVariant, containerRef.current);
    // 主题/对比度变化后 xterm 算出的最终前景色变了，但 WebGL atlas 仍缓存
    // 旧色的 glyph 纹理，不刷新会看到颜色和字形错位。
    refreshTerminalDisplay(terminalRef.current);
  }, [themeVariant]);

  useEffect(() => {
    if (!terminalRef.current || !fitAddonRef.current || !containerRef.current) return;
    const size = applyTerminalFontSize(
      terminalRef.current,
      fitAddonRef.current,
      terminalFontSize,
      containerRef.current,
    );
    if (size) notifyResize(size.cols, size.rows);
  }, [terminalFontSize, notifyResize]);

  useEffect(() => {
    if (!terminalRef.current || !fitAddonRef.current || !containerRef.current) return;
    const result = applyTerminalFontFamily(
      terminalRef.current,
      fitAddonRef.current,
      monoFontFamily,
      containerRef.current,
    );
    if (!result) return;
    if (result.immediate) notifyResize(result.immediate.cols, result.immediate.rows);
    let cancelled = false;
    result.whenSettled.then((s) => {
      if (cancelled || !s) return;
      notifyResize(s.cols, s.rows);
    });
    return () => {
      cancelled = true;
    };
  }, [monoFontFamily, notifyResize]);

  return (
    <div
      ref={containerRef}
      className="junqi-xterm-host"
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        cursor: "text",
      }}
    />
  );
}
