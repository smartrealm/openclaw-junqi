// ═══════════════════════════════════════════════════════════
// useSetupFlow — Detection & installation state machine
// Pure logic hook, no UI. Drives app-store state transitions.
// ═══════════════════════════════════════════════════════════

import { useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/app-store";
import {
  checkNode, checkGit, checkOpenclaw,
  installNode, installOpenclaw,
  prepareGateway,
  startGateway, checkDocker, pullOpenclawImage, startDockerGateway,
  type DockerStatus,
} from "@/api/tauri-commands";
import { debugWarn } from "@/utils/debugLog";
import { setupProgressI18nParams } from "./setupProgressParams";

export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface StepState {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface SetupFlow {
  progress: number;
  statusMessage: string;
  dockerStatus: DockerStatus | null;
  checkingDocker: boolean;
  needsGit: boolean;
  steps: StepState[];
  startGateway: () => Promise<void>;
  runNativeSetup: () => Promise<void>;
  runDockerSetup: () => Promise<void>;
  retrySetup: () => Promise<void>;
  selectMode: (mode: "native" | "docker") => void;
  detectDocker: () => Promise<void>;
  goBack: () => void;
  retryGit: () => void;
  enterWorkspace: () => void;
}

const INITIAL_NATIVE_STEPS: StepState[] = [
  { id: "git",       label: "Git",        status: "pending" },
  { id: "node",      label: "Node.js",    status: "pending" },
  { id: "openclaw",  label: "OpenClaw",   status: "pending" },
  { id: "gateway",   label: "Gateway",    status: "pending" },
];

const INITIAL_DOCKER_STEPS: StepState[] = [
  { id: "pull",      label: "Docker Image",  status: "pending" },
  { id: "container", label: "Container",     status: "pending" },
  { id: "gateway",   label: "Gateway",       status: "pending" },
];

function cacheGatewayTarget(port?: number | null, token?: string | null): void {
  if (!port && !token) return;
  try {
    const current = JSON.parse(localStorage.getItem("aegis-config") || "{}");
    const next = {
      ...current,
      ...(port ? { gatewayUrl: `ws://127.0.0.1:${port}` } : {}),
      ...(token ? { gatewayToken: token } : {}),
    };
    localStorage.setItem("aegis-config", JSON.stringify(next));
  } catch {
    // Best effort: connection resolution can still fall back to config files.
  }
}

function markSetupReady(): void {
  localStorage.setItem("junqi-setup-done", "1");
}

export function useSetupFlow(
  progress: number, setProgress: (v: number) => void,
  statusMessage: string, setStatusMessage: (v: string) => void,
  dockerStatus: DockerStatus | null, setDockerStatus: (v: DockerStatus | null) => void,
  checkingDocker: boolean, setCheckingDocker: (v: boolean) => void,
  needsGit: boolean, setNeedsGit: (v: boolean) => void,
  steps: StepState[], setSteps: (v: StepState[]) => void,
): SetupFlow {
  const {
    setupStep, installMode,
    setSetupStep, setSetupError, setSetupComplete,
    setGatewayRunning, setInstallMode, setSetupStatus,
  } = useAppStore();
  const { t } = useTranslation();
  const activeRunRef = useRef(0);
  const beginRun = useCallback(() => {
    activeRunRef.current += 1;
    return activeRunRef.current;
  }, []);
  const cancelActiveRun = useCallback(() => {
    activeRunRef.current += 1;
  }, []);
  const isRunActive = useCallback((runId: number) => activeRunRef.current === runId, []);
  const dockerDetectingRef = useRef(false);

  const report = useCallback((message: string, nextProgress?: number) => {
    setStatusMessage(message);
    if (typeof nextProgress === "number") setProgress(nextProgress);
    setSetupStatus(message, nextProgress);
  }, [setStatusMessage, setProgress, setSetupStatus]);

  const waitForGatewayReady = useCallback(async (runId: number, timeoutMs = 30_000, port?: number | null) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!isRunActive(runId)) throw new Error("setup cancelled");
      try {
        if (port) {
          const reachable: boolean = await invoke("probe_gateway_port", { port });
          if (reachable) return { running: true, port };
        } else {
          const status: any = await invoke("gateway_status");
          if (status?.running) {
            cacheGatewayTarget(status.port, status.token);
            return status;
          }
        }
      } catch {
        // Keep polling until timeout.
      }
      await new Promise((r) => setTimeout(r, 750));
    }
    throw new Error(t("setup.gatewayReadyTimeout", "Gateway did not become ready in time."));
  }, [isRunActive, t]);

  // ── Auto-detect on mount ──
  // Probe order: check_openclaw → probe_gateway_port (reads config port
  // from openclaw.json on the Rust side). If OpenClaw is installed, remember
  // that fact so later launches skip first-install preferences and setup mode.
  useEffect(() => {
    if (setupStep !== "detecting") return;
    (async () => {
      report(t("setup.detecting"), 0);
      try {
        const oclaw = await checkOpenclaw();
        if (!oclaw.installed) {
          // Never installed — go straight to mode selection
          localStorage.removeItem("junqi-setup-done");
          report(t("setup.chooseMode"), 18);
          setSetupStep("choosing-mode");
          return;
        }
        localStorage.setItem("junqi-setup-done", "1");

        // OpenClaw is installed — probe if its gateway is already
        // listening. Rust reads the actual configured port from
        // openclaw.json (not a hardcoded 18789).
        try {
          // No port argument → Rust reads config. If that fails it
          // falls back to 18789.
          const reachable: boolean = await invoke("probe_gateway_port", {});
          if (reachable) {
            setSetupComplete(true);
            return;
          }
        } catch {}

        // Installed but gateway not responding → ask the user to start it.
        report(t("setup.gatewayNotRunning"), 20);
        setSetupStep("gateway-stopped");
      } catch {
        report(t("setup.chooseMode"), 18);
        setSetupStep("choosing-mode");
      }
    })();
  }, [setupStep, report, t, setSetupComplete, setSetupStep]);

  // ── Docker detect after the welcome step ──
  useEffect(() => {
    if (setupStep === "welcome") return;
    if (dockerStatus || dockerDetectingRef.current) return;
    (async () => {
      dockerDetectingRef.current = true;
      setCheckingDocker(true);
      try { setDockerStatus(await checkDocker()); }
      catch { setDockerStatus({ available: false, version: null, daemon_running: false }); }
      finally {
        dockerDetectingRef.current = false;
        setCheckingDocker(false);
      }
    })();
  }, [setupStep, dockerStatus, setCheckingDocker, setDockerStatus]);

  // ── setup-progress event listener (granular per-step progress from Rust) ──
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ step: string; message: string; progress: number | null; error: string | null; key?: string } | string>(
      "setup-progress",
      (event) => {
        if (typeof event.payload === "string") {
          report(event.payload);
          return;
        }
        const { step, message, progress: p, error, key } = event.payload as any;
        // Prefer i18n-resolved text; fall back to the raw Rust message.
        const translated = key
          ? String(t(key as string, { defaultValue: message, ...setupProgressI18nParams(key, message) }))
          : "";
        const display = key && translated !== key && !translated.includes("{{") ? translated : message;
        const nextProgress = p != null ? Math.round(p * 100) : undefined;

        // ClawX-style setup keeps the primary onboarding copy coarse and calm.
        // Gateway preparation emits useful diagnostics, but those belong in the
        // activity log / current step detail rather than replacing the main
        // guide text with internal phrases like "detect/connect/sync runtime".
        const isGatewayDiagnostic =
          step === "gateway" && typeof key === "string" && key.startsWith("setup.gateway.");
        if (isGatewayDiagnostic) {
          if (typeof nextProgress === "number") {
            setProgress(nextProgress);
            setSetupStatus(t("setup.preparingGateway"), nextProgress);
          }
        } else {
          report(display, nextProgress);
        }
        // Map Rust step names to our step IDs
        const stepMap: Record<string, string> = {
          node: "node", git: "git", openclaw: "openclaw",
          gateway: "gateway", pull: "pull", container: "container",
        };
        const sid = stepMap[step];
        if (sid) {
          const newSteps = stepsRef.current.map((s) =>
            s.id === sid
              ? { ...s, status: (error ? "error" : "running") as StepStatus, detail: display }
              : s
          );
          setSteps(newSteps);
        }
      }
    ).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { unlisten?.(); };
  }, [t, report]);

  // ── Helpers ──
  function patchStep(id: string, status: StepStatus, detail?: string) {
    setSteps(stepsRef.current.map((s) =>
      s.id === id ? { ...s, status, detail } : s
    ));
  }

  // ── Actions ──
  const startGatewayAction = useCallback(async () => {
    const runId = beginRun();
    setSetupStep("checking");
    report(t("setup.startingGateway"), 30);
    if (stepsRef.current.some((s) => s.id === "gateway")) {
      patchStep("gateway", "running", t("setup.startingGateway"));
    } else {
      setSteps([{ id: "gateway", label: "Gateway", status: "running", detail: t("setup.startingGateway") }]);
    }
    try {
      const status: any = await startGateway();
      cacheGatewayTarget(status?.port, status?.token);
      await waitForGatewayReady(runId, 30_000, status?.port);
      if (!isRunActive(runId)) return;
      setGatewayRunning(true);
      if (stepsRef.current.some((s) => s.id === "gateway")) {
        patchStep("gateway", "done");
      } else {
        setSteps([{ id: "gateway", label: "Gateway", status: "done" }]);
      }
      report(t("setup.ready"), 100);
      await new Promise((r) => setTimeout(r, 600));
      if (!isRunActive(runId)) return;
      markSetupReady();
      setSetupStep("ready");
    } catch (e: any) {
      if (!isRunActive(runId)) return;
      if (stepsRef.current.some((s) => s.id === "gateway")) {
        patchStep("gateway", "error", String(e?.message ?? e));
      } else {
        setSteps([{ id: "gateway", label: "Gateway", status: "error", detail: String(e?.message ?? e) }]);
      }
      setSetupError(e?.message || String(e));
      report(e?.message || String(e));
      setSetupStep("error");
    }
  }, [beginRun, isRunActive, setSetupStep, report, t, setSteps, waitForGatewayReady, setGatewayRunning, setSetupError]);

  const runNativeSetup = useCallback(async () => {
    const runId = beginRun();
    const s = [...INITIAL_NATIVE_STEPS];
    setSteps(s);
    try {
      setSetupStep("checking");

      // Git
      patchStep("git", "running", t("setup.checkingGit"));
      report(t("setup.checkingGit"), 5);
      const gitStatus = await checkGit();
      if (!isRunActive(runId)) return;
      if (!gitStatus.available) {
        patchStep("git", "error", t("setup.gitRequiredDesc"));
        setNeedsGit(true);
        setSetupStep("git-missing");
        report(t("setup.gitRequiredDesc"), 10);
        return;
      } else {
        patchStep("git", "done", gitStatus.version ?? undefined);
      }

      // Node
      patchStep("node", "running", t("setup.checkingNode"));
      report(t("setup.checkingNode"), 15);
      const nodeStatus = await checkNode();
      if (!isRunActive(runId)) return;
      if (!nodeStatus.available) {
        patchStep("node", "running", t("setup.installingNode"));
        setSetupStep("install-node");
        report(t("setup.installingNode"), 25);
        await installNode();
        if (!isRunActive(runId)) return;
        patchStep("node", "done");
      } else {
        patchStep("node", "done", nodeStatus.version ?? undefined);
      }

      // OpenClaw
      patchStep("openclaw", "running", t("setup.checkingOpenclaw"));
      report(t("setup.checkingOpenclaw"), 40);
      const oclawStatus = await checkOpenclaw();
      if (!isRunActive(runId)) return;
      if (!oclawStatus.installed) {
        patchStep("openclaw", "running", t("setup.installingOpenclaw"));
        setSetupStep("install-openclaw");
        report(t("setup.installingOpenclaw"), 50);
        await installOpenclaw();
        if (!isRunActive(runId)) return;
        patchStep("openclaw", "done");
      } else {
        patchStep("openclaw", "done", oclawStatus.version ?? undefined);
      }

      // Gateway — 准备阶段。前端 `setup-progress` 监听会把 Rust 端
      // 通过 `prepare_gateway` 流式上报的每一条 step="gateway" 文案
      // 原样展示到 statusMessage 上，与 install_* 的呈现形态完全一致。
      patchStep("gateway", "running", t("setup.preparingGateway"));
      setSetupStep("install-openclaw");
      report(t("setup.preparingGateway"), 55);
      try {
        await prepareGateway();
      } catch (e) {
        // 即便 Rust 端 prepare 失败也要继续尝试 start_gateway
        debugWarn('gateway', '[setup] prepare_gateway failed, continuing to start_gateway:', e);
      }
      if (!isRunActive(runId)) return;
      patchStep("gateway", "pending", t("setup.installCompleteGatewayPending", "Gateway 配置已准备，点击启动 Gateway 继续。"));
      report(t("setup.installComplete", "必需组件已安装完成"), 68);
      setSetupStep("install-complete");
    } catch (err: any) {
      if (!isRunActive(runId)) return;
      const msg = err?.message || String(err);
      setSetupError(msg);
      report(msg);
      setSetupStep("error");
    }
  }, [beginRun, isRunActive, setSetupStep, t, report, setNeedsGit, setSteps,
      waitForGatewayReady, setGatewayRunning, setSetupError]);

  const runDockerSetup = useCallback(async () => {
    const runId = beginRun();
    setSteps([...INITIAL_DOCKER_STEPS]);
    try {
      setSetupStep("checking");

      patchStep("pull", "running", t("setup.pullingImage"));
      report(t("setup.pullingImage"), 10);
      await pullOpenclawImage("latest");
      if (!isRunActive(runId)) return;
      patchStep("pull", "done");

      patchStep("container", "running", t("setup.startingContainer"));
      report(t("setup.startingContainer"), 50);
      const gatewayStatus = await startDockerGateway();
      if (!isRunActive(runId)) return;
      cacheGatewayTarget(gatewayStatus.port, gatewayStatus.token);
      setGatewayRunning(true);
      patchStep("container", "done");

      patchStep("gateway", "running", t("setup.waitingGateway"));
      report(t("setup.waitingGateway"), 90);
      await waitForGatewayReady(runId, 30_000, gatewayStatus.port);
      if (!isRunActive(runId)) return;
      patchStep("gateway", "done");

      report(t("setup.ready"), 100);
      markSetupReady();
      setSetupStep("ready");
    } catch (err: any) {
      if (!isRunActive(runId)) return;
      setSetupError(err?.message || String(err));
      report(err?.message || String(err));
      setSetupStep("error");
    }
  }, [beginRun, isRunActive, setSetupStep, t, report, setSteps,
      waitForGatewayReady, setGatewayRunning, setSetupError]);

  const selectMode = useCallback((mode: "native" | "docker") => {
    setInstallMode(mode);
    if (mode === "native") {
      setSteps([...INITIAL_NATIVE_STEPS]);
      runNativeSetup();
    } else {
      setSteps([...INITIAL_DOCKER_STEPS]);
      runDockerSetup();
    }
  }, [setInstallMode, runNativeSetup, runDockerSetup, setSteps]);

  const retrySetup = useCallback(async () => {
    setSetupError(null);
    setProgress(0);
    setNeedsGit(false);
    if (installMode === "docker") {
      await runDockerSetup();
    } else {
      await runNativeSetup();
    }
  }, [installMode, setSetupError, setProgress, setNeedsGit, runDockerSetup, runNativeSetup]);

  const goBack = useCallback(() => {
    cancelActiveRun();
    setSetupError(null);
    setProgress(0);
    setNeedsGit(false);
    setSteps([]);
    report(t("setup.chooseMode"), 18);
    setSetupStep("choosing-mode");
  }, [cancelActiveRun, setSetupError, setProgress, setNeedsGit, setSteps, report, t, setSetupStep]);

  const retryGit = useCallback(() => {
    setNeedsGit(false);
    setSetupError(null);
    setProgress(0);
    runNativeSetup();
  }, [setNeedsGit, setSetupError, setProgress, runNativeSetup]);

  const enterWorkspace = useCallback(() => {
    cancelActiveRun();
    setSetupComplete(true);
  }, [cancelActiveRun, setSetupComplete]);

  const detectDocker = useCallback(async () => {
    if (dockerDetectingRef.current) return;
    dockerDetectingRef.current = true;
    setCheckingDocker(true);
    try { setDockerStatus(await checkDocker()); }
    catch { setDockerStatus({ available: false, version: null, daemon_running: false }); }
    finally {
      dockerDetectingRef.current = false;
      setCheckingDocker(false);
    }
  }, [setCheckingDocker, setDockerStatus]);

  return {
    progress, statusMessage, dockerStatus, checkingDocker, needsGit, steps,
    startGateway: startGatewayAction,
    runNativeSetup,
    runDockerSetup,
    retrySetup,
    selectMode,
    detectDocker,
    goBack,
    retryGit,
    enterWorkspace,
  };
}
