// ═══════════════════════════════════════════════════════════
// useSetupFlow — Detection & installation state machine
// Pure logic hook, no UI. Drives app-store state transitions.
// ═══════════════════════════════════════════════════════════

import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/app-store";
import {
  isStaleSetupBackDestination,
  type InstallMode,
} from "@/stores/setup-navigation";
import {
  checkOpenclaw, checkDocker, detectGatewayConfig, setActiveGatewayRuntime,
  commitSetupGatewayRuntime, rollbackActiveGatewayRuntime,
  rollbackRuntimeReconfiguration,
  getGatewayProcessStatus, probeSelectedGateway,
  type DockerStatus,
  type OpenclawStatus,
} from "@/api/tauri-commands";
import { enterWorkspaceWithTransition } from "@/motion/workspaceEntryTransition";
import { gatewayManager } from "@/services/gateway/GatewayConnectionManager";
import { openClawSetupVerificationClient } from "@/services/gateway";
import { executeRuntimeSelectionTransaction } from "@/services/setup/runtimeSelectionTransaction";
import { validateSetupCompletion } from "@/services/setup/setupCompletionGate";
import { sanitizeSetupDiagnostic } from "@/services/setup/setupDiagnostic";
import { createOnboardingPresentationMachine } from "@/services/setup/onboardingPresentation";
import {
  readActiveOpenclawConfig,
  validateActiveOpenclawConfig,
} from '@/services/openclawConfigRuntime';
import { isCurrentSetupOperationProgress } from "@/hooks/setupProgressEvents";
import {
  requiresOpenClawOnboarding,
} from "@/services/openclawWizard";


