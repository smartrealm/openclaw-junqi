// ═══════════════════════════════════════════════════════════
// useSetupFlow — Detection & installation state machine
// Pure logic hook, no UI. Drives app-store state transitions.
// ═══════════════════════════════════════════════════════════

import { useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "@/stores/app-store";
import {
  checkNode, checkGit, checkOpenclaw,
  installNode, installGit, installOpenclaw,
  startGateway, checkDocker, pullOpenclawImage, startDockerGateway,
  type DockerStatus,
} from "@/api/tauri-commands";

function abortSignal(ms = 3000): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

export interface SetupFlow {
  progress: number;
  statusMessage: string;
  dockerStatus: DockerStatus | null;
  checkingDocker: boolean;
  needsGit: boolean;
  startGateway: () => Promise<void>;
  runNativeSetup: () => Promise<void>;
  runDockerSetup: () => Promise<void>;
  selectMode: (mode: "native" | "docker") => void;
  detectDocker: () => Promise<void>;
  goBack: () => void;
  retryGit: () => void;
}

export function useSetupFlow(
  progress: number, setProgress: (v: number) => void,
  statusMessage: string, setStatusMessage: (v: string) => void,
  dockerStatus: DockerStatus | null, setDockerStatus: (v: DockerStatus | null) => void,
  checkingDocker: boolean, setCheckingDocker: (v: boolean) => void,
  needsGit: boolean, setNeedsGit: (v: boolean) => void,
): SetupFlow {
  const {
    setupStep, installMode,
    setSetupStep, setSetupError, setSetupComplete,
    setGatewayRunning, setInstallMode,
  } = useAppStore();

  // ── Auto-detect on mount ──
  useEffect(() => {
    if (setupStep !== "detecting") return;
    (async () => {
      // Strategy: check openclaw status first (most reliable via invoke)
      let installed = false;
      try {
        const oclaw = await checkOpenclaw();
        installed = oclaw.installed;
      } catch {}

      if (!installed) {
        setSetupStep("choosing-mode");
        return;
      }

      // Installed — probe port to check if gateway is running (Rust → HTTP, no CORS)
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const reachable: boolean = await invoke("probe_gateway_port", { port: 18789 });
        if (reachable) { setSetupComplete(true); return; }
      } catch {}

      // Installed but not running — show start button
      setSetupStep("gateway-stopped");
    })();
  }, [setupStep, setSetupComplete, setSetupStep]);

  // ── Docker detect on mount ──
  useEffect(() => {
    (async () => {
      setCheckingDocker(true);
      try { setDockerStatus(await checkDocker()); }
      catch { setDockerStatus({ available: false, version: null, daemon_running: false }); }
      finally { setCheckingDocker(false); }
    })();
  }, []);

  // ── Actions ──

  const startGatewayAction = useCallback(async () => {
    setSetupStep("checking");
    setStatusMessage("Starting Gateway...");
    setProgress(30);
    try {
      await startGateway(18789);
      setGatewayRunning(true);
      setProgress(80);
      await new Promise((r) => setTimeout(r, 2000));
      setSetupComplete(true);
    } catch (e: any) {
      setSetupError(e?.message || String(e));
      setSetupStep("error");
    }
  }, [setSetupStep, setStatusMessage, setProgress, startGateway, setGatewayRunning, setSetupComplete, setSetupError]);

  const runNativeSetup = useCallback(async () => {
    try {
      setSetupStep("checking");
      setStatusMessage("Checking Git..."); setProgress(5);

      const gitStatus = await checkGit();
      if (!gitStatus.available) {
        setSetupStep("install-git");
        setStatusMessage("Installing Git..."); setProgress(10);
        try { await installGit(); }
        catch (gitErr: any) {
          if (String(gitErr).includes("GIT_NOT_FOUND")) {
            setNeedsGit(true); setSetupStep("git-missing"); return;
          }
          throw gitErr;
        }
      }

      setProgress(15); setStatusMessage("Checking Node.js...");
      if (!(await checkNode()).available) {
        setSetupStep("install-node");
        setStatusMessage("Installing Node.js..."); setProgress(25);
        await installNode();
      }

      setProgress(40); setStatusMessage("Checking OpenClaw...");
      if (!(await checkOpenclaw()).installed) {
        setSetupStep("install-openclaw");
        setStatusMessage("Installing OpenClaw..."); setProgress(50);
        await installOpenclaw();
      }

      setProgress(70); setStatusMessage("Starting Gateway...");
      await startGateway(18789);
      setGatewayRunning(true);

      setProgress(85); setStatusMessage("Waiting for Gateway...");
      await new Promise((r) => setTimeout(r, 2000));

      setProgress(100); setStatusMessage("Ready!");
      setSetupStep("ready");
      await new Promise((r) => setTimeout(r, 500));
      setSetupComplete(true);
    } catch (err: any) {
      setSetupError(err?.message || String(err));
      setSetupStep("error");
    }
  }, [setSetupStep, setStatusMessage, setProgress, setNeedsGit, setGatewayRunning, setSetupComplete, setSetupError, checkGit, checkNode, checkOpenclaw, installGit, installNode, installOpenclaw, startGateway]);

  const runDockerSetup = useCallback(async () => {
    try {
      setSetupStep("checking");
      setStatusMessage("Pulling OpenClaw image..."); setProgress(10);
      await pullOpenclawImage("latest");

      setProgress(50); setStatusMessage("Starting container...");
      await startDockerGateway();
      setGatewayRunning(true);

      setProgress(90); setStatusMessage("Waiting for Gateway...");
      await new Promise((r) => setTimeout(r, 1000));

      setProgress(100); setStatusMessage("Ready!");
      setSetupStep("ready");
      await new Promise((r) => setTimeout(r, 500));
      setSetupComplete(true);
    } catch (err: any) {
      setSetupError(err?.message || String(err));
      setSetupStep("error");
    }
  }, [setSetupStep, setStatusMessage, setProgress, setGatewayRunning, setSetupComplete, setSetupError, pullOpenclawImage, startDockerGateway]);

  const selectMode = useCallback((mode: "native" | "docker") => {
    setInstallMode(mode);
    setSetupStep("checking");
    mode === "native" ? runNativeSetup() : runDockerSetup();
  }, [setInstallMode, setSetupStep, runNativeSetup, runDockerSetup]);

  const goBack = useCallback(() => {
    setSetupError(null);
    setProgress(0);
    setNeedsGit(false);
    setSetupStep("choosing-mode");
  }, [setSetupError, setProgress, setNeedsGit, setSetupStep]);

  const retryGit = useCallback(() => {
    setNeedsGit(false);
    setSetupError(null);
    setProgress(0);
    runNativeSetup();
  }, [setNeedsGit, setSetupError, setProgress, runNativeSetup]);

  return {
    progress, statusMessage, dockerStatus, checkingDocker, needsGit,
    startGateway: startGatewayAction,
    runNativeSetup,
    runDockerSetup,
    selectMode,
    detectDocker: async () => {},
    goBack,
    retryGit,
  };
}
