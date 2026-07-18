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
  checkSetupNode, checkGit, checkOpenclaw,
  installNode, repairSetupNodeRuntime, installGit, cancelDependencyInstall,
  installOpenclaw, reinstallOpenclaw, relocateOpenclaw,
  applyTerminalIntegration,
  prepareGateway,
  checkDocker, pullOpenclawImage, detectGatewayConfig, setActiveGatewayRuntime,
  commitActiveGatewayRuntime, rollbackActiveGatewayRuntime,
  commitRuntimeReconfiguration, rollbackRuntimeReconfiguration,
  type DockerStatus,
  type OpenclawStatus,
} from "@/api/tauri-commands";
import { debugWarn } from "@/utils/debugLog";
import { subscribeTauriEvent } from "@/utils/tauriEvents";
import {
  setupProgressI18nParams,
  translateSetupProgressMessage,
} from "./setupProgressParams";
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
import {
  disableOpenclawPlugin,
  healOpenclawPlugin,
  isAwaitingGatewayVerification,
  listBrokenGatewayPlugins,
  mergeBrokenPlugins,
  planPluginRecovery,
  pluginsNeedingHeal,
  unhealedPlugins,
  UNVERIFIABLE_PLUGIN_REASON,
  type BrokenGatewayPlugin,
  type PluginHealOutcome,
} from "@/services/gateway/pluginRecovery";
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

export type InstallTargetTier = "user" | "userMissingPath" | "custom" | "existing";

export interface InstallTarget {
  /**
   * Where the installer decided to put `openclaw`.
   *  - "user": same dir as the user's terminal `npm i -g` (their
   *    actual `npm config get prefix`) and its bin directory is on PATH.
   *  - "userMissingPath": same npm prefix as the user's terminal, but
   *    its bin directory is not currently on the login-shell PATH.
   *  - "custom": explicit global prefix selected during setup.
   *  - "existing": an `openclaw` install was already on disk before
   *    setup ran, so we skipped the install. The card surfaces the
   *    detected path and version.
   */
  tier: InstallTargetTier;
  path: string;
  /** Only set for the `existing` tier, when a version string was returned. */
  version?: string;
}

const INSTALL_TARGET_KEYS = {
  user: "setup.openclaw.userNpmPrefix",
  userMissingPath: "setup.openclaw.userNpmPrefixMissingPath",
  custom: "setup.openclaw.customNpmPrefix",
  existing: "setup.openclaw.useExisting",
} as const;

function pickInstallTargetFromProgress(
  key: string,
  message: string,
  explicitParams: Partial<Record<string, string>> = {},
): InstallTarget | null {
  if (
    key !== INSTALL_TARGET_KEYS.user &&
    key !== INSTALL_TARGET_KEYS.userMissingPath &&
    key !== INSTALL_TARGET_KEYS.custom &&
    key !== INSTALL_TARGET_KEYS.existing
  ) {
    return null;
  }
  // Reuse the same rule table that drives i18next substitution so
  // the UI path stays in lockstep with the message formatting.
  const params = { ...setupProgressI18nParams(key, message), ...explicitParams };
  if (!params.path) return null;
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
  nodeRequirement: string | null;
  steps: StepState[];
  installTarget: InstallTarget | null;
  wizardStep: OpenClawWizardStep | null;
  wizardSubmitting: boolean;
  wizardError: string | null;
  needsOnboarding: boolean;
  repairing: boolean;
  brokenPlugins: BrokenGatewayPlugin[];
  forceStorageSelection: boolean;
  startGateway: () => Promise<boolean>;
  retryGateway: () => Promise<boolean>;
  repairAndRetry: () => Promise<void>;
  disablePluginsAndRetry: () => Promise<void>;
  submitWizardStep: (stepId: string, value?: unknown) => Promise<void>;
  retryWizard: () => Promise<void>;
  runNativeSetup: () => Promise<boolean>;
  runDockerSetup: () => Promise<boolean>;
  retrySetup: () => Promise<boolean>;
  requestReinstall: () => void;
  completeStorageSetup: (result?: {
    createdFresh: boolean;
    runtimeReconfigurationRequired?: boolean;
    openclawRelocationRequired?: boolean;
  }) => void;
  selectMode: (mode: InstallMode) => Promise<void>;
  detectDocker: () => Promise<void>;
  refreshRuntime: () => Promise<{ status: OpenclawStatus | null; gatewayRunning: boolean }>;
  goBack: () => Promise<void>;
  retryGit: () => void;
  retryNode: () => void;
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
  { id: "terminal",  label: "Terminal",      status: "pending" },
  { id: "gateway",   label: "Gateway",       status: "pending" },
];

