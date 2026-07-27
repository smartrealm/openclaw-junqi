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
  checkDocker, pullOpenclawImage, detectGatewayConfig, setActiveGatewayRuntime,
  commitSetupGatewayRuntime, rollbackActiveGatewayRuntime,
  rollbackRuntimeReconfiguration,
  type DockerStatus,
  type OpenclawStatus,
} from "@/api/tauri-commands";
import { subscribeTauriEvent } from "@/utils/tauriEvents";
import {
  setupProgressI18nParams,
  translateSetupProgressMessage,
} from "../setupProgressParams";
import {
  advanceSetupProgress,
  progressForSetupEvent,
  type SetupProgressPhase,
} from "../setupProgressModel";
import { normalizeSetupProgressPayload } from "../setupProgressEvents";
import { enterWorkspaceWithTransition } from "@/motion/workspaceEntryTransition";
import { debugWarn } from "@/utils/debugLog";
import { gateway, GatewayPrivilegedAuthorizationError } from "@/services/gateway";
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
import { executeRuntimeSelectionTransaction } from "@/services/setup/runtimeSelectionTransaction";
import {
  classifyOpenClawWizardFailure,
  createBrowserOpenClawWizardSessionStore,
  OpenClawWizardCancelledError,
  OpenClawWizardClient,
  OpenClawWizardOperationSupersededError,
  isOpenClawWizardSessionLost,
  isOpenClawWizardStepDesynchronized,
  requiresOpenClawOnboarding,
  type OpenClawWizardResult,
  type OpenClawWizardStep,
} from "@/services/openclawWizard";


import { useWizardSession } from "./useWizardSession";
import {
  AUTO_ADVANCE_GATEWAY_STEP,
  INITIAL_DOCKER_STEPS,
  INITIAL_NATIVE_STEPS,
  cacheGatewayTarget,
  isMissingGitDependencyError,
  pickInstallTargetFromProgress,
} from "./helpers";
import type {
  GatewayReadyContinuation,
  InstallTarget,
  SetupFlow,
  StepState,
  StepStatus,
} from "./types";

