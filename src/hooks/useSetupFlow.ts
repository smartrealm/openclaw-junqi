// ═══════════════════════════════════════════════════════════
// useSetupFlow — Detection & installation state machine
// Pure logic hook, no UI. Drives app-store state transitions.
// ═══════════════════════════════════════════════════════════

import { useEffect, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/app-store";
import {
  isStaleSetupBackDestination,
  setupStepMessageKey,
  setupStepProgress,
  type InstallMode,
  type SetupStep,
} from "@/stores/setup-navigation";
import {
  checkNode, checkNpm, checkGit, checkOpenclaw,
  installNode, installGit, installOpenclaw,
  applyTerminalIntegration,
  prepareGateway,
  checkDocker, pullOpenclawImage,
  type DockerStatus,
  type OpenclawStatus,
} from "@/api/tauri-commands";
import { debugWarn } from "@/utils/debugLog";
import { subscribeTauriEvent } from "@/utils/tauriEvents";
import { setupProgressI18nParams } from "./setupProgressParams";
import {
  advanceSetupProgress,
  progressForSetupEvent,
  type SetupProgressPhase,
} from "./setupProgressModel";
import { normalizeSetupProgressPayload } from "./setupProgressEvents";
import { enterWorkspaceWithTransition } from "@/motion/workspaceEntryTransition";
import { gateway } from "@/services/gateway";
import { gatewayManager } from "@/services/gateway/GatewayConnectionManager";
import {
  diagnoseGatewayRecovery,
  gatewayMigrationRetryDelayMs,
  runOpenClawRepair,
} from "@/services/gateway/openclawRepair";
import { defaultGatewayWsUrl } from "@/config/runtimeDefaults";
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
  progress?: number;
}

export type InstallTargetTier = "user" | "userMissingPath" | "custom" | "xdg" | "sandbox" | "existing";

export interface InstallTarget {
  /**
   * Where the installer decided to put `openclaw`.
   *  - "user": same dir as the user's terminal `npm i -g` (their
   *    actual `npm config get prefix`) and its bin directory is on PATH.
   *  - "userMissingPath": same npm prefix as the user's terminal, but
   *    its bin directory is not currently on the login-shell PATH.
   *  - "custom": explicit global prefix selected during setup.
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
  /** Bin directory surfaced when a fallback requires manual PATH setup. */
  binPath?: string;
  /** Only set for the `existing` tier, when a version string was returned. */
  version?: string;
}

const INSTALL_TARGET_KEYS = {
  user: "setup.openclaw.userNpmPrefix",
  userMissingPath: "setup.openclaw.userNpmPrefixMissingPath",
  custom: "setup.openclaw.customNpmPrefix",
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
    key !== INSTALL_TARGET_KEYS.userMissingPath &&
    key !== INSTALL_TARGET_KEYS.custom &&
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
  if (key === INSTALL_TARGET_KEYS.userMissingPath) {
    return { tier: "userMissingPath", path: params.path };
  }
  if (key === INSTALL_TARGET_KEYS.custom) {
    return { tier: "custom", path: params.path };
  }
  if (key === INSTALL_TARGET_KEYS.existing) {
    return { tier: "existing", path: params.path, version: params.version };
  }
  return { tier: "user", path: params.path };
}

export interface SetupFlow {
  progress: number;
  statusMessage: string;
  installMode: InstallMode;
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
  repairing: boolean;
  startGateway: () => Promise<void>;
  retryGateway: () => Promise<void>;
  repairAndRetry: () => Promise<void>;
  submitWizardStep: (stepId: string, value?: unknown) => Promise<void>;
  retryWizard: () => Promise<void>;
  runNativeSetup: () => Promise<void>;
  runDockerSetup: () => Promise<void>;
  retrySetup: () => Promise<void>;
  completeStorageSetup: (result?: { createdFresh: boolean }) => void;
  selectMode: (mode: InstallMode) => void;
  detectDocker: () => Promise<void>;
  refreshRuntime: () => Promise<{ status: OpenclawStatus; gatewayRunning: boolean }>;
  goBack: () => void;
  retryGit: () => void;
  enterWorkspace: (origin?: Element | null) => void;
}