import { usePluginRecovery } from "./usePluginRecovery";
import { useWizardSession } from "./useWizardSession";
import { useSetupOperationCoordinator } from "./useSetupOperationCoordinator";
import { useSetupProgressEvents } from "./useSetupProgressEvents";
import { useSetupEnvironmentReview } from "./useSetupEnvironmentReview";
import { useSetupPresentation } from "./useSetupPresentation";
import { useSetupInstallers } from "./useSetupInstallers";
import {
  AUTO_ADVANCE_GATEWAY_STEP,
  INITIAL_DOCKER_STEPS,
  INITIAL_NATIVE_STEPS,
  cacheGatewayTarget,
  setupBackPolicy,
} from "./helpers";
import type {
  GatewayReadyContinuation,
  InstallTarget,
  SetupFlow,
  StepState,
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
  const presentationMachineRef = useRef(createOnboardingPresentationMachine(setupStep));
  const presentation = useMemo(
    () => presentationMachineRef.current.transition(setupStep),
    [setupStep],
  );
  const [installTarget, setInstallTarget] = useState<InstallTarget | null>(null);
  const [openclawStatus, setOpenclawStatus] = useState<OpenclawStatus | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(true);
  const [enteringDashboard, setEnteringDashboard] = useState(false);
  const [dashboardEntryError, setDashboardEntryError] = useState<string | null>(null);
  const dashboardEntryInFlightRef = useRef(false);
  const runtimeSelectionInFlightRef = useRef(false);
  const setupBackInFlightRef = useRef(false);
  const setupNavigationLeavingRef = useRef(false);
  const retrySetupInFlightRef = useRef(false);
  const dependencyRetryInFlightRef = useRef<"git" | "node" | null>(null);
  const [gatewayReadyContinuation, setGatewayReadyContinuation] = useState<GatewayReadyContinuation>({
    status: "idle",
    error: null,
  });
  const gatewayReadyContinuationInFlightRef = useRef(false);
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
  const {
    stepsRef,
    commitSteps,
    report,
    reportPhase,
    presentSetupStep,
    patchStep,
    ensureStepBefore,
    failRunningStep,
  } = useSetupPresentation({
    progress,
    setProgress,
    setStatusMessage,
    steps,
    setSteps,
    setSetupStatus,
    appendSetupLog,
  });
  const {
    beginRun: beginOperationRun,
    isRunActive,
    isCurrentOperationId,
    runSetupOperation,
    beginSetupTransaction: beginSetupOperation,
    finishSetupTransaction: finishSetupOperation,
    invalidateActiveRun,
    cancelActiveRun,
  } = useSetupOperationCoordinator();
  const beginRun = useCallback(() => {
    const runId = beginOperationRun();
    setInstallTarget(null);
    setNodeRequirement(null);
    return runId;
  }, [beginOperationRun]);
  const acceptSetupProgressOperation = useCallback(
    (operationId: string | null) => isCurrentSetupOperationProgress(operationId, isCurrentOperationId),
    [isCurrentOperationId],
  );

  const waitForGatewayReady = useCallback(async (runId: number, timeoutMs = 30_000, port?: number | null) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!isRunActive(runId)) throw new Error("setup cancelled");
      try {
        if (port) {
          const reachable = await probeSelectedGateway(port);
          if (reachable) return { running: true, port };
        } else {
          const status = await getGatewayProcessStatus();
          if (status.running) {
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
      const detected = await validateActiveOpenclawConfig();
      const loaded = await readActiveOpenclawConfig();
      return requiresOpenClawOnboarding(detected.exists, loaded.data);
    } catch {
      // A missing or unreadable selected-runtime config must stay in the
      // official onboarding path instead of allowing an unconfigured workspace.
      return true;
    }
  }, []);

  const verifyActiveRuntimeInference = useCallback(async (): Promise<boolean> => {
    try {
      return (await openClawSetupVerificationClient.verify()).ok;
    } catch {
      return false;
    }
  }, []);

  const {
    continueAfterEnvironmentReview,
    redetectEnvironment,
    environmentActionInFlightRef,
    dockerDetectingRef,
  } = useSetupEnvironmentReview({
    setupStep,
    dockerStatus,
    navigationLeavingRef: setupNavigationLeavingRef,
    relocationRequestedRef,
    stepsRef,
    beginRun,
    isRunActive,
    resolveOnboardingRequirement: resolveActiveRuntimeOnboardingRequirement,
    updateOnboardingRequirement,
    setGatewayRunning,
    setInstallMode,
    setOpenclawStatus,
    setInstallTarget,
    setDockerStatus,
    setCheckingDocker,
    setSetupComplete,
    setPostStorageStep,
    commitSteps,
    report,
    navigateSetup,
  });

  useSetupProgressEvents({
    installMode,
    stepsRef,
    report,
    setInstallTarget,
    commitSteps,
    isCurrentOperationId,
  });

  const {
    wizardStep,
    wizardSubmitting,
    wizardActivity,
    wizardError,
    wizardRecoveryRequired,
    submitWizardStep,
    pollWizard,
    retryWizard,
    reclaimWizard,
    invalidateWizardOperations,
    setWizardStep,
    setWizardError,
    setWizardSubmitting,
    isWizardOperationInFlight,
  } = useWizardSession({
    setupStep,
    report,
    patchStep,
    resolveActiveRuntimeOnboardingRequirement,
    verifyConfiguredInference: verifyActiveRuntimeInference,
    updateOnboardingRequirement,
    appendSetupLog,
    replaceSetupStep,
    setPostStorageStep,
    setSetupError,
    setGatewayRunning,
    navigationLeavingRef: setupNavigationLeavingRef,
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
      const status = isDockerRuntime
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
    } catch (error) {
      if (!isRunActive(runId)) return false;
      const message = error instanceof Error ? error.message : String(error);
      setGatewayRunning(false);
      if (stepsRef.current.some((s) => s.id === "gateway")) {
        patchStep("gateway", "error", message);
      } else {
        commitSteps([{ id: "gateway", label: "Gateway", status: "error", detail: message }]);
      }
      appendSetupLog({ source: "setup", message, step: "gateway", level: "error" });
      setSetupError(message);
      report(message);
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

      const completion = await validateSetupCompletion({
        probeGateway: () => probeSelectedGateway().catch(() => false),
        requiresOnboarding: resolveActiveRuntimeOnboardingRequirement,
        verifyConfiguredInference: verifyActiveRuntimeInference,
      });

      setGatewayReadyContinuation({ status: "idle", error: null });
      if (!completion.ready) {
        // The configure page owns wizard startup. This transition only decides
        // the destination so one click cannot create competing wizard sessions.
        navigateSetup("configure-openclaw", "push");
        return;
      }

      report(t("setup.ready"), 100);
      navigateSetup("ready", "push");
    } catch (error) {
      const detail = sanitizeSetupDiagnostic(error instanceof Error ? error.message : error);
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
  }, [appendSetupLog, gatewayRunning, navigateSetup, report, resolveActiveRuntimeOnboardingRequirement, setSetupError, startGatewayAction, t, verifyActiveRuntimeInference]);

  // Storage, runtime selection, and the official OpenClaw wizard stay
  // interactive; only the Gateway start above continues on its own.
  const autoStartedGatewayRef = useRef(false);
  useEffect(() => {
    if (setupStep !== AUTO_ADVANCE_GATEWAY_STEP) {
      autoStartedGatewayRef.current = false;
      return;
    }
    if (setupNavigationLeavingRef.current || autoStartedGatewayRef.current) return;
    autoStartedGatewayRef.current = true;
    void startGatewayAction();
  }, [setupStep, startGatewayAction]);

  const { runNativeSetup, runDockerSetup } = useSetupInstallers({
    dockerStatus,
    reinstallRequestedRef,
    relocationRequestedRef,
    beginRun,
    beginSetupOperation,
    finishSetupOperation,
    isRunActive,
    runSetupOperation,
    startGateway: startGatewayAction,
    replaceSetupStep,
    commitSteps,
    patchStep,
    ensureStepBefore,
    failRunningStep,
    report,
    reportPhase,
    setNodeRequirement,
    setOpenclawStatus,
    setInstallTarget,
    setNeedsGit,
    setGatewayRunning,
    setSetupError,
    updateOnboardingRequirement,
  });

  const performRuntimeSelection = useCallback(async (mode: InstallMode) => {
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

  const selectMode = useCallback(async (mode: InstallMode) => {
    if (runtimeSelectionInFlightRef.current || setupBackInFlightRef.current) return;
    runtimeSelectionInFlightRef.current = true;
    try {
      await performRuntimeSelection(mode);
    } finally {
      runtimeSelectionInFlightRef.current = false;
    }
  }, [performRuntimeSelection]);

  const requestReinstall = useCallback(() => {
    // This action is rendered on the auto-starting Gateway screen. Supersede
    // that owned run before changing screens so its late success cannot replace
    // the runtime chooser with gateway-ready.
    void invalidateActiveRun();
    reinstallRequestedRef.current = true;
    setSetupError(null);
    navigateSetup("choosing-mode", "push");
  }, [invalidateActiveRun, setSetupError, navigateSetup]);

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


  const {
    repairing,
    brokenPlugins,
    setBrokenPlugins,
    repairAndRetry,
    disablePluginsAndRetry,
    isPluginRecoveryInFlight,
  } = usePluginRecovery({
    setupError,
    installMode,
    pluginHealAttemptedRef,
    beginRun,
    isRunActive,
    patchStep,
    report,
    appendSetupLog,
    replaceSetupStep,
    setSetupError,
    setGatewayRunning,
    setPostStorageStep,
    setForceStorageSelection,
    startGatewayAction,
    isConflictingRecoveryInFlight: () => (
      setupBackInFlightRef.current
      || retrySetupInFlightRef.current
      || dependencyRetryInFlightRef.current !== null
      || runtimeSelectionInFlightRef.current
      || gatewayReadyContinuationInFlightRef.current
      || dashboardEntryInFlightRef.current
      || isWizardOperationInFlight()
    ),
  });

  const retrySetup = useCallback(async (): Promise<boolean> => {
    if (
      retrySetupInFlightRef.current
      || setupBackInFlightRef.current
      || runtimeSelectionInFlightRef.current
      || dependencyRetryInFlightRef.current
      || gatewayReadyContinuationInFlightRef.current
      || dashboardEntryInFlightRef.current
      || isPluginRecoveryInFlight()
      || isWizardOperationInFlight()
    ) return false;
    retrySetupInFlightRef.current = true;
    setSetupError(null);
    setNeedsGit(false);
    try {
      return installMode === "docker" ? await runDockerSetup() : await runNativeSetup();
    } finally {
      retrySetupInFlightRef.current = false;
    }
  }, [installMode, isPluginRecoveryInFlight, isWizardOperationInFlight, setSetupError, setNeedsGit, runDockerSetup, runNativeSetup]);

  const performGoBack = useCallback(async () => {
    setupNavigationLeavingRef.current = true;
    invalidateWizardOperations();
    setWizardSubmitting(false);
    // Backing out of the official wizard means "pause and review", not
    // "discard progress". Its opaque id is persisted so returning after an
    // app restart still resumes the same official Gateway session.
    setWizardStep(null);
    setWizardError(null);
    void invalidateActiveRun();

    // Detection and Gateway startup are cancellable renderer runs, not durable
    // configuration transactions. Consume their history immediately: late RPC
    // completions observe the invalid run id and cannot navigate forward again.
    const backPolicy = setupBackPolicy(setupStep);
    if (backPolicy === "cancel-run") {
      setSetupError(null);
      setNeedsGit(false);
      let destination = goBackSetup("welcome");
      while (isStaleSetupBackDestination(destination) || destination === setupStep) {
        destination = goBackSetup("welcome");
      }
      presentSetupStep(destination);
      return;
    }

    try {
      // Only storage and the untouched runtime-choice screen can own a pending
      // location memento. Runtime selection itself is synchronously guarded
      // from Back and commits or compensates its staged mode transaction before
      // releasing that guard; later pages must never roll back committed state.
      if (backPolicy === "rollback-storage") {
        await rollbackRuntimeReconfiguration();
      }
    } catch (rollbackError) {
      const message = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      appendSetupLog({ source: "setup", step: "storage", message, level: "error" });
      setSetupError(message);
      report(message);
      // A failed durable rollback must remain at the storage recovery gate.
      // Sending it to the generic error screen would let a second Back skip
      // that screen and leave the pending location transaction unresolved.
      setForceStorageSelection(true);
      replaceSetupStep("storage");
      setupNavigationLeavingRef.current = false;
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
    while (isStaleSetupBackDestination(destination) || destination === setupStep) {
      destination = goBackSetup("welcome");
    }
    if (destination === "storage") {
      setForceStorageSelection(true);
    }
    // Navigation and retries retain the same diagnostic timeline so the user
    // can inspect each completed stage and compare a later attempt with it.
    presentSetupStep(destination);
    setupNavigationLeavingRef.current = false;
  }, [setupStep, invalidateActiveRun, invalidateWizardOperations, setSetupError, setNeedsGit, goBackSetup, presentSetupStep, rollbackRuntimeReconfiguration, appendSetupLog, report, replaceSetupStep, setForceStorageSelection]);

  const goBack = useCallback(async () => {
    if (
      (setupStep === "environment-review" && (
        environmentActionInFlightRef.current || dockerDetectingRef.current
      ))
      || setupBackInFlightRef.current
      || runtimeSelectionInFlightRef.current
      || retrySetupInFlightRef.current
      || dependencyRetryInFlightRef.current
      || gatewayReadyContinuationInFlightRef.current
      || dashboardEntryInFlightRef.current
      || isPluginRecoveryInFlight()
      || isWizardOperationInFlight()
    ) return;
    setupBackInFlightRef.current = true;
    if (setupStep === "environment-review") environmentActionInFlightRef.current = true;
    try {
      await performGoBack();
    } finally {
      setupNavigationLeavingRef.current = false;
      environmentActionInFlightRef.current = false;
      setupBackInFlightRef.current = false;
    }
  }, [isPluginRecoveryInFlight, isWizardOperationInFlight, performGoBack, setupStep]);

  const cancelSetupRun = useCallback(async () => {
    if (
      setupBackInFlightRef.current
      || gatewayReadyContinuationInFlightRef.current
      || dashboardEntryInFlightRef.current
      || isPluginRecoveryInFlight()
    ) return;
    setupBackInFlightRef.current = true;
    try {
      try {
        // The explicit action confirms that Tauri received the cancellation,
        // then waits for the original native cleanup path to return.
        await cancelActiveRun();
      } catch (error) {
        const detail = sanitizeSetupDiagnostic(error instanceof Error ? error.message : error);
        const message = t("setup.cancelInstallFailed", {
          error: detail,
          defaultValue: "无法取消当前安装：{{error}}。请重试。",
        });
        appendSetupLog({ source: "setup", step: "openclaw", message, level: "error" });
        setSetupError(message);
        report(message);
        return;
      }

      let restoredLocations: boolean;
      try {
        restoredLocations = await rollbackRuntimeReconfiguration();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendSetupLog({ source: "setup", step: "storage", message, level: "error" });
        setSetupError(message);
        report(message);
        setForceStorageSelection(true);
        replaceSetupStep("storage");
        return;
      }
      if (!restoredLocations) {
        await rollbackActiveGatewayRuntime(installMode).catch((error) => {
          appendSetupLog({
            source: "setup",
            step: "gateway",
            message: error instanceof Error ? error.message : String(error),
            level: "warn",
          });
        });
      }
      await performGoBack();
    } finally {
      setupNavigationLeavingRef.current = false;
      setupBackInFlightRef.current = false;
    }
  }, [appendSetupLog, cancelActiveRun, installMode, isPluginRecoveryInFlight, performGoBack, replaceSetupStep, report, setForceStorageSelection, setSetupError, t]);

  const retryGit = useCallback(() => {
    if (
      dependencyRetryInFlightRef.current
      || setupBackInFlightRef.current
      || retrySetupInFlightRef.current
      || runtimeSelectionInFlightRef.current
      || gatewayReadyContinuationInFlightRef.current
      || dashboardEntryInFlightRef.current
      || isPluginRecoveryInFlight()
      || isWizardOperationInFlight()
    ) return;
    dependencyRetryInFlightRef.current = "git";
    setNeedsGit(false);
    setSetupError(null);
    void runNativeSetup().finally(() => {
      if (dependencyRetryInFlightRef.current === "git") dependencyRetryInFlightRef.current = null;
    });
  }, [isPluginRecoveryInFlight, isWizardOperationInFlight, setNeedsGit, setSetupError, runNativeSetup]);

  const retryNode = useCallback(() => {
    if (
      dependencyRetryInFlightRef.current
      || setupBackInFlightRef.current
      || retrySetupInFlightRef.current
      || runtimeSelectionInFlightRef.current
      || gatewayReadyContinuationInFlightRef.current
      || dashboardEntryInFlightRef.current
      || isPluginRecoveryInFlight()
      || isWizardOperationInFlight()
    ) return;
    dependencyRetryInFlightRef.current = "node";
    setNodeRequirement(null);
    setSetupError(null);
    void runNativeSetup().finally(() => {
      if (dependencyRetryInFlightRef.current === "node") dependencyRetryInFlightRef.current = null;
    });
  }, [isPluginRecoveryInFlight, isWizardOperationInFlight, setSetupError, runNativeSetup]);

  const enterDashboard = useCallback(async (origin?: Element | null) => {
    if (dashboardEntryInFlightRef.current) return;
    dashboardEntryInFlightRef.current = true;
    setEnteringDashboard(true);
    setDashboardEntryError(null);
    try {
      // Ready 是展示状态而非持久健康保证；在提交完成标记的同一操作中重新核验
      // Gateway 与配置，避免自启动交接期间失联后仍缓存为完成。
      const completion = await validateSetupCompletion({
        probeGateway: () => probeSelectedGateway().catch(() => false),
        requiresOnboarding: resolveActiveRuntimeOnboardingRequirement,
        verifyConfiguredInference: verifyActiveRuntimeInference,
      });
      if (!completion.ready && completion.reason === "gateway-unavailable") {
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
      if (!completion.ready) {
        updateOnboardingRequirement(true);
        const message = t(
          "setup.dashboardEntryOnboardingRequired",
          "当前运行时配置仍需完成 OpenClaw 设置。",
        );
        setDashboardEntryError(message);
        setSetupError(message);
        appendSetupLog({ source: "setup", step: "wizard", message, level: "warn" });
        report(message);
        replaceSetupStep("configure-openclaw");
        return;
      }

      setSetupError(null);
      void invalidateActiveRun();
      enterWorkspaceWithTransition(() => {
        // Gateway 与配置门已在当前操作中核验，路由切换时保留这次交接结果。
        setWorkspaceStartupMode("verified-gateway-handoff");
        window.location.hash = '/';
        setSetupComplete(true);
      }, origin);
    } finally {
      dashboardEntryInFlightRef.current = false;
      setEnteringDashboard(false);
    }
  }, [appendSetupLog, invalidateActiveRun, replaceSetupStep, report, resolveActiveRuntimeOnboardingRequirement, setGatewayRunning, setSetupComplete, setSetupError, setWorkspaceStartupMode, t, updateOnboardingRequirement, verifyActiveRuntimeInference]);

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
    const runId = beginRun();
    const runtimeTarget = await detectGatewayConfig();
    if (!isRunActive(runId)) return { status: null, gatewayRunning: false, needsOnboarding: needsOnboardingRef.current };
    const selectedRuntime = runtimeTarget.runtime_mode;
    setInstallMode(selectedRuntime);
    cacheGatewayTarget(runtimeTarget.port);
    const status = selectedRuntime === "native" ? await checkOpenclaw() : null;
    if (!isRunActive(runId)) return { status: null, gatewayRunning: false, needsOnboarding: needsOnboardingRef.current };
    setOpenclawStatus(status);
    if (status?.path) {
      setInstallTarget((current) => current
        ? { ...current, path: status.path!, version: status.version ?? undefined }
        : { tier: "existing", path: status.path!, version: status.version ?? undefined });
    }

    const gatewayRunning = await probeSelectedGateway().catch(() => false);
    if (!isRunActive(runId)) return { status: null, gatewayRunning: false, needsOnboarding: needsOnboardingRef.current };
    setGatewayRunning(gatewayRunning);
    let needsOnboarding = needsOnboardingRef.current;
    if (gatewayRunning) {
      needsOnboarding = await resolveActiveRuntimeOnboardingRequirement();
      if (!isRunActive(runId)) return { status: null, gatewayRunning: false, needsOnboarding };
      updateOnboardingRequirement(needsOnboarding);
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
    return { status, gatewayRunning, needsOnboarding };
  }, [beginRun, isRunActive, resolveActiveRuntimeOnboardingRequirement, setGatewayRunning, setPostStorageStep, commitSteps, setInstallMode, updateOnboardingRequirement]);

  return {
    presentation,
    progress, statusMessage, installMode, dockerStatus, openclawStatus, checkingDocker, needsGit, nodeRequirement, steps,
    installTarget,
    wizardStep,
    wizardSubmitting,
    wizardActivity,
    wizardError,
    wizardRecoveryRequired,
    needsOnboarding,
    gatewayReadyContinuation,
    repairing,
    brokenPlugins,
    forceStorageSelection,
    acceptSetupProgressOperation,
    continueAfterEnvironmentReview,
    redetectEnvironment,
    enteringDashboard,
    dashboardEntryError,
    startGateway: startGatewayAction,
    continueAfterGatewayReady,
    retryGateway: startGatewayAction,
    repairAndRetry,
    disablePluginsAndRetry,
    submitWizardStep,
    pollWizard,
    retryWizard,
    reclaimWizard,
    runNativeSetup,
    runDockerSetup,
    retrySetup,
    requestReinstall,
    completeStorageSetup,
    selectMode,
    detectDocker,
    refreshRuntime,
    goBack,
    cancelSetupRun,
    retryGit,
    retryNode,
    enterDashboard,
  };
}
