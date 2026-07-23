import { invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { LoaderCircle, RefreshCw, TerminalSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  applyTerminalThemeOnPanel,
  minimumContrastRatioFor,
} from "@/components/Terminal/terminalShared";
import {
  getDefaultMonoFont,
  type ThemeVariant,
} from "@/components/Terminal/terminalTypes";
import {
  hasTauriEventBridge,
  subscribeTauriEventReady,
} from "@/utils/tauriEvents";
import "@xterm/xterm/css/xterm.css";

interface OfficialOnboardingStart {
  sessionId: string;
}

interface OfficialOnboardingOutput {
  sessionId: string;
  data: string;
}

interface OfficialOnboardingExit {
  sessionId: string;
  exitCode: number | null;
  reason: "exited" | "wait_error";
}

function terminalThemeVariant(theme: string): ThemeVariant {
  if (theme === "aegis-light") return "light";
  if (theme === "aegis-eyecare") return "eyecare";
  if (theme === "aegis-midnight") return "midnight";
  return "dark";
}

export function OfficialOnboardingTerminal({
  onExit,
  onCancelled,
  onStarted,
}: {
  onExit: (exitCode: number | null) => void;
  onCancelled: () => void;
  onStarted: () => void;
}) {
  const { t } = useTranslation();
  const theme = useSettingsStore((state) => state.theme);
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize);
  const monoFont = useSettingsStore((state) => state.monoFont);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const onExitRef = useRef(onExit);
  const onCancelledRef = useRef(onCancelled);
  const onStartedRef = useRef(onStarted);
  const cancelRef = useRef<() => void>(() => undefined);
  const themeRef = useRef(theme);
  const fontSizeRef = useRef(terminalFontSize);
  const monoFontRef = useRef(monoFont);
  const translateRef = useRef(t);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"starting" | "running" | "stopping" | "failed" | "exited">("starting");
  const [error, setError] = useState<string | null>(null);
  onExitRef.current = onExit;
  onCancelledRef.current = onCancelled;
  onStartedRef.current = onStarted;
  themeRef.current = theme;
  fontSizeRef.current = terminalFontSize;
  monoFontRef.current = monoFont;
  translateRef.current = t;

  useEffect(() => {
    const terminal = terminalRef.current;
    const container = containerRef.current;
    if (!terminal || !container) return;
    const variant = terminalThemeVariant(theme);
    applyTerminalThemeOnPanel(terminal, variant, container);
    terminal.options.minimumContrastRatio = minimumContrastRatioFor(variant);
  }, [theme]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = terminalFontSize;
    terminal.options.fontFamily = monoFont || getDefaultMonoFont();
  }, [monoFont, terminalFontSize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let sessionId: string | null = null;
    let unlistenOutput: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let onDataDispose: { dispose(): void } | null = null;
    let cancellationRequested = false;
    const pendingOutput: OfficialOnboardingOutput[] = [];
    let pendingExit: OfficialOnboardingExit | null = null;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: fontSizeRef.current,
      fontFamily: monoFontRef.current || getDefaultMonoFont(),
      scrollback: 10_000,
      allowTransparency: true,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;
    applyTerminalThemeOnPanel(terminal, terminalThemeVariant(themeRef.current), container);
    terminal.options.minimumContrastRatio = minimumContrastRatioFor(terminalThemeVariant(themeRef.current));

    const fit = () => {
      if (disposed) return;
      try {
        fitAddon.fit();
        if (sessionId) {
          void invoke("resize_official_onboarding", {
            sessionId,
            cols: terminal.cols,
            rows: terminal.rows,
          }).catch(() => undefined);
        }
      } catch {
        // The container can be temporarily zero-sized during page transition.
      }
    };

    const handleExit = (event: OfficialOnboardingExit) => {
      if (disposed) return;
      if (event.exitCode === 0) {
        setState("exited");
      } else {
        setState("failed");
        setError(event.exitCode === null
          ? translateRef.current("setup.wizard.failed", "OpenClaw 配置向导执行失败。")
          : translateRef.current("setup.wizard.cliExited", {
            code: event.exitCode,
            defaultValue: "OpenClaw 官方配置向导以退出码 {{code}} 结束。",
          }));
      }
      onExitRef.current(event.exitCode);
    };

    const cancel = async () => {
      if (disposed || cancellationRequested) return;
      if (!sessionId) {
        onCancelledRef.current();
        return;
      }
      cancellationRequested = true;
      setState("stopping");
      try {
        await invoke("stop_official_onboarding", { sessionId });
        if (!disposed) onCancelledRef.current();
      } catch (cause) {
        if (disposed) return;
        cancellationRequested = false;
        setState("failed");
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    cancelRef.current = () => { void cancel(); };

    const launch = async () => {
      if (!hasTauriEventBridge()) {
        setState("failed");
        setError(translateRef.current("setup.wizard.desktopOnly", "官方配置向导仅可在桌面应用中运行。"));
        return;
      }
      try {
        const [output, exit] = await Promise.all([
          subscribeTauriEventReady<OfficialOnboardingOutput>("official-onboarding-output", (event) => {
            if (!sessionId) {
              pendingOutput.push(event.payload);
              return;
            }
            if (event.payload.sessionId === sessionId) terminal.write(event.payload.data);
          }),
          subscribeTauriEventReady<OfficialOnboardingExit>("official-onboarding-exit", (event) => {
            if (disposed) return;
            if (!sessionId) {
              pendingExit = event.payload;
              return;
            }
            if (event.payload.sessionId === sessionId) handleExit(event.payload);
          }),
        ]);
        unlistenOutput = output;
        unlistenExit = exit;
        if (disposed) return;
        const started = await invoke<OfficialOnboardingStart>("start_official_onboarding", {
          cols: terminal.cols,
          rows: terminal.rows,
        });
        if (disposed) {
          void invoke("stop_official_onboarding", { sessionId: started.sessionId }).catch(() => undefined);
          return;
        }
        sessionId = started.sessionId;
        onStartedRef.current();
        setState("running");
        for (const event of pendingOutput.splice(0)) {
          if (event.sessionId === sessionId) terminal.write(event.data);
        }
        if (pendingExit?.sessionId === sessionId) {
          handleExit(pendingExit);
          pendingExit = null;
        }
        fit();
        terminal.focus();
      } catch (cause) {
        if (disposed) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setState("failed");
        setError(message);
      }
    };

    onDataDispose = terminal.onData((data) => {
      if (!sessionId || cancellationRequested) return;
      void invoke("write_official_onboarding", { sessionId, data }).catch((cause) => {
        if (disposed) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setState("failed");
        setError(message);
      });
    });
    resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(container);
    window.requestAnimationFrame(fit);
    void launch();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      onDataDispose?.dispose();
      unlistenOutput?.();
      unlistenExit?.();
      cancelRef.current = () => undefined;
      if (sessionId) {
        void invoke("stop_official_onboarding", { sessionId }).catch(() => undefined);
      }
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [attempt]);

  const retry = () => {
    setError(null);
    setState("starting");
    setAttempt((current) => current + 1);
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-aegis-border bg-[rgb(var(--aegis-elevated))]">
        <div className="flex h-10 items-center justify-between border-b border-aegis-border px-3">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-aegis-text-secondary">
            <TerminalSquare size={15} className="shrink-0 text-aegis-primary" />
            <span className="truncate">openclaw onboard</span>
          </div>
          {(state === "starting" || state === "stopping") && (
            <LoaderCircle size={14} className="animate-spin text-aegis-primary" />
          )}
          {state === "running" && (
            <button
              type="button"
              onClick={() => cancelRef.current()}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-aegis-text-muted hover:bg-aegis-hover hover:text-aegis-text"
              title={t("common.cancel", "取消")}
              aria-label={t("common.cancel", "取消")}
            >
              <X size={15} />
            </button>
          )}
        </div>
        <div ref={containerRef} className="h-[min(54vh,500px)] min-h-[340px] p-1" aria-label={t("setup.wizard.terminal", "OpenClaw 官方配置终端")} />
      </div>
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
          <span className="min-w-0 break-words">{error}</span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => cancelRef.current()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-400/30 text-red-200 hover:bg-red-500/10"
              title={t("common.back", "返回")}
              aria-label={t("common.back", "返回")}
            >
              <X size={14} />
            </button>
            <button
              type="button"
              onClick={retry}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-400/30 text-red-200 hover:bg-red-500/10"
              title={t("setup.retry", "重试")}
              aria-label={t("setup.retry", "重试")}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