export type {
  GatewayReadyContinuation,
  InstallTarget,
  InstallTargetTier,
  SetupFlow,
  StepState,
  StepStatus,
} from "./types";

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
    setGatewayRunning, setInstallMode, setSetupStatus, appendSetupLog,
    setWorkspaceStartupMode,
  } = useAppStore();
  const { t } = useTranslation();
  const [installTarget, setInstallTarget] = useState<InstallTarget | null>(null);
  const [openclawStatus, setOpenclawStatus] = useState<OpenclawStatus | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(true);
  const [enteringDashboard, setEnteringDashboard] = useState(false);
  const [dashboardEntryError, setDashboardEntryError] = useState<string | null>(null);
  const dashboardEntryInFlightRef = useRef(false);
  const [gatewayReadyContinuation, setGatewayReadyContinuation] = useState<GatewayReadyContinuation>({
    status: "idle",
    error: null,
  });
  const gatewayReadyContinuationInFlightRef = useRef(false);
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
            cacheGatewayTarget(status.port);
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

  const probeActiveRuntimeModel = useCallback(async (): Promise<{
    ready: boolean;
    model?: string | null;
    detail?: string | null;
  }> => {
    report(t("setup.wizard.checkingModel", "正在验证所选模型…"), 90);
    try {
      const result = await window.aegis.providerRuntime.probeActive();
      appendSetupLog({
        source: "setup",
        step: "wizard",
        message: result.ready
          ? `OpenClaw live model probe passed${result.model ? ` (${result.model})` : ""}`
          : result.detail || "OpenClaw live model probe did not pass",
        level: result.ready ? "info" : "warn",
      });
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      appendSetupLog({ source: "setup", step: "wizard", message: detail, level: "warn" });
      return { ready: false, detail };
    }
  }, [appendSetupLog, report, t]);

  // ── 挂载后自动检测 ──
  // 先读取后端持久化的运行时选择，并独立检测宿主机 Native OpenClaw，
  // 这样即使当前选择 Docker，也能在运行方式页准确展示两种可复用环境。
  // 然后 probe_gateway_port（Rust 侧从选定配置读取实际端口）。检测只能推进向导步骤，不能写入
  // “已完成”标记；该标记必须由用户点击“进入仪表盘”后写入。
  useEffect(() => {
    if (setupStep !== "detecting") return;
    let cancelled = false;
    // Detection never decides more than what the user is asked next: every
    // outcome hands over to the storage step, carrying the stage to resume once
    // the location is confirmed.
    const enterStorage = (next: Parameters<typeof setPostStorageStep>[0]) => {
      setPostStorageStep(next);
      report(t("storage.title", "选择 OpenClaw 数据位置"), 24);
      navigateSetup("storage", "replace");
    };
    void (async () => {
      report(t("setup.detecting"), 0);
      setGatewayRunning(false);
      try {
        const runtimeTarget = await detectGatewayConfig();
        if (cancelled) return;
        const selectedRuntime = runtimeTarget.runtime_mode;
        setInstallMode(selectedRuntime);
        cacheGatewayTarget(runtimeTarget.port);

        // Runtime selection and host installation availability are separate.
        // Detect Native even when Docker is currently selected so the choice
        // screen can truthfully present both reusable environments.
        const oclaw = await checkOpenclaw();
        if (cancelled) return;
        setOpenclawStatus(oclaw);
        if (selectedRuntime === "native" && (!oclaw?.installed || oclaw.relocation_required)) {
          relocationRequestedRef.current = Boolean(oclaw?.relocation_required);
          // 从未安装过，先确定存储位置，再进入安装方式选择。
          localStorage.removeItem("junqi-setup-done");
          enterStorage("choosing-mode");
          return;
        }
        const onboardingRequired = await resolveActiveRuntimeOnboardingRequirement();
        if (cancelled) return;
        updateOnboardingRequirement(onboardingRequired);
        if (oclaw?.path) {
          setInstallTarget({ tier: "existing", path: oclaw.path, version: oclaw.version ?? undefined });
        }
        // 选定运行时已满足探测条件，继续检查 Gateway 是否已监听。这里不直接
        // 进入仪表盘，避免用户在向导中前后切换时被跳过确认步骤。
        try {
          // 不传端口时由 Rust 读取配置；读取失败时使用共享运行时默认值。
          const reachable: boolean = await invoke("probe_selected_gateway", {});
          if (cancelled) return;
          if (reachable) {
            setGatewayRunning(true);
            commitSteps([{ id: "gateway", label: "Gateway", status: "done", progress: 100 }]);
            enterStorage(onboardingRequired ? "configure-openclaw" : "ready");
            return;
          }
        } catch {
          if (cancelled) return;
        }

        // Installed but gateway not responding → ask the user to start it.
        enterStorage("gateway-stopped");
      } catch {
        if (cancelled) return;
        setOpenclawStatus(null);
        enterStorage("choosing-mode");
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
      catch { setDockerStatus({ available: false, version: null, daemon_running: false, unsupported_reason: null, image_available: false }); }
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
        const { step, message, progress: localProgress, diagnostic, error, key, params, status } = normalized;
        if (diagnostic) return;
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
    const current = stepsRef.current.find((step) => step.id === id);
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

    if (!detail || (current?.status === status && current.detail === detail)) return;
    appendSetupLog({
      source: "setup",
      step: id,
      message: detail,
      level: status === "error" ? "error" : status === "done" ? "success" : "info",
      progress: status === "done" ? 1 : undefined,
    });
  }

  function ensureStepBefore(step: StepState, beforeId: string) {
    if (stepsRef.current.some((current) => current.id === step.id)) return;
    const next = [...stepsRef.current];
    const insertionIndex = next.findIndex((current) => current.id === beforeId);
    next.splice(insertionIndex >= 0 ? insertionIndex : next.length, 0, step);
    commitSteps(next);
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


  const {
    wizardStep,
    wizardSubmitting,
    wizardCanGoBack,
    wizardError,
    wizardRecoveryRequired,
    submitWizardStep,
    retryWizard,
    reclaimWizard,
    backWizard,
    invalidateWizardOperations,
    setWizardStep,
    setWizardCanGoBack,
    setWizardError,
    setWizardSubmitting,
  } = useWizardSession({
    setupStep,
    report,
    patchStep,
    probeActiveRuntimeModel,
    resolveActiveRuntimeOnboardingRequirement,
    updateOnboardingRequirement,
    appendSetupLog,
    replaceSetupStep,
    setPostStorageStep,
    setSetupError,
    setGatewayRunning,
  });

  // ── Actions ──
  const startGatewayAction = useCallback(async (
    requestedMode?: InstallMode,
    existingRunId?: number,
  ): Promise<boolean> => {
    const runId = existingRunId ?? beginRun();
    setGatewayRunning(false);
    navigateSetup("checking", "push");
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
      cacheGatewayTarget(status?.port);
      patchStep("gateway", "running", t("setup.gatewayConnecting", "Gateway 已就绪，正在建立连接…"));
      reportPhase("gatewayPort", t("setup.gatewayConnecting", "Gateway 已就绪，正在建立连接…"));
      await waitForGatewayReady(runId, isDockerRuntime ? 30_000 : 10_000, status?.port);
      if (!isRunActive(runId)) return false;
      if (isDockerRuntime) {
        patchStep("container", "done");
      }
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
      // Starting a runtime and choosing what to do with it are separate user
      // decisions. The next stage is entered only from continueAfterGatewayReady.
      replaceSetupStep("gateway-ready");
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
  }, [beginRun, isRunActive, navigateSetup, replaceSetupStep, report, reportPhase, t, commitSteps, waitForGatewayReady, setGatewayRunning, setPostStorageStep, setSetupError, appendSetupLog, installMode]);

  const continueAfterGatewayReady = useCallback(async () => {
    if (gatewayReadyContinuationInFlightRef.current) return;
    gatewayReadyContinuationInFlightRef.current = true;
    setGatewayReadyContinuation({ status: "checking", error: null });
    setSetupError(null);
    try {
      if (!gatewayRunning) {
        const started = await startGatewayAction();
        if (!started) {
          setGatewayReadyContinuation({ status: "idle", error: null });
          return;
        }
      }

      let onboardingRequired = needsOnboardingRef.current;
      if (!onboardingRequired) {
        onboardingRequired = !(await probeActiveRuntimeModel()).ready;
        updateOnboardingRequirement(onboardingRequired);
      }

      setGatewayReadyContinuation({ status: "idle", error: null });
      if (onboardingRequired) {
        // The configure page owns wizard startup. This transition only decides
        // the destination so one click cannot create competing wizard sessions.
        navigateSetup("configure-openclaw", "push");
        return;
      }

      report(t("setup.ready"), 100);
      navigateSetup("ready", "push");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const message = t("setup.gatewayReadyContinueFailed", {
        error: detail,
        defaultValue: "无法进入下一步：{{error}}",
      });
      setGatewayReadyContinuation({ status: "failed", error: message });
      setSetupError(message);
      report(message);
      appendSetupLog({ source: "setup", step: "gateway", message, level: "error" });
    } finally {
      gatewayReadyContinuationInFlightRef.current = false;
    }
  }, [appendSetupLog, gatewayRunning, navigateSetup, probeActiveRuntimeModel, report, setSetupError, startGatewayAction, t, updateOnboardingRequirement]);

  // Storage, runtime selection, and the official OpenClaw wizard stay
  // interactive; only the Gateway start above continues on its own.
  const autoStartedGatewayRef = useRef(false);
  useEffect(() => {
    if (setupStep !== AUTO_ADVANCE_GATEWAY_STEP) {
      autoStartedGatewayRef.current = false;
      return;
    }
    if (autoStartedGatewayRef.current) return;
    autoStartedGatewayRef.current = true;
    void startGatewayAction();
  }, [setupStep, startGatewayAction]);

  const runNativeSetup = useCallback(async (existingRunId?: number): Promise<boolean> => {
    const runId = existingRunId ?? beginRun();
    const s = [...INITIAL_NATIVE_STEPS];
    commitSteps(s);
    try {
      replaceSetupStep("checking");

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
        setupNode = await runDependencyInstall(
          runId,
          "node",
          (operationId) => installNode(false, operationId),
        );
        if (!isRunActive(runId)) return false;
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
        setupNode = await runDependencyInstall(runId, "node", repairSetupNodeRuntime);
        if (!isRunActive(runId)) return false;
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
        const installSelectedOpenclaw = async () => {
          if (forceRelocation) {
            await relocateOpenclaw();
          } else if (forceReinstall) {
            await reinstallOpenclaw();
          } else {
            await installOpenclaw();
          }
        };
        try {
          await installSelectedOpenclaw();
        } catch (error) {
          // Every platform has a Git recovery path, they just differ in how far
          // they get on their own: Windows installs it, macOS opens the Apple
          // Command Line Tools installer, and Linux answers with the package
          // manager instruction. Routing all three through here replaces npm's
          // raw `spawn git ENOENT` with the platform's own guidance.
          if (!isMissingGitDependencyError(error)) throw error;

          patchStep("openclaw", "pending");
          ensureStepBefore(
            { id: "git", label: "Git", status: "running" },
            "openclaw",
          );
          patchStep("git", "running", t("setup.installingGit", "正在安装 Git…"));
          replaceSetupStep("install-git");
          reportPhase("openclaw", t("setup.installingGit", "正在安装 Git…"), 10);
          await runDependencyInstall(runId, "git", installGit);
          if (!isRunActive(runId)) return false;
          const installedGit = await checkGit();
          if (!isRunActive(runId)) return false;
          if (!installedGit.available) {
            throw new Error(t("setup.gitRequiredDesc"));
          }
          patchStep("git", "done", installedGit.version ?? undefined);
          patchStep("openclaw", "running", t("setup.installingOpenclaw"));
          replaceSetupStep("install-openclaw");
          reportPhase("openclaw", t("setup.installingOpenclaw"), 10);
          await installSelectedOpenclaw();
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

      // Once the user has confirmed the selected runtime, setup owns the
      // complete installation transaction, including Gateway startup. It stops
      // at gateway-ready; only entering the official wizard remains explicit.
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
      setSetupError, appendSetupLog, updateOnboardingRequirement, startGatewayAction, runDependencyInstall]);

  const runDockerSetup = useCallback(async (existingRunId?: number): Promise<boolean> => {
    const runId = existingRunId ?? beginRun();
    commitSteps([...INITIAL_DOCKER_STEPS]);
    try {
      replaceSetupStep("checking");

      if (dockerStatus?.image_available) {
        patchStep("pull", "done", t("setup.reusingDockerImage", "已复用本地 OpenClaw 镜像"));
        report(t("setup.reusingDockerImage", "已复用本地 OpenClaw 镜像"), 30);
      } else {
        patchStep("pull", "running", t("setup.pullingImage"));
        report(t("setup.pullingImage"), 10);
        await pullOpenclawImage("latest");
        if (!isRunActive(runId)) return false;
        patchStep("pull", "done");
      }

      return await startGatewayAction("docker", runId);
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
  }, [beginRun, isRunActive, replaceSetupStep, t, report, commitSteps, dockerStatus,
      setGatewayRunning, setSetupError, appendSetupLog, startGatewayAction]);

  const selectMode = useCallback(async (mode: InstallMode) => {
    const runId = beginRun();
    const previousMode = installMode;
    setSetupError(null);

    try {
      const outcome = await executeRuntimeSelectionTransaction(mode, previousMode, {
        isActive: () => isRunActive(runId),
        rollbackPendingLocations: rollbackRuntimeReconfiguration,
        stageMode: setActiveGatewayRuntime,
        prepare: async (targetMode) => {
          setInstallMode(targetMode);
          const onboardingRequired = await resolveActiveRuntimeOnboardingRequirement();
          if (!isRunActive(runId)) return;
          updateOnboardingRequirement(onboardingRequired);
          navigateSetup("checking", "push");
          if (targetMode === "native") {
            commitSteps([...INITIAL_NATIVE_STEPS]);
          } else {
            reinstallRequestedRef.current = false;
            commitSteps([...INITIAL_DOCKER_STEPS]);
          }
        },
        setup: (targetMode) => targetMode === "native"
          ? runNativeSetup(runId)
          : runDockerSetup(runId),
        commit: commitSetupGatewayRuntime,
        rollbackMode: rollbackActiveGatewayRuntime,
        restoreGateway: async (runtime) => {
          if (runtime === "native") await gatewayManager.startForSetup();
          else await gatewayManager.startDockerForSetup();
        },
      });

      if (outcome.status === "committed" || outcome.status === "superseded") return;
      setInstallMode(previousMode);
      const onboardingRequired = await resolveActiveRuntimeOnboardingRequirement();
      if (!isRunActive(runId)) return;
      updateOnboardingRequirement(onboardingRequired);

      if (outcome.compensationErrors?.length) {
        const message = t("setup.runtimeCompensationIncomplete", "运行时切换失败，部分恢复操作未完成；请检查 Gateway 状态后重试");
        appendSetupLog({
          source: "setup",
          step: "gateway",
          message: `${message}: ${outcome.compensationErrors.map(String).join("; ")}`,
          level: "error",
        });
        setSetupError(message);
        report(message);
        replaceSetupStep("error");
        return;
      }

      const switchedMode = mode !== previousMode;
      if (!switchedMode) {
        appendSetupLog({ source: "setup", step: "gateway", message: `${mode} setup failed; the selected runtime mode did not change`, level: "warn" });
        report(t("setup.runtimeSetupFailedUnchanged", "安装或启动失败，当前运行模式未发生变化"));
      } else if (outcome.restoredPreviousGateway) {
        appendSetupLog({ source: "setup", step: "gateway", message: `Runtime switch to ${mode} failed; restored ${previousMode}`, level: "warn" });
        report(t("setup.runtimeSwitchRolledBack", "运行时切换失败，已恢复之前的运行模式"));
      } else {
        const message = t("setup.runtimeSwitchRolledBackFailed", "运行时切换失败，且未能自动恢复之前的运行模式，可能需要手动重启 Gateway");
        appendSetupLog({ source: "setup", step: "gateway", message: `${message}: ${String(outcome.previousGatewayRestoreError)}`, level: "error" });
        setSetupError(message);
        report(message);
      }
    } catch (error) {
      if (!isRunActive(runId)) return;
      const message = error instanceof Error ? error.message : String(error);
      appendSetupLog({ source: "setup", step: "gateway", message, level: "error" });
      setSetupError(message);
      report(message);
      replaceSetupStep("error");
    }
  }, [beginRun, isRunActive, installMode, setInstallMode, setSetupError, appendSetupLog, report, replaceSetupStep, navigateSetup, runNativeSetup, runDockerSetup, commitSteps, updateOnboardingRequirement, resolveActiveRuntimeOnboardingRequirement, setActiveGatewayRuntime, commitSetupGatewayRuntime, rollbackActiveGatewayRuntime, rollbackRuntimeReconfiguration, gatewayManager, t]);

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

    // A selected runtime is always brought back through its own preflight and
    // startup orchestration after storage is confirmed. Native verifies the
    // Node.js/npm/OpenClaw contract; Docker verifies the selected image and
    // container. Neither path asks the user to manually start Gateway.
    const canResumeNativeRuntime = installMode === "native"
      && openclawStatus?.installed
      && !relocationRequestedRef.current;
    const canResumeSelectedRuntime = installMode === "docker" || canResumeNativeRuntime;
    if (!runtimeReconfigurationRequired && canResumeSelectedRuntime) {
      navigateSetup("checking", "push");
      if (installMode === "docker") {
        void runDockerSetup();
      } else {
        void runNativeSetup();
      }
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
  }, [
    installMode,
    openclawStatus?.installed,
    postStorageStep,
    report,
    navigateSetup,
    t,
    updateOnboardingRequirement,
    runNativeSetup,
    runDockerSetup,
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
    invalidateWizardOperations();
    setWizardSubmitting(false);
    // Backing out of the official wizard means "pause and review", not
    // "discard progress". Its opaque id is persisted so returning after an
    // app restart still resumes the same official Gateway session.
    setWizardStep(null);
    setWizardCanGoBack(false);
    setWizardError(null);
    cancelActiveRun();
    try {
      const restoredRuntimeLocations = await rollbackRuntimeReconfiguration();
      // A location memento restores the complete previous bootstrap, including
      // runtime mode. Without one, Back must explicitly compensate a staged
      // mode selection so the current session does not rely on next-launch
      // crash recovery to become consistent again.
      if (!restoredRuntimeLocations) {
        await rollbackActiveGatewayRuntime(installMode);
      }
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
    // A run that pushed a transient step has already ended by the time Back is
    // reachable, so skip past every one of them to the last screen the user
    // actually acted on. `goBackSetup` returns the fallback once history is
    // exhausted, and the fallback is never transient, so this terminates.
    let destination = goBackSetup("welcome");
    while (isStaleSetupBackDestination(destination)) {
      destination = goBackSetup("welcome");
    }
    if (destination === "storage") {
      setForceStorageSelection(true);
    }
    // Navigation and retries retain the same diagnostic timeline so the user
    // can inspect each completed stage and compare a later attempt with it.
    presentSetupStep(destination);
  }, [cancelActiveRun, invalidateWizardOperations, setSetupError, setNeedsGit, goBackSetup, presentSetupStep, rollbackRuntimeReconfiguration, rollbackActiveGatewayRuntime, installMode, appendSetupLog, report, replaceSetupStep, setForceStorageSelection]);

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

  const enterDashboard = useCallback(async (origin?: Element | null) => {
    if (dashboardEntryInFlightRef.current) return;
    dashboardEntryInFlightRef.current = true;
    setEnteringDashboard(true);
    setDashboardEntryError(null);
    try {
      // Ready is a presentation state, not a durable health guarantee. Probe
      // again in the same user action that commits the setup marker so a
      // Gateway lost during autostart handoff cannot be cached as complete.
      const ready = await invoke<boolean>("probe_selected_gateway", {}).catch(() => false);
      if (!ready) {
        const message = t(
          "setup.dashboardEntryGatewayUnavailable",
          "Gateway 连接已中断，请恢复连接后再进入仪表盘。",
        );
        setGatewayRunning(false);
        setDashboardEntryError(message);
        setSetupError(message);
        appendSetupLog({ source: "setup", step: "gateway", message, level: "error" });
        report(message);
        replaceSetupStep("gateway-stopped");
        return;
      }

      setSetupError(null);
      cancelActiveRun();
      enterWorkspaceWithTransition(() => {
        // The final probe authenticated this exact handoff. Preserve that fact
        // through the route transition instead of replaying cold boot.
        setWorkspaceStartupMode("verified-gateway-handoff");
        window.location.hash = '/';
        setSetupComplete(true);
      }, origin);
    } finally {
      dashboardEntryInFlightRef.current = false;
      setEnteringDashboard(false);
    }
  }, [appendSetupLog, cancelActiveRun, replaceSetupStep, report, setGatewayRunning, setSetupComplete, setSetupError, setWorkspaceStartupMode, t]);

  const detectDocker = useCallback(async () => {
    if (dockerDetectingRef.current) return;
    dockerDetectingRef.current = true;
    setCheckingDocker(true);
    try { setDockerStatus(await checkDocker()); }
    catch { setDockerStatus({ available: false, version: null, daemon_running: false, unsupported_reason: null, image_available: false }); }
    finally {
      dockerDetectingRef.current = false;
      setCheckingDocker(false);
    }
  }, [setCheckingDocker, setDockerStatus]);

  const refreshRuntime = useCallback(async () => {
    const runtimeTarget = await detectGatewayConfig();
    const selectedRuntime = runtimeTarget.runtime_mode;
    setInstallMode(selectedRuntime);
    cacheGatewayTarget(runtimeTarget.port);
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
    wizardCanGoBack,
    wizardError,
    wizardRecoveryRequired,
    needsOnboarding,
    gatewayReadyContinuation,
    repairing,
    brokenPlugins,
    forceStorageSelection,
    enteringDashboard,
    dashboardEntryError,
    startGateway: startGatewayAction,
    continueAfterGatewayReady,
    retryGateway: startGatewayAction,
    repairAndRetry,
    disablePluginsAndRetry,
    submitWizardStep,
    retryWizard,
    reclaimWizard,
    backWizard,
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
    enterDashboard,
  };
}