const INITIAL_NATIVE_STEPS: StepState[] = [
  { id: "git",       label: "Git",        status: "pending" },
  { id: "node",      label: "Node.js",    status: "pending" },
  { id: "npm",       label: "npm",        status: "pending" },
  { id: "openclaw",  label: "OpenClaw",   status: "pending" },
  { id: "terminal",  label: "Terminal",   status: "pending" },
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
      ...(port ? { gatewayUrl: defaultGatewayWsUrl(port) } : {}),
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
    setupStep, setupError, installMode, postStorageStep, gatewayRunning,
    replaceSetupStep, navigateSetup, goBackSetup,
    setSetupError, setSetupComplete, setPostStorageStep,
    setGatewayRunning, setInstallMode, setSetupStatus, clearSetupLogs, appendSetupLog,
  } = useAppStore();
  const { t } = useTranslation();
  const [installTarget, setInstallTarget] = useState<InstallTarget | null>(null);
  const [openclawStatus, setOpenclawStatus] = useState<OpenclawStatus | null>(null);
  const [wizardStep, setWizardStep] = useState<OpenClawWizardStep | null>(null);
  const [wizardSubmitting, setWizardSubmitting] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const wizardClientRef = useRef<OpenClawWizardClient | null>(null);
  if (!wizardClientRef.current) {
    wizardClientRef.current = new OpenClawWizardClient((method, params) => gateway.call(method, params));
  }
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const commitSteps = useCallback((next: StepState[]) => {
    stepsRef.current = next;
    setSteps(next);
  }, [setSteps]);
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

  const presentSetupStep = useCallback((step: SetupStep) => {
    const message = t(setupStepMessageKey(step));
    const nextProgress = setupStepProgress(step);
    progressRef.current = nextProgress;
    setStatusMessage(message);
    setProgress(nextProgress);
    setSetupStatus(message, nextProgress);
  }, [setProgress, setSetupStatus, setStatusMessage, t]);

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
    let cancelled = false;
    void (async () => {
      report(t("setup.detecting"), 0);
      setGatewayRunning(false);
      try {
        const oclaw = await checkOpenclaw();
        if (cancelled) return;
        setOpenclawStatus(oclaw);
        if (!oclaw.installed) {
          // 从未安装过，先确定存储位置，再进入安装方式选择。
          localStorage.removeItem("junqi-setup-done");
          setPostStorageStep("choosing-mode");
          report(t("storage.title", "选择 OpenClaw 数据位置"), 24);
          navigateSetup("storage", "replace");
          return;
        }
        let onboardingRequired = true;
        try {
          const detected = await window.aegis.config.detect();
          if (cancelled) return;
          const loaded = await window.aegis.config.read(detected.path);
          if (cancelled) return;
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
          // 不传端口时由 Rust 读取配置；读取失败时使用共享运行时默认值。
          const reachable: boolean = await invoke("probe_gateway_port", {});
          if (cancelled) return;
          if (reachable) {
            setGatewayRunning(true);
            commitSteps([{ id: "gateway", label: "Gateway", status: "done", progress: 100 }]);
            setPostStorageStep(onboardingRequired ? "configure-openclaw" : "ready");
            report(t("storage.title", "选择 OpenClaw 数据位置"), 24);
            navigateSetup("storage", "replace");
            return;
          }
        } catch {
          if (cancelled) return;
        }

        // Installed but gateway not responding → ask the user to start it.
        setPostStorageStep("gateway-stopped");
        report(t("storage.title", "选择 OpenClaw 数据位置"), 24);
        navigateSetup("storage", "replace");
      } catch {
        if (cancelled) return;
        setOpenclawStatus(null);
        setPostStorageStep("choosing-mode");
        report(t("storage.title", "选择 OpenClaw 数据位置"), 24);
        navigateSetup("storage", "replace");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setupStep, report, t, setGatewayRunning, setPostStorageStep, navigateSetup, commitSteps]);

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
  useEffect(() => {
    const unlisten = subscribeTauriEvent<{ step: string; message: string; progress: number | null; error: string | null; key?: string } | string>(
      "setup-progress",
      (event) => {
        const normalized = normalizeSetupProgressPayload(event.payload);
        if (!normalized) return;
        const { step, message, progress: localProgress, error, key } = normalized;
        if (!step) {
          report(message);
          return;
        }
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
        const nextProgress = typeof localProgress === "number"
          ? progressForSetupEvent(step, localProgress, installMode) ?? undefined
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
          node: "node", npm: "npm", git: "git", openclaw: "openclaw",
          gateway: "gateway", pull: "pull", container: "container",
        };
        const sid = stepMap[step];
        if (sid) {
          const newSteps = stepsRef.current.map((s) =>
            s.id === sid
              ? {
                  ...s,
                  status: (error ? "error" : "running") as StepStatus,
                  detail: display,
                  progress: typeof localProgress === "number"
                    ? Math.max(s.progress ?? 0, localProgress)
                    : s.progress,
                }
              : s
          );
          commitSteps(newSteps);
        }
      }
    );
    return unlisten;
  }, [t, report, installMode, setInstallTarget, commitSteps]);

  // ── Helpers ──
  function patchStep(id: string, status: StepStatus, detail?: string) {
    commitSteps(stepsRef.current.map((s) =>
      s.id === id
        ? {
            ...s,
            status,
            detail,
            progress: status === "done" ? 100 : status === "pending" ? undefined : s.progress,
          }
        : s
    ));
  }

  function failRunningStep(message: string) {
    const running = stepsRef.current.find((step) => step.status === "running");
    if (running) patchStep(running.id, "error", message);
    appendSetupLog({
      source: "setup",
      message,
      step: running?.id,
      level: "error",
    });
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
      setPostStorageStep("ready");
      await refreshGatewayConnectionTarget();
      report(t("setup.ready"), 100);
      replaceSetupStep("ready");
      return;
    }
    if (!result.step) {
      throw new Error(t("setup.wizard.missingStep", "OpenClaw 配置向导没有返回下一步。"));
    }
    setWizardStep(result.step);
    report(result.step.title || result.step.message || t("setup.wizard.title", "配置 OpenClaw"), 82);
    replaceSetupStep("configure-openclaw");
  }, [refreshGatewayConnectionTarget, report, setPostStorageStep, replaceSetupStep, t]);

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
      replaceSetupStep("configure-openclaw");
    } finally {
      setWizardSubmitting(false);
    }
  }, [applyWizardResult, setSetupError, replaceSetupStep, waitForGatewayConnection]);

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
    setGatewayRunning(false);
    if (setupStep === "gateway-stopped" || setupStep === "install-complete") {
      navigateSetup("checking", "push");
    } else {
      replaceSetupStep("checking");
    }
    reportPhase("gatewayConfig", t("setup.gatewayReadingConfig", "正在读取 Gateway 配置…"));
    if (stepsRef.current.some((s) => s.id === "gateway")) {
      patchStep("gateway", "running", t("setup.startingGateway"));
    } else {
      commitSteps([{ id: "gateway", label: "Gateway", status: "running", detail: t("setup.startingGateway") }]);
    }
    try {
      const status: any = await gatewayManager.startForSetup();
      cacheGatewayTarget(status?.port, status?.token);
      patchStep("gateway", "running", t("setup.gatewayConnecting", "Gateway 已就绪，正在建立连接…"));
      reportPhase("gatewayPort", t("setup.gatewayConnecting", "Gateway 已就绪，正在建立连接…"));
      await waitForGatewayReady(runId, 10_000, status?.port);
      if (!isRunActive(runId)) return;
      setGatewayRunning(true);
      setPostStorageStep(needsOnboarding ? "configure-openclaw" : "ready");
      if (stepsRef.current.some((s) => s.id === "gateway")) {
        patchStep("gateway", "done");
      } else {
        commitSteps([{ id: "gateway", label: "Gateway", status: "done", progress: 100 }]);
      }
      reportPhase("ready", t("setup.gatewayConnected", "Gateway 已连接"));
      if (!isRunActive(runId)) return;
      if (needsOnboarding) {
        await startOfficialOnboarding();
      } else {
        await new Promise((r) => setTimeout(r, 600));
        if (!isRunActive(runId)) return;
        replaceSetupStep("ready");
      }
    } catch (e: any) {
      if (!isRunActive(runId)) return;
      setGatewayRunning(false);
      if (stepsRef.current.some((s) => s.id === "gateway")) {
        patchStep("gateway", "error", String(e?.message ?? e));
      } else {
        commitSteps([{ id: "gateway", label: "Gateway", status: "error", detail: String(e?.message ?? e) }]);
      }
      appendSetupLog({ source: "setup", message: String(e?.message ?? e), step: "gateway", level: "error" });
      setSetupError(e?.message || String(e));
      report(e?.message || String(e));
      replaceSetupStep("error");
    }
  }, [beginRun, isRunActive, setupStep, navigateSetup, replaceSetupStep, report, reportPhase, t, commitSteps, waitForGatewayReady, setGatewayRunning, setPostStorageStep, setSetupError, needsOnboarding, startOfficialOnboarding, appendSetupLog]);

  const runNativeSetup = useCallback(async () => {
    const runId = beginRun();
    clearSetupLogs();
    const s = [...INITIAL_NATIVE_STEPS];
    commitSteps(s);
    try {
      replaceSetupStep("checking");

      // Git
      patchStep("git", "running", t("setup.checkingGit"));
      reportPhase("git", t("setup.checkingGit"));
      const gitStatus = await checkGit();
      if (!isRunActive(runId)) return;
      if (!gitStatus.available) {
        const isWindows = navigator.userAgent.toLowerCase().includes("windows");
        if (!isWindows) {
          patchStep("git", "error", t("setup.gitRequiredDesc"));
          setNeedsGit(true);
          replaceSetupStep("git-missing");
          reportPhase("git", t("setup.gitRequiredDesc"), 100);
          return;
        }
        patchStep("git", "running", t("setup.installingGit", "正在静默安装 Git…"));
        replaceSetupStep("install-git");
        await installGit();
        const installedGit = await checkGit();
        if (!installedGit.available) throw new Error(t("setup.gitRequiredDesc"));
        patchStep("git", "done", installedGit.version ?? undefined);
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
        replaceSetupStep("install-node");
        reportPhase("node", t("setup.installingNode"), 20);
        await installNode();
        if (!isRunActive(runId)) return;
        const installedNode = await checkNode();
        if (!installedNode.available) throw new Error(t("setup.nodeInstallFailed", "Node.js 安装后校验失败"));
        patchStep("node", "done", installedNode.version ?? undefined);
      } else {
        patchStep("node", "done", nodeStatus.version ?? undefined);
      }

      // npm is independently verified because a system Node installation can
      // exist without npm. Installation keeps npm's own default cache unless
      // the user explicitly selected an override in storage settings.
      patchStep("npm", "running", t("setup.checkingNpm", "正在检查 npm 版本…"));
      let npmStatus = await checkNpm();
      if (!npmStatus.available) {
        patchStep("npm", "running", t("setup.installingNpm", "正在通过系统 Node.js 安装 npm…"));
        await installNode();
        npmStatus = await checkNpm();
      }
      if (!npmStatus.available) throw new Error(t("setup.npmInstallFailed", "npm 安装后校验失败"));
      patchStep("npm", "done", npmStatus.version ?? undefined);

      // OpenClaw
      patchStep("openclaw", "running", t("setup.checkingOpenclaw"));
      reportPhase("openclaw", t("setup.checkingOpenclaw"));
      const oclawStatus = await checkOpenclaw();
      setOpenclawStatus(oclawStatus);
      if (!isRunActive(runId)) return;
      if (!oclawStatus.installed) {
        setNeedsOnboarding(true);
        patchStep("openclaw", "running", t("setup.installingOpenclaw"));
        replaceSetupStep("install-openclaw");
        reportPhase("openclaw", t("setup.installingOpenclaw"), 10);
        await installOpenclaw();
        const installedStatus = await checkOpenclaw();
        setOpenclawStatus(installedStatus);
        if (!isRunActive(runId)) return;
        if (!installedStatus.installed) throw new Error(installedStatus.error || t("setup.openclawInstallFailed", "OpenClaw 安装后校验失败"));
        patchStep("openclaw", "done", installedStatus.version ?? undefined);
      } else {
        if (oclawStatus.path) {
          setInstallTarget({ tier: "existing", path: oclawStatus.path, version: oclawStatus.version ?? undefined });
        }
        patchStep("openclaw", "done", oclawStatus.version ?? undefined);
      }

      // The launcher can only be verified after a concrete OpenClaw binary
      // has been selected. This operation is idempotent on retries.
      patchStep("terminal", "running", t("setup.configuringTerminal", "正在配置终端命令…"));
      const terminalStatus = await applyTerminalIntegration();
      if (!isRunActive(runId)) return;
      if (!terminalStatus.requested) {
        patchStep("terminal", "skipped", t("setup.terminalIntegrationDisabled", "未启用外部终端集成"));
      } else if (!terminalStatus.enabled || !terminalStatus.launcherReady) {
        throw new Error(t("setup.terminalIntegrationFailed", "终端启动器未能完成配置"));
      } else {
        patchStep(
          "terminal",
          "done",
          terminalStatus.terminalRestartRequired
            ? t("setup.terminalRestartRequired", "已配置；打开新的终端窗口后生效")
            : t("setup.terminalIntegrationReady", "终端命令已就绪"),
        );
      }

      // Gateway — 准备阶段。前端 `setup-progress` 监听会把 Rust 端
      // 通过 `prepare_gateway` 流式上报的每一条 step="gateway" 文案
      // 原样展示到 statusMessage 上，与 install_* 的呈现形态完全一致。
      patchStep("gateway", "running", t("setup.preparingGateway"));
      replaceSetupStep("install-openclaw");
      reportPhase("gatewayPrepare", t("setup.preparingGateway"));
      let gatewayPrepareWarning: string | null = null;
      try {
        await prepareGateway();
      } catch (e) {
        // start_gateway performs its own validation, so this remains recoverable.
        // Keep the warning visible instead of claiming preparation succeeded.
        const message = e instanceof Error ? e.message : String(e);
        gatewayPrepareWarning = t("setup.gatewayPrepareWillRetry", {
          error: message,
          defaultValue: "Gateway 准备检查未完成：{{error}}。点击启动时将自动重试。",
        });
        appendSetupLog({ source: "setup", step: "gateway", message: gatewayPrepareWarning, level: "warn" });
        debugWarn('gateway', '[setup] prepare_gateway failed, continuing to start_gateway:', e);
      }
      if (!isRunActive(runId)) return;
      patchStep(
        "gateway",
        "pending",
        gatewayPrepareWarning ?? t("setup.installCompleteGatewayPending", "Gateway 配置已准备，点击启动 Gateway 继续。"),
      );
      reportPhase("awaitingGatewayStart", t("setup.installComplete", "必需组件已安装完成"));
      replaceSetupStep("install-complete");
    } catch (err: any) {
      if (!isRunActive(runId)) return;
      const msg = err?.message || String(err);
      failRunningStep(msg);
      setSetupError(msg);
      report(msg);
      replaceSetupStep("error");
    }
  }, [beginRun, isRunActive, replaceSetupStep, t, report, reportPhase, setNeedsGit, commitSteps,
      waitForGatewayReady, setGatewayRunning, setSetupError, clearSetupLogs, appendSetupLog]);

  const runDockerSetup = useCallback(async () => {
    const runId = beginRun();
    clearSetupLogs();
    commitSteps([...INITIAL_DOCKER_STEPS]);
    try {
      replaceSetupStep("checking");

      patchStep("pull", "running", t("setup.pullingImage"));
      report(t("setup.pullingImage"), 10);
      await pullOpenclawImage("latest");
      if (!isRunActive(runId)) return;
      patchStep("pull", "done");

      patchStep("container", "running", t("setup.startingContainer"));
      report(t("setup.startingContainer"), 50);
      const gatewayStatus = await gatewayManager.startDockerForSetup();
      if (!isRunActive(runId)) return;
      cacheGatewayTarget(gatewayStatus.port, gatewayStatus.token);
      patchStep("container", "done");

      patchStep("gateway", "running", t("setup.waitingGateway"));
      report(t("setup.waitingGateway"), 90);
      await waitForGatewayReady(runId, 30_000, gatewayStatus.port);
      if (!isRunActive(runId)) return;
      setGatewayRunning(true);
      patchStep("gateway", "done");
      setPostStorageStep(needsOnboarding ? "configure-openclaw" : "ready");

      if (needsOnboarding) {
        await startOfficialOnboarding();
      } else {
        report(t("setup.ready"), 100);
        replaceSetupStep("ready");
      }
    } catch (err: any) {
      if (!isRunActive(runId)) return;
      setGatewayRunning(false);
      const message = err?.message || String(err);
      failRunningStep(message);
      setSetupError(message);
      report(message);
      replaceSetupStep("error");
    }
  }, [beginRun, isRunActive, replaceSetupStep, t, report, commitSteps,
      waitForGatewayReady, setGatewayRunning, setPostStorageStep, setSetupError, clearSetupLogs, needsOnboarding, startOfficialOnboarding, appendSetupLog]);

  const selectMode = useCallback((mode: InstallMode) => {
    setInstallMode(mode);
    navigateSetup("checking", "push");
    if (mode === "native") {
      commitSteps([...INITIAL_NATIVE_STEPS]);
      void runNativeSetup();
    } else {
      commitSteps([...INITIAL_DOCKER_STEPS]);
      void runDockerSetup();
    }
  }, [setInstallMode, navigateSetup, runNativeSetup, runDockerSetup, commitSteps]);

  const retrySetup = useCallback(async () => {
    setSetupError(null);
    setNeedsGit(false);
    if (installMode === "docker") {
      await runDockerSetup();
    } else {
      await runNativeSetup();
    }
  }, [installMode, setSetupError, setNeedsGit, runDockerSetup, runNativeSetup]);

  const completeStorageSetup = useCallback((result?: { createdFresh: boolean }) => {
    const createdFresh = result?.createdFresh === true;
    if (createdFresh) setNeedsOnboarding(true);
    const nextStep = createdFresh && (postStorageStep === "ready" || postStorageStep === "configure-openclaw")
      ? "gateway-stopped"
      : postStorageStep;

    if (nextStep === "ready") {
      report(t("setup.ready"), 100);
    } else if (nextStep === "configure-openclaw") {
      report(t("setup.wizard.title", "配置 OpenClaw"), 82);
    } else if (nextStep === "gateway-stopped") {
      report(t("setup.gatewayNotRunning"), 30);
    } else {
      report(t("setup.chooseMode"), 30);
    }
    navigateSetup(nextStep, "push");
  }, [postStorageStep, report, navigateSetup, t]);

  const repairAndRetry = useCallback(async () => {
    if (repairing) return;
    const failure = setupError;
    const runId = beginRun();
    setRepairing(true);
    setSetupError(null);
    const analyzingMessage = t("setup.analyzingGatewayFailure", "正在分析 Gateway 启动失败并选择恢复方式…");
    patchStep("gateway", "running", analyzingMessage);
    report(analyzingMessage);
    appendSetupLog({ source: "setup", step: "gateway", message: analyzingMessage, level: "info" });
    try {
      const recommendation = failure
        ? await diagnoseGatewayRecovery(failure).catch(() => "repair" as const)
        : "repair";
      if (recommendation === "retry") {
        const retryDelay = gatewayMigrationRetryDelayMs(failure || "");
        if (retryDelay > 0) {
          const waitSeconds = Math.ceil(retryDelay / 1000);
          const message = t(
            "setup.waitingForGatewayLock",
            "检测到另一个 Gateway 的迁移锁，{{seconds}} 秒后自动重试…",
            { seconds: waitSeconds },
          );
          patchStep("gateway", "running", message);
          report(message);
          appendSetupLog({ source: "setup", step: "gateway", message, level: "info" });
          await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
          if (!isRunActive(runId)) return;
        }
        await startGatewayAction();
        return;
      }
      const repairingMessage = t("setup.repairingGateway", "正在修复 OpenClaw 和插件状态…");
      patchStep("gateway", "running", repairingMessage);
      report(repairingMessage);
      appendSetupLog({
        source: "setup",
        step: "gateway",
        message: t("setup.repairStarting", "开始运行 OpenClaw 官方修复流程…"),
        level: "info",
      });
      await runOpenClawRepair();
      if (!isRunActive(runId)) return;
      appendSetupLog({
        source: "setup",
        step: "gateway",
        message: t("setup.repairComplete", "修复完成，正在重新启动 Gateway…"),
        level: "info",
      });
      await startGatewayAction();
    } catch (error) {
      if (!isRunActive(runId)) return;
      const message = error instanceof Error ? error.message : String(error);
      patchStep("gateway", "error", message);
      appendSetupLog({ source: "setup", step: "gateway", message, level: "error" });
      setSetupError(message);
      report(message);
      replaceSetupStep("error");
    } finally {
      setRepairing(false);
    }
  }, [repairing, setupError, beginRun, isRunActive, setSetupError, patchStep, t, report, appendSetupLog, startGatewayAction, replaceSetupStep]);

  const goBack = useCallback(() => {
    void wizardClientRef.current?.cancel().catch(() => {});
    setWizardStep(null);
    setWizardError(null);
    cancelActiveRun();
    setSetupError(null);
    setNeedsGit(false);
    let destination = goBackSetup("welcome");
    while (isStaleSetupBackDestination(destination, gatewayRunning)) {
      destination = goBackSetup("welcome");
    }
    if (destination === "welcome" || destination === "choosing-mode") {
      commitSteps([]);
    }
    presentSetupStep(destination);
  }, [cancelActiveRun, setSetupError, setNeedsGit, goBackSetup, gatewayRunning, commitSteps, presentSetupStep]);

  const retryGit = useCallback(() => {
    setNeedsGit(false);
    setSetupError(null);
    runNativeSetup();
  }, [setNeedsGit, setSetupError, runNativeSetup]);

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
    if (gatewayRunning) {
      setPostStorageStep(needsOnboarding ? "configure-openclaw" : "ready");
    }
    const currentSteps = stepsRef.current;
    if (currentSteps.some((step) => step.id === "gateway")) {
      commitSteps(currentSteps.map((step) => step.id === "gateway"
        ? { ...step, status: gatewayRunning ? "done" : "pending" }
        : step));
    } else if (gatewayRunning) {
      commitSteps([{ id: "gateway", label: "Gateway", status: "done", progress: 100 }]);
    }
    return { status, gatewayRunning };
  }, [setGatewayRunning, setPostStorageStep, needsOnboarding, commitSteps]);

  return {
    progress, statusMessage, installMode, dockerStatus, openclawStatus, checkingDocker, needsGit, steps,
    installTarget,
    wizardStep,
    wizardSubmitting,
    wizardError,
    needsOnboarding,
    repairing,
    startGateway: startGatewayAction,
    retryGateway: startGatewayAction,
    repairAndRetry,
    submitWizardStep,
    retryWizard: startOfficialOnboarding,
    runNativeSetup,
    runDockerSetup,
    retrySetup,
    completeStorageSetup,
    selectMode,
    detectDocker,
    refreshRuntime,
    goBack,
    retryGit,
    enterWorkspace,
  };
}