function cacheGatewayTarget(port?: number | null, token?: string | null): void {
  if (!port && token === undefined) return;
  try {
    const current = JSON.parse(localStorage.getItem("aegis-config") || "{}");
    const next = {
      ...current,
      ...(port ? { gatewayUrl: defaultGatewayWsUrl(port) } : {}),
    };
    if (token === null) {
      delete next.gatewayToken;
    } else if (token) {
      next.gatewayToken = token;
    }
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
  const [brokenPlugins, setBrokenPlugins] = useState<BrokenGatewayPlugin[]>([]);
  const [forceStorageSelection, setForceStorageSelection] = useState(false);
  // gateway-smoke-check 类发现无法离线验证修复效果：自愈梯子跑完后先用一次
  // 真实 Gateway 启动做验证；此处记录已验证过的插件，二次失败直达禁用降级，
  // 避免"虚假修复→重启→再失败"的死循环。Gateway 成功就绪时清空。
  const pluginHealAttemptedRef = useRef<Set<string>>(new Set());
  const [nodeRequirement, setNodeRequirement] = useState<string | null>(null);
  const reinstallRequestedRef = useRef(false);
  const relocationRequestedRef = useRef(false);
  const needsOnboardingRef = useRef(needsOnboarding);
  needsOnboardingRef.current = needsOnboarding;
  const updateOnboardingRequirement = useCallback((required: boolean) => {
    needsOnboardingRef.current = required;
    setNeedsOnboarding(required);
  }, []);
  const wizardClientRef = useRef<OpenClawWizardClient | null>(null);
  if (!wizardClientRef.current) {
    wizardClientRef.current = new OpenClawWizardClient((method, params) => gateway.call(method, params));
  }
  useEffect(() => () => {
    void wizardClientRef.current?.cancel().catch(() => {});
  }, []);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const commitSteps = useCallback((next: StepState[]) => {
    stepsRef.current = next;
    setSteps(next);
  }, [setSteps]);
  const activeRunRef = useRef(0);
  const dependencyInstallScopeRef = useRef(
    `setup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );
  const activeDependencyOperationRef = useRef<string | null>(null);
  const requestDependencyCancellation = useCallback((operationId: string) => {
    void cancelDependencyInstall(operationId).catch((error) => {
      debugWarn("app", "[setup] dependency installer cancellation request failed:", error);
    });
  }, []);
  const cancelActiveRun = useCallback(() => {
    const operationId = activeDependencyOperationRef.current;
    activeDependencyOperationRef.current = null;
    activeRunRef.current += 1;
    if (operationId) requestDependencyCancellation(operationId);
  }, [requestDependencyCancellation]);
  const beginRun = useCallback(() => {
    cancelActiveRun();
    setInstallTarget(null);
    setNodeRequirement(null);
    return activeRunRef.current;
  }, [cancelActiveRun, setInstallTarget]);
  const isRunActive = useCallback((runId: number) => activeRunRef.current === runId, []);
  const runDependencyInstall = useCallback(async <T,>(
    runId: number,
    tool: "git" | "node",
    install: (operationId: string) => Promise<T>,
  ): Promise<T> => {
    if (!isRunActive(runId)) throw new Error("setup cancelled");
    const operationId = `${dependencyInstallScopeRef.current}:${runId}:${tool}`;
    activeDependencyOperationRef.current = operationId;
    try {
      return await install(operationId);
    } finally {
      if (activeDependencyOperationRef.current === operationId) {
        activeDependencyOperationRef.current = null;
      }
    }
  }, [isRunActive]);
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
          const reachable: boolean = await invoke("probe_selected_gateway", { port });
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

  const resolveActiveRuntimeOnboardingRequirement = useCallback(async (): Promise<boolean> => {
    try {
      const detected = await window.aegis.config.detect();
      const loaded = await window.aegis.config.read(detected.path);
      return requiresOpenClawOnboarding(detected.exists, loaded.data);
    } catch {
      // A missing or unreadable selected-runtime config must stay in the
      // official onboarding path instead of allowing an unconfigured workspace.
      return true;
    }
  }, []);

  // ── 挂载后自动检测 ──
  // 先读取后端持久化的运行时选择；只有 Native 才检查宿主机 OpenClaw。
  // 然后 probe_gateway_port（Rust 侧从选定配置读取实际端口）。检测只能推进向导步骤，不能写入
  // “已完成”标记；该标记必须由用户点击“进入工作台”后写入。
  useEffect(() => {
    if (setupStep !== "detecting") return;
    let cancelled = false;
    void (async () => {
      report(t("setup.detecting"), 0);
      setGatewayRunning(false);
      try {
        const runtimeTarget = await detectGatewayConfig();
        if (cancelled) return;
        const selectedRuntime = runtimeTarget.runtime_mode;
        setInstallMode(selectedRuntime);
        cacheGatewayTarget(runtimeTarget.port, runtimeTarget.token);

        // A Docker runtime is self-contained. Its host may intentionally have
        // no OpenClaw package, so checking it would produce a false "fresh
        // install" result and route the next action to Native.
        const oclaw = selectedRuntime === "native" ? await checkOpenclaw() : null;
        if (cancelled) return;
        setOpenclawStatus(oclaw);
        if (selectedRuntime === "native" && (!oclaw?.installed || oclaw.relocation_required)) {
          relocationRequestedRef.current = Boolean(oclaw?.relocation_required);
          // 从未安装过，先确定存储位置，再进入安装方式选择。
          localStorage.removeItem("junqi-setup-done");
          setPostStorageStep("choosing-mode");
          report(t("storage.title", "选择 OpenClaw 数据位置"), 24);
          navigateSetup("storage", "replace");
          return;
        }
        const onboardingRequired = await resolveActiveRuntimeOnboardingRequirement();
        if (cancelled) return;
        updateOnboardingRequirement(onboardingRequired);
        if (oclaw?.path) {
          setInstallTarget({ tier: "existing", path: oclaw.path, version: oclaw.version ?? undefined });
        }
        // 选定运行时已满足探测条件，继续检查 Gateway 是否已监听。这里不直接
        // 进入工作台，避免用户在向导中前后切换时被跳过确认步骤。
        try {
          // 不传端口时由 Rust 读取配置；读取失败时使用共享运行时默认值。
          const reachable: boolean = await invoke("probe_selected_gateway", {});
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
  }, [setupStep, report, t, setGatewayRunning, setPostStorageStep, navigateSetup, commitSteps, resolveActiveRuntimeOnboardingRequirement, updateOnboardingRequirement, setInstallMode]);

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
        const { step, message, progress: localProgress, error, key, params, status } = normalized;
        if (!step) {
          report(message);
          return;
        }
        // Prefer i18n-resolved text; fall back to the raw Rust message.
        const display = translateSetupProgressMessage(
          key,
          message,
          (translationKey, options) => t(translationKey, options),
          params,
        );
        // Capture the resolved install target so the UI can surface
        // a dedicated "Install location" card. Reuses the same rule
        // table that drives i18next substitution, so the displayed
        // path is byte-identical to what's in the progress message.
        const resolvedTarget = pickInstallTargetFromProgress(String(key ?? ""), message, params);
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
          const eventStepStatus: StepStatus = status === "completed"
            ? "done"
            : status === "failed" || error
              ? "error"
              : "running";
          const newSteps = stepsRef.current.map((s) =>
            s.id === sid
              ? {
                  ...s,
                  status: eventStepStatus,
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

  async function configureTerminalIntegration(runId: number): Promise<void> {
    patchStep("terminal", "running", t("setup.configuringTerminal", "正在配置终端命令…"));
    const terminalStatus = await applyTerminalIntegration();
    if (!isRunActive(runId)) return;
    if (!terminalStatus.requested) {
      patchStep("terminal", "skipped", t("setup.terminalIntegrationDisabled", "未启用外部终端集成"));
      return;
    }
    if (!terminalStatus.enabled || !terminalStatus.launcherReady) {
      throw new Error(t("setup.terminalIntegrationFailed", "终端启动器未能完成配置"));
    }
    patchStep(
      "terminal",
      "done",
      terminalStatus.terminalRestartRequired
        ? t("setup.terminalRestartRequired", "已配置；打开新的终端窗口后生效")
        : t("setup.terminalIntegrationReady", "终端命令已就绪"),
    );
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
      const target = await detectGatewayConfig();
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
      // OpenClaw's official wizard may install its platform service by
      // default. Reconcile ownership before declaring setup complete so the
      // foreground bootstrap child and Scheduled Task never race on one port.
      await invoke<boolean>("handoff_gateway_to_official_service", {});
      setWizardStep(null);
      updateOnboardingRequirement(false);
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
  }, [refreshGatewayConnectionTarget, report, setPostStorageStep, replaceSetupStep, t, updateOnboardingRequirement]);

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
  const startGatewayAction = useCallback(async (
    requestedMode?: InstallMode,
    existingRunId?: number,
  ): Promise<boolean> => {
    const runId = existingRunId ?? beginRun();
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
      const isDockerRuntime = (requestedMode ?? installMode) === "docker";
      const status: any = isDockerRuntime
        ? await gatewayManager.startDockerForSetup()
        : await gatewayManager.startForSetup();
      cacheGatewayTarget(status?.port, status?.token);
      patchStep("gateway", "running", t("setup.gatewayConnecting", "Gateway 已就绪，正在建立连接…"));
      reportPhase("gatewayPort", t("setup.gatewayConnecting", "Gateway 已就绪，正在建立连接…"));
      await waitForGatewayReady(runId, isDockerRuntime ? 30_000 : 10_000, status?.port);
      if (!isRunActive(runId)) return false;
      setGatewayRunning(true);
      // Gateway 已真实就绪：此前的插件启动验证记录随之失效。
      pluginHealAttemptedRef.current.clear();
      setPostStorageStep(needsOnboardingRef.current ? "configure-openclaw" : "ready");
      if (stepsRef.current.some((s) => s.id === "gateway")) {
        patchStep("gateway", "done");
      } else {
        commitSteps([{ id: "gateway", label: "Gateway", status: "done", progress: 100 }]);
      }
      reportPhase("ready", t("setup.gatewayConnected", "Gateway 已连接"));
      if (!isRunActive(runId)) return false;
      if (needsOnboardingRef.current) {
        await startOfficialOnboarding();
      } else {
        await new Promise((r) => setTimeout(r, 600));
        if (!isRunActive(runId)) return false;
        replaceSetupStep("ready");
      }
      return true;
    } catch (e: any) {
      if (!isRunActive(runId)) return false;
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
      return false;
    }
  }, [beginRun, isRunActive, setupStep, navigateSetup, replaceSetupStep, report, reportPhase, t, commitSteps, waitForGatewayReady, setGatewayRunning, setPostStorageStep, setSetupError, startOfficialOnboarding, appendSetupLog, installMode]);

  const runNativeSetup = useCallback(async (existingRunId?: number): Promise<boolean> => {
    const runId = existingRunId ?? beginRun();
    clearSetupLogs();
    const s = [...INITIAL_NATIVE_STEPS];
    commitSteps(s);
    try {
      replaceSetupStep("checking");

      // Git
      patchStep("git", "running", t("setup.checkingGit"));
      reportPhase("git", t("setup.checkingGit"));
      const gitStatus = await checkGit();
      if (!isRunActive(runId)) return false;
      if (!gitStatus.available) {
        const isWindows = navigator.userAgent.toLowerCase().includes("windows");
        const isMac = window.aegis?.platform === "darwin";
        if (!isWindows && !isMac) {
          patchStep("git", "error", t("setup.gitRequiredDesc"));
          setNeedsGit(true);
          replaceSetupStep("git-missing");
          reportPhase("git", t("setup.gitRequiredDesc"), 100);
          return false;
        }
        patchStep("git", "running", t("setup.installingGit", "正在静默安装 Git…"));
        replaceSetupStep("install-git");
        await runDependencyInstall(runId, "git", installGit);
        if (!isRunActive(runId)) return false;
        const installedGit = await checkGit();
        if (!isRunActive(runId)) return false;
        if (!installedGit.available) {
          patchStep("git", "error", t("setup.gitRequiredDesc"));
          setNeedsGit(true);
          replaceSetupStep("git-missing");
          reportPhase("git", t("setup.gitRequiredDesc"), 100);
          return false;
        }
        patchStep("git", "done", installedGit.version ?? undefined);
      } else {
        patchStep("git", "done", gitStatus.version ?? undefined);
      }

      // Node
      patchStep("node", "running", t("setup.checkingNode"));
      reportPhase("node", t("setup.checkingNode"));
      let setupNode = await checkSetupNode();
      let nodeStatus = setupNode.node;
      setNodeRequirement(setupNode.requirement);
      if (!isRunActive(runId)) return false;
      if (!nodeStatus.available) {
        patchStep("node", "running", t("setup.installingNode"));
        replaceSetupStep("install-node");
        reportPhase("node", t("setup.installingNode"), 20);
        await runDependencyInstall(runId, "node", (operationId) => installNode(false, operationId));
        if (!isRunActive(runId)) return false;
        setupNode = await checkSetupNode();
        const installedNode = setupNode.node;
        nodeStatus = installedNode;
        setNodeRequirement(setupNode.requirement);
        if (!installedNode.available) throw new Error(t("setup.nodeInstallFailed", "Node.js 安装后校验失败"));
        patchStep("node", "done", installedNode.version ?? undefined);
      } else {
        patchStep("node", "done", nodeStatus.version ?? undefined);
      }

      // npm is verified through the exact Node.js runtime selected above. A
      // repair preserves that contract: portable runtimes must be JunQi-owned,
      // while a requested system repair installs a verified system runtime
      // rather than mixing in an unrelated PATH npm shim.
      patchStep("npm", "running", t("setup.checkingNpm", "正在检查 npm 版本…"));
      let npmStatus = setupNode.npm;
      if (nodeStatus.available && !npmStatus.available) {
        patchStep("node", "running", t("setup.repairingNodeRuntime", "正在修复所选 Node.js 运行时…"));
        patchStep("npm", "running", t("setup.repairingNodeRuntime", "正在修复所选 Node.js 运行时…"));
        replaceSetupStep("install-node");
        reportPhase("node", t("setup.repairingNodeRuntime", "正在修复所选 Node.js 运行时…"), 20);
        await runDependencyInstall(runId, "node", repairSetupNodeRuntime);
        if (!isRunActive(runId)) return false;
        setupNode = await checkSetupNode();
        nodeStatus = setupNode.node;
        npmStatus = setupNode.npm;
        setNodeRequirement(setupNode.requirement);
        if (!nodeStatus.available) {
          throw new Error(t("setup.nodeInstallFailed", "Node.js 安装后校验失败"));
        }
        patchStep("node", "done", nodeStatus.version ?? undefined);
      }
      if (!npmStatus.available) {
        const npmError = npmStatus.reason
          ?? t("setup.npmInstallFailed", "所选 Node.js 未提供可用 npm");
        patchStep("npm", "error", npmError);
        throw new Error(npmError);
      }
      patchStep("npm", "done", npmStatus.version ?? undefined);

      // OpenClaw
      patchStep("openclaw", "running", t("setup.checkingOpenclaw"));
      reportPhase("openclaw", t("setup.checkingOpenclaw"));
      const oclawStatus = await checkOpenclaw();
      setOpenclawStatus(oclawStatus);
      if (!isRunActive(runId)) return false;
      const repairInvalidInstall = oclawStatus.binary_found && (
        !oclawStatus.version_ok
        || !oclawStatus.package_valid
        || !oclawStatus.gateway_command_ok
      );
      const forceReinstall = reinstallRequestedRef.current || repairInvalidInstall;
      const forceRelocation = relocationRequestedRef.current || oclawStatus.relocation_required;
      if (!oclawStatus.installed || forceReinstall || forceRelocation) {
        if (!oclawStatus.installed) updateOnboardingRequirement(true);
        patchStep("openclaw", "running", t("setup.installingOpenclaw"));
        replaceSetupStep("install-openclaw");
        reportPhase("openclaw", t("setup.installingOpenclaw"), 10);
        if (forceRelocation) {
          await relocateOpenclaw();
        } else if (forceReinstall) {
          await reinstallOpenclaw();
        } else {
          await installOpenclaw();
        }
        if (!isRunActive(runId)) return false;
        const installedStatus = await checkOpenclaw();
        setOpenclawStatus(installedStatus);
        if (!isRunActive(runId)) return false;
        if (!installedStatus.installed) throw new Error(installedStatus.error || t("setup.openclawInstallFailed", "OpenClaw 安装后校验失败"));
        reinstallRequestedRef.current = false;
        relocationRequestedRef.current = false;
        patchStep("openclaw", "done", installedStatus.version ?? undefined);
      } else {
        if (oclawStatus.path) {
          setInstallTarget({ tier: "existing", path: oclawStatus.path, version: oclawStatus.version ?? undefined });
        }
        patchStep("openclaw", "done", oclawStatus.version ?? undefined);
      }

      // The launcher is generated only after the selected runtime is ready.
      // This is shared by Native and Docker so their terminal contracts stay
      // aligned while keeping their launch mechanisms separate.
      await configureTerminalIntegration(runId);
      if (!isRunActive(runId)) return false;

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
      if (!isRunActive(runId)) return false;
      patchStep(
        "gateway",
        "running",
        gatewayPrepareWarning ?? t("setup.preparingGateway"),
      );
      // The official visual wizard is served by a healthy local Gateway. For a
      // fresh install, start this bootstrap runtime immediately. Preparation is
      // diagnostic only: startGatewayAction owns the authoritative validation
      // and recovery path, so a probe warning must not strand onboarding.
      return await startGatewayAction("native", runId);
    } catch (err: any) {
      if (!isRunActive(runId)) return false;
      const msg = err?.message || String(err);
      failRunningStep(msg);
      setSetupError(msg);
      report(msg);
      replaceSetupStep("error");
      return false;
    }
  }, [beginRun, isRunActive, replaceSetupStep, t, report, reportPhase, setNeedsGit, commitSteps,
      waitForGatewayReady, setGatewayRunning, setSetupError, clearSetupLogs, appendSetupLog, updateOnboardingRequirement, startGatewayAction, runDependencyInstall]);

  const runDockerSetup = useCallback(async (existingRunId?: number): Promise<boolean> => {
    const runId = existingRunId ?? beginRun();
    clearSetupLogs();
    commitSteps([...INITIAL_DOCKER_STEPS]);
    try {
      replaceSetupStep("checking");

      patchStep("pull", "running", t("setup.pullingImage"));
      report(t("setup.pullingImage"), 10);
      await pullOpenclawImage("latest");
      if (!isRunActive(runId)) return false;
      patchStep("pull", "done");

      patchStep("container", "running", t("setup.startingContainer"));
      report(t("setup.startingContainer"), 50);
      const gatewayStatus = await gatewayManager.startDockerForSetup();
      if (!isRunActive(runId)) return false;
      cacheGatewayTarget(gatewayStatus.port, gatewayStatus.token);
      patchStep("container", "done");

      // Storage setup may have created a Native launcher before the user chose
      // Docker. Refresh it now that the container is ready so `openclaw` in an
      // external terminal delegates to this selected runtime instead.
      await configureTerminalIntegration(runId);
      if (!isRunActive(runId)) return false;

      patchStep("gateway", "running", t("setup.waitingGateway"));
      report(t("setup.waitingGateway"), 90);
      await waitForGatewayReady(runId, 30_000, gatewayStatus.port);
      if (!isRunActive(runId)) return false;
      setGatewayRunning(true);
      patchStep("gateway", "done");
      setPostStorageStep(needsOnboardingRef.current ? "configure-openclaw" : "ready");

      if (needsOnboardingRef.current) {
        await startOfficialOnboarding();
      } else {
        report(t("setup.ready"), 100);
        replaceSetupStep("ready");
      }
      return true;
    } catch (err: any) {
      if (!isRunActive(runId)) return false;
      setGatewayRunning(false);
      const message = err?.message || String(err);
      failRunningStep(message);
      setSetupError(message);
      report(message);
      replaceSetupStep("error");
      return false;
    }
  }, [beginRun, isRunActive, replaceSetupStep, t, report, commitSteps,
      waitForGatewayReady, setGatewayRunning, setPostStorageStep, setSetupError, clearSetupLogs, startOfficialOnboarding, appendSetupLog]);

  const selectMode = useCallback(async (mode: InstallMode) => {
    const runId = beginRun();
    setSetupError(null);
    const previousMode = installMode;
    const switchedMode = mode !== previousMode;
    try {
      // A pending location change is a Native runtime contract. Selecting
      // Docker means that contract will not be exercised, so compensate it
      // before Docker can become the active runtime.
      if (mode === "docker") {
        const restoredNativeLocations = await rollbackRuntimeReconfiguration();
        if (!isRunActive(runId)) return;
        if (restoredNativeLocations) {
          appendSetupLog({
            source: "setup",
            step: "gateway",
            message: "Discarded the pending Native runtime location change before selecting Docker",
            level: "warn",
          });
        }
      }
      if (!isRunActive(runId)) return;
      await setActiveGatewayRuntime(mode);
      if (!isRunActive(runId)) return;
      setInstallMode(mode);
      const onboardingRequired = await resolveActiveRuntimeOnboardingRequirement();
      if (!isRunActive(runId)) return;
      updateOnboardingRequirement(onboardingRequired);
    } catch (error) {
      if (!isRunActive(runId)) return;
      const message = error instanceof Error ? error.message : String(error);
      appendSetupLog({ source: "setup", step: "gateway", message, level: "error" });
      setSetupError(message);
      report(message);
      replaceSetupStep("error");
      return;
    }
    if (!isRunActive(runId)) return;
    navigateSetup("checking", "push");
    let completed: boolean;
    if (mode === "native") {
      commitSteps([...INITIAL_NATIVE_STEPS]);
      completed = await runNativeSetup(runId);
    } else {
      reinstallRequestedRef.current = false;
      commitSteps([...INITIAL_DOCKER_STEPS]);
      completed = await runDockerSetup(runId);
    }
    if (!isRunActive(runId)) return;
    if (completed) {
      try {
        await commitActiveGatewayRuntime(mode);
        if (!isRunActive(runId)) return;
        await commitRuntimeReconfiguration();
        if (!isRunActive(runId)) return;
        return;
      } catch (commitError) {
        if (!isRunActive(runId)) return;
        const message = commitError instanceof Error ? commitError.message : String(commitError);
        appendSetupLog({ source: "setup", step: "gateway", message, level: "error" });
        setSetupError(message);
        report(message);
      }
    }
    if (!isRunActive(runId)) return;

    // Runtime selection is a transaction from the user's perspective. The
    // backend persists the target before setup can prepare its dependencies,
    // so a failed/cancelled attempt must restore the previous selection before
    // the next app launch interprets the bootstrap file.
    try {
      const restoredRuntimeLocations = await rollbackRuntimeReconfiguration();
      if (!isRunActive(runId)) return;
      if (switchedMode && !restoredRuntimeLocations) {
        await rollbackActiveGatewayRuntime(mode);
        if (!isRunActive(runId)) return;
      }
      setInstallMode(previousMode);
      const onboardingRequired = await resolveActiveRuntimeOnboardingRequirement();
      if (!isRunActive(runId)) return;
      updateOnboardingRequirement(onboardingRequired);
      if (switchedMode && !restoredRuntimeLocations) {
        try {
          if (previousMode === "native") {
            await gatewayManager.startForSetup();
          } else {
            await gatewayManager.startDockerForSetup();
          }
          if (!isRunActive(runId)) return;
        } catch (restoreError) {
          if (!isRunActive(runId)) return;
          appendSetupLog({
            source: "setup",
            step: "gateway",
            message: `Previous ${previousMode} Gateway could not be restored: ${String(restoreError)}`,
            level: "error",
          });
        }
      }
      if (!isRunActive(runId)) return;
      appendSetupLog({
        source: "setup",
        step: "gateway",
        message: `Runtime switch to ${mode} failed; restored ${previousMode}`,
        level: "warn",
      });
      report(t("setup.runtimeSwitchRolledBack", "运行时切换失败，已恢复之前的运行模式"));
    } catch (rollbackError) {
      if (!isRunActive(runId)) return;
      const message = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      appendSetupLog({ source: "setup", step: "gateway", message, level: "error" });
      setSetupError(message);
      report(message);
      replaceSetupStep("error");
    }
  }, [beginRun, isRunActive, installMode, setInstallMode, setSetupError, appendSetupLog, report, replaceSetupStep, navigateSetup, runNativeSetup, runDockerSetup, commitSteps, updateOnboardingRequirement, resolveActiveRuntimeOnboardingRequirement, setActiveGatewayRuntime, commitActiveGatewayRuntime, rollbackActiveGatewayRuntime, commitRuntimeReconfiguration, rollbackRuntimeReconfiguration, gatewayManager, t]);

  const requestReinstall = useCallback(() => {
    reinstallRequestedRef.current = true;
    setSetupError(null);
    navigateSetup("choosing-mode", "push");
  }, [setSetupError, navigateSetup]);

  const retrySetup = useCallback(async (): Promise<boolean> => {
    setSetupError(null);
    setNeedsGit(false);
    if (installMode === "docker") {
      return await runDockerSetup();
    } else {
      return await runNativeSetup();
    }
  }, [installMode, setSetupError, setNeedsGit, runDockerSetup, runNativeSetup]);

  const completeStorageSetup = useCallback((result?: {
    createdFresh: boolean;
    runtimeReconfigurationRequired?: boolean;
    openclawRelocationRequired?: boolean;
  }) => {
    setForceStorageSelection(false);
    const createdFresh = result?.createdFresh === true;
    const runtimeReconfigurationRequired = result?.runtimeReconfigurationRequired === true;
    relocationRequestedRef.current = result?.openclawRelocationRequired === true;
    if (createdFresh) updateOnboardingRequirement(true);

    // An existing Native OpenClaw install still relies on host Git, Node.js,
    // and npm. Route it through the same preflight/install closure as a fresh
    // Native setup instead of skipping directly to Gateway startup.
    if (
      installMode === "native"
      && openclawStatus?.installed
      && !runtimeReconfigurationRequired
      && !relocationRequestedRef.current
    ) {
      navigateSetup("checking", "push");
      void runNativeSetup();
      return;
    }

    const nextStep = runtimeReconfigurationRequired
      ? "choosing-mode"
      : createdFresh && (postStorageStep === "ready" || postStorageStep === "configure-openclaw")
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
    if (nextStep === "gateway-stopped" && needsOnboardingRef.current) {
      // Existing installations without a usable model configuration follow
      // the same bootstrap-to-wizard path as fresh installs.
      void startGatewayAction();
    }
  }, [
    installMode,
    openclawStatus?.installed,
    postStorageStep,
    report,
    navigateSetup,
    t,
    updateOnboardingRequirement,
    runNativeSetup,
    startGatewayAction,
    setForceStorageSelection,
  ]);

  const repairAndRetry = useCallback(async () => {
    if (repairing) return;
    const failure = setupError;
    const runId = beginRun();
    setRepairing(true);
    setSetupError(null);
    setBrokenPlugins([]);
    const analyzingMessage = t("setup.analyzingGatewayFailure", "正在分析 Gateway 启动失败并选择恢复方式…");
    patchStep("gateway", "running", analyzingMessage);
    report(analyzingMessage);
    appendSetupLog({ source: "setup", step: "gateway", message: analyzingMessage, level: "info" });
    try {
      const recommendation = failure
        ? await diagnoseGatewayRecovery(failure).catch(() => "repair" as const)
        : "repair";
      if (recommendation === "select_storage") {
        const message = t(
          "setup.stateDirectoryIncompatible",
          "当前 OpenClaw 数据目录不支持所需权限操作。请选择本机支持权限操作的数据目录后重试。",
        );
        setForceStorageSelection(true);
        setGatewayRunning(false);
        setPostStorageStep("choosing-mode");
        appendSetupLog({ source: "setup", step: "gateway", message, level: "error" });
        report(message);
        replaceSetupStep("storage");
        return;
      }
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
      // BUG-CPI-07: Gateway 拒绝启动常由单个损坏插件引起（payload 烟测失败）。
      // 先做结构化插件巡检并尝试自愈梯子（定向更新 → 强制重装，每级复检）；
      // 不可自愈时给用户"临时禁用并启动"的降级出口，避免陷入修复→失败死循环。
      // Docker 运行时的插件载荷在容器内，由镜像刷新修复路径覆盖，巡检返回空。
      const broken = await listBrokenGatewayPlugins(failure ?? undefined)
        .catch(() => [] as BrokenGatewayPlugin[]);
      if (!isRunActive(runId)) return;
      if (broken.length > 0) {
        const showDisableFallback = (plugins: BrokenGatewayPlugin[]) => {
          setBrokenPlugins(plugins);
          const blockedMessage = t("setup.pluginNotHealable", {
            plugins: plugins.map((plugin) => plugin.id).join(", "),
            defaultValue: "插件 {{plugins}} 无法自动修复，可能是其安装包缺少必需文件。可临时禁用后继续启动。",
          });
          patchStep("gateway", "error", blockedMessage);
          appendSetupLog({ source: "setup", step: "gateway", message: blockedMessage, level: "error" });
          setSetupError(blockedMessage);
          report(blockedMessage);
          replaceSetupStep("error");
        };
        const candidates = pluginsNeedingHeal(broken, pluginHealAttemptedRef.current);
        if (candidates.length === 0) {
          showDisableFallback(broken);
          return;
        }
        const healingMessage = t("setup.pluginHealing", {
          plugins: candidates.map((plugin) => plugin.id).join(", "),
          defaultValue: "检测到损坏的插件（{{plugins}}），正在尝试自动修复…",
        });
        patchStep("gateway", "running", healingMessage);
        report(healingMessage);
        appendSetupLog({ source: "setup", step: "gateway", message: healingMessage, level: "info" });
        const outcomes: PluginHealOutcome[] = [];
        for (const plugin of candidates) {
          const outcome = await healOpenclawPlugin(plugin.id, plugin.reason).catch((error): PluginHealOutcome => ({
            id: plugin.id,
            healed: false,
            attempted: [],
            error: error instanceof Error ? error.message : String(error),
          }));
          if (!isRunActive(runId)) return;
          appendSetupLog({
            source: "setup",
            step: "gateway",
            message: outcome.healed
              ? t("setup.pluginHealed", { plugin: outcome.id, defaultValue: "插件 {{plugin}} 已修复" })
              : isAwaitingGatewayVerification(plugin, outcome)
                ? t("setup.pluginHealAwaitingStartCheck", {
                    plugin: outcome.id,
                    defaultValue: "插件 {{plugin}} 已完成修复尝试，等待 Gateway 启动验证",
                  })
                : t("setup.pluginHealFailed", {
                    plugin: outcome.id,
                    error: outcome.error ?? "",
                    defaultValue: "插件 {{plugin}} 无法自动修复 {{error}}",
                  }),
            level: outcome.healed || isAwaitingGatewayVerification(plugin, outcome) ? "info" : "warn",
          });
          outcomes.push(outcome);
        }
        const alreadyStartVerified = broken.filter(
          (plugin) => plugin.reason === UNVERIFIABLE_PLUGIN_REASON
            && pluginHealAttemptedRef.current.has(plugin.id),
        );
        const remaining = mergeBrokenPlugins(
          alreadyStartVerified,
          unhealedPlugins(candidates, outcomes),
        );
        // healed 的语义是"已验证修复"。gateway-smoke-check 类发现只有 Gateway
        // 自己的烟测能观测，自愈梯子永远不会为其报告 healed；此处用一次真实
        // 启动做验证（结果由下一轮 repairAndRetry 的 attempted 记录判定）。
        const recoveryPlan = planPluginRecovery(remaining, pluginHealAttemptedRef.current);
        if (recoveryPlan.action === "start-gateway") {
          if (recoveryPlan.startVerification.length > 0) {
            recoveryPlan.startVerification.forEach((plugin) => pluginHealAttemptedRef.current.add(plugin.id));
            appendSetupLog({
              source: "setup",
              step: "gateway",
              message: t("setup.pluginUnverifiedStartCheck", {
                plugins: recoveryPlan.startVerification.map((plugin) => plugin.id).join(", "),
                defaultValue: "插件 {{plugins}} 的修复效果无法离线验证，正在启动 Gateway 进行验证…",
              }),
              level: "info",
            });
          }
          await startGatewayAction();
          return;
        }
        // 已验证不可自愈（上游安装包缺文件等）：交给用户决定是否临时禁用。
        showDisableFallback(remaining);
        return;
      }
      if (installMode === "docker") {
        const repairingMessage = t(
          "setup.repairingDocker",
          "正在刷新 Docker 镜像并重建 Gateway…",
        );
        patchStep("gateway", "running", repairingMessage);
        report(repairingMessage);
        appendSetupLog({
          source: "setup",
          step: "gateway",
          message: t("setup.dockerRepairStarting", "正在刷新选定的 Docker 镜像…"),
          level: "info",
        });
        await pullOpenclawImage("latest");
        if (!isRunActive(runId)) return;
        appendSetupLog({
          source: "setup",
          step: "gateway",
          message: t("setup.dockerRepairComplete", "镜像已刷新，正在重新创建 Docker Gateway…"),
          level: "info",
        });
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
      await startGatewayAction("native");
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
  }, [repairing, setupError, beginRun, isRunActive, setSetupError, patchStep, t, report, appendSetupLog, startGatewayAction, replaceSetupStep, installMode, setGatewayRunning, setPostStorageStep]);

  // BUG-CPI-07 最后一级降级：临时禁用不可自愈的插件后继续启动。插件保持
  // 已安装状态，待其修复版本发布后可在设置中重新启用并重走自愈梯子。
  const disablePluginsAndRetry = useCallback(async () => {
    if (repairing) return;
    const plugins = brokenPlugins;
    if (plugins.length === 0) return;
    const runId = beginRun();
    setRepairing(true);
    setSetupError(null);
    try {
      for (const plugin of plugins) {
        const disablingMessage = t("setup.pluginDisabling", {
          plugin: plugin.id,
          defaultValue: "正在临时禁用插件 {{plugin}}…",
        });
        patchStep("gateway", "running", disablingMessage);
        report(disablingMessage);
        await disableOpenclawPlugin(plugin.id);
        if (!isRunActive(runId)) return;
        appendSetupLog({
          source: "setup",
          step: "gateway",
          message: t("setup.pluginDisabled", {
            plugin: plugin.id,
            defaultValue: "插件 {{plugin}} 已临时禁用；其修复版本发布后可在设置中重新启用",
          }),
          level: "warn",
        });
      }
      setBrokenPlugins([]);
      pluginHealAttemptedRef.current.clear();
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
  }, [repairing, brokenPlugins, beginRun, isRunActive, setSetupError, patchStep, t, report, appendSetupLog, startGatewayAction, replaceSetupStep]);

  const goBack = useCallback(async () => {
    void wizardClientRef.current?.cancel().catch(() => {});
    setWizardStep(null);
    setWizardError(null);
    cancelActiveRun();
    try {
      await rollbackRuntimeReconfiguration();
    } catch (rollbackError) {
      const message = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      appendSetupLog({ source: "setup", step: "gateway", message, level: "error" });
      setSetupError(message);
      report(message);
      replaceSetupStep("error");
      return;
    }
    setSetupError(null);
    setNeedsGit(false);
    setNodeRequirement(null);
    setBrokenPlugins([]);
    pluginHealAttemptedRef.current.clear();
    let destination = goBackSetup("welcome");
    while (isStaleSetupBackDestination(destination, gatewayRunning)) {
      destination = goBackSetup("welcome");
    }
    // The setup summary belongs to the active runtime attempt. Returning to an
    // earlier decision point must not leave a completed/failed later attempt
    // visible as if it still described the current stage.
    if (
      destination === "welcome"
      || destination === "detecting"
      || destination === "storage"
      || destination === "choosing-mode"
    ) {
      commitSteps([]);
    }
    presentSetupStep(destination);
  }, [cancelActiveRun, setSetupError, setNeedsGit, goBackSetup, gatewayRunning, commitSteps, presentSetupStep, rollbackRuntimeReconfiguration, appendSetupLog, report, replaceSetupStep]);

  const retryGit = useCallback(() => {
    setNeedsGit(false);
    setSetupError(null);
    runNativeSetup();
  }, [setNeedsGit, setSetupError, runNativeSetup]);

  const retryNode = useCallback(() => {
    setNodeRequirement(null);
    setSetupError(null);
    runNativeSetup();
  }, [setSetupError, runNativeSetup]);

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
    const runtimeTarget = await detectGatewayConfig();
    const selectedRuntime = runtimeTarget.runtime_mode;
    setInstallMode(selectedRuntime);
    cacheGatewayTarget(runtimeTarget.port, runtimeTarget.token);
    const status = selectedRuntime === "native" ? await checkOpenclaw() : null;
    setOpenclawStatus(status);
    if (status?.path) {
      setInstallTarget((current) => current
        ? { ...current, path: status.path!, version: status.version ?? undefined }
        : { tier: "existing", path: status.path!, version: status.version ?? undefined });
    }

    const gatewayRunning = await invoke<boolean>("probe_selected_gateway", {}).catch(() => false);
    setGatewayRunning(gatewayRunning);
    if (gatewayRunning) {
      setPostStorageStep(needsOnboardingRef.current ? "configure-openclaw" : "ready");
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
  }, [setGatewayRunning, setPostStorageStep, commitSteps, setInstallMode]);

  return {
    progress, statusMessage, installMode, dockerStatus, openclawStatus, checkingDocker, needsGit, nodeRequirement, steps,
    installTarget,
    wizardStep,
    wizardSubmitting,
    wizardError,
    needsOnboarding,
    repairing,
    brokenPlugins,
    forceStorageSelection,
    startGateway: startGatewayAction,
    retryGateway: startGatewayAction,
    repairAndRetry,
    disablePluginsAndRetry,
    submitWizardStep,
    retryWizard: startOfficialOnboarding,
    runNativeSetup,
    runDockerSetup,
    retrySetup,
    requestReinstall,
    completeStorageSetup,
    selectMode,
    detectDocker,
    refreshRuntime,
    goBack,
    retryGit,
    retryNode,
    enterWorkspace,
  };
}
