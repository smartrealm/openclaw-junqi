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
  installNode, installGit, installOpenclaw,
  prepareGateway,
  startGateway, checkDocker, pullOpenclawImage, startDockerGateway,
  type DockerStatus,
} from "@/api/tauri-commands";

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
  selectMode: (mode: "native" | "docker") => void;
  detectDocker: () => Promise<void>;
  goBack: () => void;
  retryGit: () => void;
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
    setGatewayRunning, setInstallMode,
  } = useAppStore();

  // ── Auto-detect on mount ──
  // Probe order: check_openclaw → probe_gateway_port (reads config port
  // from openclaw.json on the Rust side). No hardcoded port, no
  // prevSetupDone gate — if the gateway is running we connect to it
  // regardless of whether setup was previously completed.
  useEffect(() => {
    if (setupStep !== "detecting") return;
    (async () => {
      try {
        const oclaw = await checkOpenclaw();
        if (!oclaw.installed) {
          // Never installed — go straight to mode selection
          setSetupStep("choosing-mode");
          return;
        }

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

        // Installed but gateway not responding → auto-start it
        setSetupStep("gateway-stopped");
      } catch {
        setSetupStep("choosing-mode");
      }
    })();
  }, [setupStep]);

  // ── Docker detect on mount ──
  useEffect(() => {
    (async () => {
      setCheckingDocker(true);
      try { setDockerStatus(await checkDocker()); }
      catch { setDockerStatus({ available: false, version: null, daemon_running: false }); }
      finally { setCheckingDocker(false); }
    })();
  }, []);

  // ── setup-progress event listener (granular per-step progress from Rust) ──
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const { t } = useTranslation();
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ step: string; message: string; progress: number | null; error: string | null; key?: string }>(
      "setup-progress",
      (event) => {
        const { step, message, progress: p, error, key } = event.payload as any;
        // Prefer i18n-resolved text; fall back to the raw Rust message.
        const display = key && t(key as string) !== key ? (t(key as string) as string) : message;
        setStatusMessage(display);
        if (p != null) setProgress(Math.round(p * 100));
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
  }, [t]);

  // ── Helpers ──
  function patchStep(id: string, status: StepStatus, detail?: string) {
    setSteps(stepsRef.current.map((s) =>
      s.id === id ? { ...s, status, detail } : s
    ));
  }

  // ── Actions ──
  const startGatewayAction = useCallback(async () => {
    setSetupStep("checking");
    setStatusMessage("Starting Gateway...");
    setProgress(30);
    setSteps([{ id: "gateway", label: "Gateway", status: "running" }]);
    try {
      await startGateway(18789);
      setGatewayRunning(true);
      setSteps([{ id: "gateway", label: "Gateway", status: "done" }]);
      setProgress(80);
      await new Promise((r) => setTimeout(r, 1500));
      setSetupComplete(true);
    } catch (e: any) {
      setSteps([{ id: "gateway", label: "Gateway", status: "error", detail: String(e?.message ?? e) }]);
      setSetupError(e?.message || String(e));
      setSetupStep("error");
    }
  }, [setSetupStep, setStatusMessage, setProgress, setSteps, setGatewayRunning, setSetupComplete, setSetupError]);

  // ── Auto-start gateway when openclaw is installed but gateway is stopped ──
  // Instead of showing a manual "Start Gateway" button, we auto-start immediately.
  // If it fails, the error screen with retry button is shown.
  useEffect(() => {
    if (setupStep !== "gateway-stopped") return;
    startGatewayAction();
  }, [setupStep, startGatewayAction]);

  const runNativeSetup = useCallback(async () => {
    const s = [...INITIAL_NATIVE_STEPS];
    setSteps(s);
    try {
      setSetupStep("checking");

      // Git
      patchStep("git", "running", "Checking...");
      setStatusMessage("Checking Git..."); setProgress(5);
      const gitStatus = await checkGit();
      if (!gitStatus.available) {
        patchStep("git", "running", "Installing...");
        setSetupStep("install-git");
        setStatusMessage("Installing Git..."); setProgress(10);
        try {
          await installGit();
          patchStep("git", "done");
        } catch (gitErr: any) {
          if (String(gitErr).includes("GIT_NOT_FOUND")) {
            patchStep("git", "error", "Manual install required");
            setNeedsGit(true); setSetupStep("git-missing"); return;
          }
          throw gitErr;
        }
      } else {
        patchStep("git", "done", gitStatus.version ?? undefined);
      }

      // Node
      patchStep("node", "running", "Checking...");
      setProgress(15); setStatusMessage("Checking Node.js...");
      const nodeStatus = await checkNode();
      if (!nodeStatus.available) {
        patchStep("node", "running", "Installing...");
        setSetupStep("install-node");
        setStatusMessage("Installing Node.js..."); setProgress(25);
        await installNode();
        patchStep("node", "done");
      } else {
        patchStep("node", "done", nodeStatus.version ?? undefined);
      }

      // OpenClaw
      patchStep("openclaw", "running", "Checking...");
      setProgress(40); setStatusMessage("Checking OpenClaw...");
      const oclawStatus = await checkOpenclaw();
      if (!oclawStatus.installed) {
        patchStep("openclaw", "running", "Installing...");
        setSetupStep("install-openclaw");
        setStatusMessage("Installing OpenClaw..."); setProgress(50);
        await installOpenclaw();
        patchStep("openclaw", "done");
      } else {
        patchStep("openclaw", "done", oclawStatus.version ?? undefined);
      }

      // Gateway — 准备阶段。前端 `setup-progress` 监听会把 Rust 端
      // 通过 `prepare_gateway` 流式上报的每一条 step="gateway" 文案
      // 原样展示到 statusMessage 上，与 install_* 的呈现形态完全一致。
      patchStep("gateway", "running", "Preparing…");
      setSetupStep("install-openclaw");
      setProgress(55);
      try {
        await prepareGateway();
      } catch (e) {
        // 即便 Rust 端 prepare 失败也要继续尝试 start_gateway
        console.warn('[setup] prepare_gateway failed, continuing to start_gateway:', e);
      }
      setProgress(70);
      patchStep("gateway", "running", "Starting…");
      setStatusMessage("Starting Gateway...");
      await startGateway(18789);
      setGatewayRunning(true);
      patchStep("gateway", "done");

      setProgress(90); setStatusMessage("Waiting for Gateway...");
      await new Promise((r) => setTimeout(r, 2000));

      setProgress(100); setStatusMessage("Ready!");
      setSetupStep("ready");
      await new Promise((r) => setTimeout(r, 600));
      setSetupComplete(true);
    } catch (err: any) {
      const msg = err?.message || String(err);
      setSetupError(msg);
      setSetupStep("error");
    }
  }, [setSetupStep, setStatusMessage, setProgress, setNeedsGit, setSteps,
      setGatewayRunning, setSetupComplete, setSetupError]);

  const runDockerSetup = useCallback(async () => {
    setSteps([...INITIAL_DOCKER_STEPS]);
    try {
      setSetupStep("checking");

      patchStep("pull", "running", "Pulling...");
      setStatusMessage("Pulling OpenClaw image..."); setProgress(10);
      await pullOpenclawImage("latest");
      patchStep("pull", "done");

      patchStep("container", "running", "Starting...");
      setProgress(50); setStatusMessage("Starting container...");
      await startDockerGateway();
      setGatewayRunning(true);
      patchStep("container", "done");

      patchStep("gateway", "running", "Connecting...");
      setProgress(90); setStatusMessage("Waiting for Gateway...");
      await new Promise((r) => setTimeout(r, 1000));
      patchStep("gateway", "done");

      setProgress(100); setStatusMessage("Ready!");
      setSetupStep("ready");
      await new Promise((r) => setTimeout(r, 600));
      setSetupComplete(true);
    } catch (err: any) {
      setSetupError(err?.message || String(err));
      setSetupStep("error");
    }
  }, [setSetupStep, setStatusMessage, setProgress, setSteps,
      setGatewayRunning, setSetupComplete, setSetupError]);

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

  const goBack = useCallback(() => {
    setSetupError(null);
    setProgress(0);
    setNeedsGit(false);
    setSteps([]);
    setSetupStep("choosing-mode");
  }, [setSetupError, setProgress, setNeedsGit, setSteps, setSetupStep]);

  const retryGit = useCallback(() => {
    setNeedsGit(false);
    setSetupError(null);
    setProgress(0);
    runNativeSetup();
  }, [setNeedsGit, setSetupError, setProgress, runNativeSetup]);

  const detectDocker = useCallback(async () => {
    setCheckingDocker(true);
    try { setDockerStatus(await checkDocker()); }
    catch { setDockerStatus({ available: false, version: null, daemon_running: false }); }
    finally { setCheckingDocker(false); }
  }, [setCheckingDocker, setDockerStatus]);

  return {
    progress, statusMessage, dockerStatus, checkingDocker, needsGit, steps,
    startGateway: startGatewayAction,
    runNativeSetup,
    runDockerSetup,
    selectMode,
    detectDocker,
    goBack,
    retryGit,
  };
}
