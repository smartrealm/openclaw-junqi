// ═══════════════════════════════════════════════════════════
// useSetupFlow — Detection & installation state machine
// Pure logic hook, no UI. Drives app-store state transitions.
// ═══════════════════════════════════════════════════════════

import { useEffect, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/app-store";
import {
  checkNode, checkGit, checkOpenclaw,
  installNode, installOpenclaw,
  prepareGateway,
  startGateway, checkDocker, pullOpenclawImage, startDockerGateway,
  type DockerStatus,
  type OpenclawStatus,
} from "@/api/tauri-commands";
import { debugWarn } from "@/utils/debugLog";
import { subscribeTauriEvent } from "@/utils/tauriEvents";
import { setupProgressI18nParams } from "./setupProgressParams";
import {
  advanceSetupProgress,
  phaseForSetupEvent,
  progressForPhase,
  type SetupProgressPhase,
} from "./setupProgressModel";
import { enterWorkspaceWithTransition } from "@/motion/workspaceEntryTransition";
import { gateway } from "@/services/gateway";
import { gatewayManager } from "@/services/gateway/GatewayConnectionManager";
import {
  OpenClawWizardClient,
  isOpenClawWizardSessionLost,
  requiresOpenClawOnboarding,
  type OpenClawWizardStep,
} from "@/services/openclawWizard";

export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface StepState {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export type InstallTargetTier = "user" | "xdg" | "sandbox" | "existing";

export interface InstallTarget {
  /**
   * Where the installer decided to put `openclaw`.
   *  - "user": same dir as the user's terminal `npm i -g` (their
   *    actual `npm config get prefix`). `openclaw` will be on PATH
   *    without further action.
   *  - "xdg": fell back to `~/.local` because the user prefix was
   *    not writable. User must add `binPath` to PATH to use
   *    `openclaw` from terminal.
   *  - "sandbox": both the user prefix AND `~/.local` were
   *    unwritable, so the install lands in JunQi's managed
   *    `~/.openclaw/global/`. `openclaw` will not be on PATH; user
   *    must run it via JunQi or symlink it.
   *  - "existing": an `openclaw` install was already on disk before
   *    setup ran, so we skipped the install. The card surfaces the
   *    detected path and version.
   */
  tier: InstallTargetTier;
  path: string;
  /** Only set for the `xdg` tier. */
  binPath?: string;
  /** Only set for the `existing` tier, when a version string was returned. */
  version?: string;
}

const INSTALL_TARGET_KEYS = {
  user: "setup.openclaw.userNpmPrefix",
  xdg: "setup.openclaw.localNpmPrefix",
  sandbox: "setup.openclaw.sandboxNpmPrefix",
  existing: "setup.openclaw.useExisting",
} as const;

function pickInstallTargetFromProgress(
  key: string,
  message: string,
): InstallTarget | null {
  if (
    key !== INSTALL_TARGET_KEYS.user &&
    key !== INSTALL_TARGET_KEYS.xdg &&
    key !== INSTALL_TARGET_KEYS.sandbox &&
    key !== INSTALL_TARGET_KEYS.existing
  ) {
    return null;
  }
  // Reuse the same rule table that drives i18next substitution so
  // the UI path stays in lockstep with the message formatting.
  const params = setupProgressI18nParams(key, message);
  if (!params.path) return null;
  if (key === INSTALL_TARGET_KEYS.xdg) {
    return { tier: "xdg", path: params.path, binPath: params.binPath };
  }
  if (key === INSTALL_TARGET_KEYS.sandbox) {
    return { tier: "sandbox", path: params.path };
  }
  if (key === INSTALL_TARGET_KEYS.existing) {
    return { tier: "existing", path: params.path, version: params.version };
  }
  return { tier: "user", path: params.path };
}

export interface SetupFlow {
  progress: number;
  statusMessage: string;
  dockerStatus: DockerStatus | null;
  openclawStatus: OpenclawStatus | null;
  checkingDocker: boolean;
  needsGit: boolean;
  steps: StepState[];
  installTarget: InstallTarget | null;
  wizardStep: OpenClawWizardStep | null;
  wizardSubmitting: boolean;
  wizardError: string | null;
  needsOnboarding: boolean;
  startGateway: () => Promise<void>;
  submitWizardStep: (stepId: string, value?: unknown) => Promise<void>;
  retryWizard: () => Promise<void>;
  runNativeSetup: () => Promise<void>;
  runDockerSetup: () => Promise<void>;
  retrySetup: () => Promise<void>;
  selectMode: (mode: "native" | "docker") => void;
  detectDocker: () => Promise<void>;
  refreshRuntime: () => Promise<{ status: OpenclawStatus; gatewayRunning: boolean }>;
  goBack: () => void;
  retryGit: () => void;
  enterWorkspace: (origin?: Element | null) => void;
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
    setSetupStep, setSetupError, setSetupComplete, setPostStorageStep,
    setGatewayRunning, setInstallMode, setSetupStatus, clearSetupLogs,
  } = useAppStore();
  const { t } = useTranslation();
  const [installTarget, setInstallTarget] = useState<InstallTarget | null>(null);
  const [openclawStatus, setOpenclawStatus] = useState<OpenclawStatus | null>(null);
  const [wizardStep, setWizardStep] = useState<OpenClawWizardStep | null>(null);
  const [wizardSubmitting, setWizardSubmitting] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(true);
  const wizardClientRef = useRef<OpenClawWizardClient | null>(null);
  if (!wizardClientRef.current) {
    wizardClientRef.current = new OpenClawWizardClient((method, params) => gateway.call(method, params));
  }
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const activeRunRef = useRef(0);
  const beginRun = useCallback(() => {
    activeRunRef.current += 1;
    setInstallTarget(null);
    return activeRunRef.current;
  }, [setInstallTarget]);
  const cancelActiveRun = useCallback(() => {
    activeRunRef.current += 1;
  }, []);
  const isRunActive = useCallback((runId: number) => activeRunRef.current === runId, []);
  const dockerDetectingRef = useRef(false);

  const report = useCallback((message: string, nextProgress?: number) => {
    setStatusMessage(message);
    if (typeof nextProgress === "number") {
      const monotonicProgress = Math.max(progressRef.current, nextProgress);
      progressRef.current = monotonicProgress;
      setProgress(monotonicProgress);
      setSetupStatus(message, monotonicProgress);
      return;
    }
    setSetupStatus(message);
  }, [setStatusMessage, setProgress, setSetupStatus]);

  const reportPhase = useCallback((
    phase: SetupProgressPhase,
    message: string,
    localPercent = 0,
  ) => {
    const nextProgress = advanceSetupProgress(progressRef.current, phase, localPercent);
    report(message, nextProgress);
  }, [report]);

  const resetProgress = useCallback(() => {
    progressRef.current = 0;
    setProgress(0);
  }, [setProgress]);

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

  // ── 挂载后自动检测 ──
  // 探测顺序：check_openclaw → probe_gateway_port（Rust 侧从
  // openclaw.json 读取实际端口）。检测只能推进向导步骤，不能写入
  // “已完成”标记；该标记必须由用户点击“进入工作台”后写入。
  useEffect(() => {
    if (setupStep !== "detecting") return;
    (async () => {
      report(t("setup.detecting"), 0);
      try {
        const oclaw = await checkOpenclaw();
        setOpenclawStatus(oclaw);
        if (!oclaw.installed) {
          // 从未安装过，先确定存储位置，再进入安装方式选择。
          localStorage.removeItem("junqi-setup-done");
          setPostStorageStep("choosing-mode");
          report(t("storage.title", "选择 OpenClaw 数据位置"), 24);
          setSetupStep("storage");
          return;
        }
        let onboardingRequired = true;
        try {
          const detected = await window.aegis.config.detect();
          const loaded = await window.aegis.config.read(detected.path);
          onboardingRequired = requiresOpenClawOnboarding(detected.exists, loaded.data);
          setNeedsOnboarding(onboardingRequired);
        } catch {
          setNeedsOnboarding(true);
        }
        if (oclaw.path) {
          setInstallTarget({ tier: "existing", path: oclaw.path, version: oclaw.version ?? undefined });
        }
        // OpenClaw 已安装，继续探测 Gateway 是否已监听。这里不直接
        // 进入工作台，避免用户在向导中前后切换时被跳过确认步骤。
        try {
          // 不传端口时由 Rust 读取配置；读取失败才回退到 18789。
          const reachable: boolean = await invoke("probe_gateway_port", {});
          if (reachable) {
            setGatewayRunning(true);
            setSteps([{ id: "gateway", label: "Gateway", status: "done" }]);
            setPostStorageStep(onboardingRequired ? "configure-openclaw" : "ready");
            report(t("storage.title", "选择 OpenClaw 数据位置"), 24);
            setSetupStep("storage");
            return;
          }
        } catch {}

        // Installed but gateway not responding → ask the user to start it.
        setPostStorageStep("gateway-stopped");
        report(t("storage.title", "选择 OpenClaw 数据位置"), 24);
        setSetupStep("storage");
      } catch {
        setOpenclawStatus(null);
        setPostStorageStep("choosing-mode");
        report(t("storage.title", "选择 OpenClaw 数据位置"), 24);
        setSetupStep("storage");
      }
    })();
  }, [setupStep, report, t, setGatewayRunning, setPostStorageStep, setSetupStep, setSteps]);

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
    const unlisten = subscribeTauriEvent<{ step: string; message: string; progress: number | null; error: string | null; key?: string } | string>(
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
        // Capture the resolved install target so the UI can surface
        // a dedicated "Install location" card. Reuses the same rule
        // table that drives i18next substitution, so the displayed
        // path is byte-identical to what's in the progress message.
        const resolvedTarget = pickInstallTargetFromProgress(String(key ?? ""), message);
        if (resolvedTarget) setInstallTarget(resolvedTarget);
        const localProgress = p != null ? Math.round(p * 100) : undefined;
        const eventPhase = phaseForSetupEvent(step);
        const nextProgress = eventPhase && typeof localProgress === "number"
          ? progressForPhase(eventPhase, localProgress)
          : undefined;

        // Keep the primary onboarding copy coarse and calm.
        // Gateway preparation emits useful diagnostics, but those belong in the
        // activity log / current step detail rather than replacing the main
        // guide text with internal phrases like "detect/connect/sync runtime".
        const isGatewayDiagnostic =
          step === "gateway" && typeof key === "string" && key.startsWith("setup.gateway.");
        if (isGatewayDiagnostic) {
          if (typeof nextProgress === "number") {
            report(t("setup.preparingGateway"), nextProgress);
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
    );
    return unlisten;
  }, [t, report]);

  // ── Helpers ──
  function patchStep(id: string, status: StepStatus, detail?: string) {
    setSteps(stepsRef.current.map((s) =>
      s.id === id ? { ...s, status, detail } : s
    ));
  }

  const waitForGatewayConnection = useCallback(async (timeoutMs = 20_000) => {
    gatewayManager.reconnect();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (gateway.getStatus().connected) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(t("setup.wizard.connectionTimeout", "Gateway 已启动，但配置向导连接超时。"));
  }, [t]);

  const refreshGatewayConnectionTarget = useCallback(async () => {
    try {
      const target = await invoke<{ port: number; token: string | null }>("detect_gateway_config");
      cacheGatewayTarget(target.port, target.token);
      gateway.disconnect();
      gatewayManager.reconnect();
    } catch {
      // The normal connection resolver can still read settings/config later.
    }
  }, []);

  const applyWizardResult = useCallback(async (result: { done: boolean; status?: string; step?: OpenClawWizardStep; error?: string }) => {
    if (result.error || result.status === "error") {
      throw new Error(result.error || t("setup.wizard.failed", "OpenClaw 配置向导执行失败。"));
    }
    if (result.done || result.status === "done") {
      setWizardStep(null);
      setNeedsOnboarding(false);
      await refreshGatewayConnectionTarget();
      report(t("setup.ready"), 100);
      setSetupStep("ready");
      return;
    }
    if (!result.step) {
      throw new Error(t("setup.wizard.missingStep", "OpenClaw 配置向导没有返回下一步。"));
    }
    setWizardStep(result.step);
    report(result.step.title || result.step.message || t("setup.wizard.title", "配置 OpenClaw"), 82);
    setSetupStep("configure-openclaw");
  }, [refreshGatewayConnectionTarget, report, setSetupStep, t]);

  const startOfficialOnboarding = useCallback(async () => {
    setWizardError(null);
    setWizardSubmitting(true);
    try {
      await waitForGatewayConnection();
      const result = await wizardClientRef.current!.start();
      await applyWizardResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWizardError(message);
      setSetupError(message);
      setSetupStep("configure-openclaw");
    } finally {
      setWizardSubmitting(false);
    }
  }, [applyWizardResult, setSetupError, setSetupStep, waitForGatewayConnection]);

  const submitWizardStep = useCallback(async (stepId: string, value?: unknown) => {
    if (wizardSubmitting) return;
    setWizardError(null);
    setWizardSubmitting(true);
    try {
      const result = await wizardClientRef.current!.next(stepId, value);
      await applyWizardResult(result);
    } catch (error) {
      if (isOpenClawWizardSessionLost(error)) {
        await startOfficialOnboarding();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setWizardError(message);
      setSetupError(message);
    } finally {
      setWizardSubmitting(false);
    }
  }, [applyWizardResult, setSetupError, startOfficialOnboarding, wizardSubmitting]);

  const wizardAutoStartRef = useRef(false);
  useEffect(() => {
    if (setupStep !== "configure-openclaw" || wizardStep || wizardSubmitting || wizardError) return;
    if (wizardAutoStartRef.current) return;
    wizardAutoStartRef.current = true;
    void startOfficialOnboarding().finally(() => {
      wizardAutoStartRef.current = false;
    });
  }, [setupStep, startOfficialOnboarding, wizardError, wizardStep, wizardSubmitting]);

  // ── Actions ──
  const startGatewayAction = useCallback(async () => {
    const runId = beginRun();
    setSetupStep("checking");
    reportPhase("gatewayConfig", t("setup.gatewayReadingConfig", "正在读取 Gateway 配置…"));
    if (stepsRef.current.some((s) => s.id === "gateway")) {
      patchStep("gateway", "running", t("setup.startingGateway"));
    } else {
      setSteps([{ id: "gateway", label: "Gateway", status: "running", detail: t("setup.startingGateway") }]);
    }
    try {
      const status: any = await startGateway();
      cacheGatewayTarget(status?.port, status?.token);
      patchStep("gateway", "running", t("setup.gatewayWaitingPort", "Gateway 进程已启动，正在等待端口就绪…"));
      reportPhase("gatewayPort", t("setup.gatewayWaitingPort", "Gateway 进程已启动，正在等待端口就绪…"));
      await waitForGatewayReady(runId, 30_000, status?.port);
      if (!isRunActive(runId)) return;
      setGatewayRunning(true);
      if (stepsRef.current.some((s) => s.id === "gateway")) {
        patchStep("gateway", "done");
      } else {
        setSteps([{ id: "gateway", label: "Gateway", status: "done" }]);
      }
      reportPhase("ready", t("setup.gatewayConnected", "Gateway 已连接"));
      if (!isRunActive(runId)) return;
      if (needsOnboarding) {
        await startOfficialOnboarding();
      } else {
        await new Promise((r) => setTimeout(r, 600));
        if (!isRunActive(runId)) return;
        setSetupStep("ready");
      }
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
  }, [beginRun, isRunActive, setSetupStep, report, reportPhase, t, setSteps, waitForGatewayReady, setGatewayRunning, setSetupError, needsOnboarding, startOfficialOnboarding]);

  const runNativeSetup = useCallback(async () => {
    const runId = beginRun();
    resetProgress();
    clearSetupLogs();
    const s = [...INITIAL_NATIVE_STEPS];
    setSteps(s);
    try {
      setSetupStep("checking");

      // Git
      patchStep("git", "running", t("setup.checkingGit"));
      reportPhase("git", t("setup.checkingGit"));
      const gitStatus = await checkGit();
      if (!isRunActive(runId)) return;
      if (!gitStatus.available) {
        patchStep("git", "error", t("setup.gitRequiredDesc"));
        setNeedsGit(true);
        setSetupStep("git-missing");
        reportPhase("git", t("setup.gitRequiredDesc"), 100);
        return;
      } else {
        patchStep("git", "done", gitStatus.version ?? undefined);
      }

      // Node
      patchStep("node", "running", t("setup.checkingNode"));
      reportPhase("node", t("setup.checkingNode"));
      const nodeStatus = await checkNode();
      if (!isRunActive(runId)) return;
      if (!nodeStatus.available) {
        patchStep("node", "running", t("setup.installingNode"));
        setSetupStep("install-node");
        reportPhase("node", t("setup.installingNode"), 20);
        await installNode();
        if (!isRunActive(runId)) return;
        patchStep("node", "done");
      } else {
        patchStep("node", "done", nodeStatus.version ?? undefined);
      }

      // OpenClaw
      patchStep("openclaw", "running", t("setup.checkingOpenclaw"));
      reportPhase("openclaw", t("setup.checkingOpenclaw"));
      const oclawStatus = await checkOpenclaw();
      setOpenclawStatus(oclawStatus);
      if (!isRunActive(runId)) return;
      if (!oclawStatus.installed) {
        setNeedsOnboarding(true);
        patchStep("openclaw", "running", t("setup.installingOpenclaw"));
        setSetupStep("install-openclaw");
        reportPhase("openclaw", t("setup.installingOpenclaw"), 10);
        await installOpenclaw();
        try {
          const installedStatus = await checkOpenclaw();
          setOpenclawStatus(installedStatus);
        } catch {
          // install_openclaw already validates and reports failures; this refresh is best effort.
        }
        if (!isRunActive(runId)) return;
        patchStep("openclaw", "done");
      } else {
        if (oclawStatus.path) {
          setInstallTarget({ tier: "existing", path: oclawStatus.path, version: oclawStatus.version ?? undefined });
        }
        patchStep("openclaw", "done", oclawStatus.version ?? undefined);
      }

      // Gateway — 准备阶段。前端 `setup-progress` 监听会把 Rust 端
      // 通过 `prepare_gateway` 流式上报的每一条 step="gateway" 文案
      // 原样展示到 statusMessage 上，与 install_* 的呈现形态完全一致。
      patchStep("gateway", "running", t("setup.preparingGateway"));
      setSetupStep("install-openclaw");
      reportPhase("gatewayPrepare", t("setup.preparingGateway"));
      try {
        await prepareGateway();
      } catch (e) {
        // 即便 Rust 端 prepare 失败也要继续尝试 start_gateway
        debugWarn('gateway', '[setup] prepare_gateway failed, continuing to start_gateway:', e);
      }
      if (!isRunActive(runId)) return;
      patchStep("gateway", "pending", t("setup.installCompleteGatewayPending", "Gateway 配置已准备，点击启动 Gateway 继续。"));
      reportPhase("awaitingGatewayStart", t("setup.installComplete", "必需组件已安装完成"));
      setSetupStep("install-complete");
    } catch (err: any) {
      if (!isRunActive(runId)) return;
      const msg = err?.message || String(err);
      setSetupError(msg);
      report(msg);
      setSetupStep("error");
    }
  }, [beginRun, resetProgress, isRunActive, setSetupStep, t, report, reportPhase, setNeedsGit, setSteps,
      waitForGatewayReady, setGatewayRunning, setSetupError, clearSetupLogs]);

  const runDockerSetup = useCallback(async () => {
    const runId = beginRun();
    resetProgress();
    clearSetupLogs();
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

      if (needsOnboarding) {
        await startOfficialOnboarding();
      } else {
        report(t("setup.ready"), 100);
        setSetupStep("ready");
      }
    } catch (err: any) {
      if (!isRunActive(runId)) return;
      setSetupError(err?.message || String(err));
      report(err?.message || String(err));
      setSetupStep("error");
    }
  }, [beginRun, resetProgress, isRunActive, setSetupStep, t, report, setSteps,
      waitForGatewayReady, setGatewayRunning, setSetupError, clearSetupLogs, needsOnboarding, startOfficialOnboarding]);

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
    void wizardClientRef.current?.cancel().catch(() => {});
    setWizardStep(null);
    setWizardError(null);
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

  const enterWorkspace = useCallback((origin?: Element | null) => {
    cancelActiveRun();
    enterWorkspaceWithTransition(() => setSetupComplete(true), origin);
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

  const refreshRuntime = useCallback(async () => {
    const status = await checkOpenclaw();
    setOpenclawStatus(status);
    if (status.path) {
      setInstallTarget((current) => current
        ? { ...current, path: status.path!, version: status.version ?? undefined }
        : { tier: "existing", path: status.path!, version: status.version ?? undefined });
    }

    const gatewayRunning = await invoke<boolean>("probe_gateway_port", {}).catch(() => false);
    setGatewayRunning(gatewayRunning);
    const currentSteps = stepsRef.current;
    if (currentSteps.some((step) => step.id === "gateway")) {
      setSteps(currentSteps.map((step) => step.id === "gateway"
        ? { ...step, status: gatewayRunning ? "done" : "pending" }
        : step));
    } else if (gatewayRunning) {
      setSteps([{ id: "gateway", label: "Gateway", status: "done" }]);
    }
    return { status, gatewayRunning };
  }, [setGatewayRunning, setSteps]);

  return {
    progress, statusMessage, dockerStatus, openclawStatus, checkingDocker, needsGit, steps,
    installTarget,
    wizardStep,
    wizardSubmitting,
    wizardError,
    needsOnboarding,
    startGateway: startGatewayAction,
    submitWizardStep,
    retryWizard: startOfficialOnboarding,
    runNativeSetup,
    runDockerSetup,
    retrySetup,
    selectMode,
    detectDocker,
    refreshRuntime,
    goBack,
    retryGit,
    enterWorkspace,
  };
}
