// 官方 OpenClaw 向导会话只投影 Gateway 持有的步骤和终态；会话丢失后保留未知结果。
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SetupStep } from "@/stores/setup-navigation";
import type { PostStorageStep, SetupLog } from "@/stores/app-store";
import {
  gateway,
  GatewayPrivilegedAuthorizationError,
  GatewayPrivilegedSourceChangedError,
} from "@/services/gateway";
import { gatewayManager } from "@/services/gateway/GatewayConnectionManager";
import { captureCurrentAttestedGatewayConnectionId, gatewayLifecycle, isAttestedGatewayConnectionCurrent } from "@/runtime/gatewayLifecycle";
import {
  detectGatewayConfig,
  probeSelectedGateway,
} from "@/api/tauri-commands";
import {
  classifyOpenClawWizardFailure,
  createScopedOpenClawWizardSessionStore,
  OpenClawWizardCancelledError,
  OpenClawWizardClient,
  OpenClawWizardOperationSupersededError,
  isOpenClawWizardSessionLost,
  isOpenClawWizardStepDesynchronized,
  isOpenClawWizardTerminalResult,
  type OpenClawWizardResult,
  type OpenClawWizardSessionScope,
  type OpenClawWizardStep,
} from "@/services/openclawWizard";
import { cacheGatewayTarget } from "./helpers";
import type { StepStatus, WizardRecoveryMode } from "./types";
import { wizardFailureDestination } from "./setupPreflight";
import { sanitizeSetupDiagnostic } from "@/services/setup/setupDiagnostic";
import {
  performOpenClawSetupHandoff,
} from "@/services/setup/openClawSetupHandoff";
import {
  reconcileWizardSessionLoss,
} from "@/services/setup/setupCompletionGate";
import { resolveGatewayConnectionTarget } from "@/services/gateway/GatewayConnectionTargetResolver";
import { readOpenClawConfigApplicationEvidence } from "@/services/gateway/OpenClawConfigApplicationClient";

const WIZARD_COMPLETION_RECONNECT_SOURCE = "wizard-completion";
const WIZARD_SESSION_RECOVERY_RECONNECT_SOURCE = "wizard-session-recovery";

export interface WizardSessionPorts {
  setupStep: SetupStep;
  report: (message: string, nextProgress?: number) => void;
  patchStep: (id: string, status: StepStatus, detail?: string) => void;
  updateOnboardingRequirement: (required: boolean) => void;
  appendSetupLog: (log: Omit<SetupLog, "ts"> & { ts?: number }) => void;
  replaceSetupStep: (step: SetupStep) => void;
  setPostStorageStep: (step: PostStorageStep) => void;
  setSetupError: (error: string | null) => void;
  setGatewayRunning: (running: boolean) => void;
}

class OpenClawWizardGatewayConnectionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenClawWizardGatewayConnectionTimeoutError";
  }
}

class OpenClawWizardTerminalUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenClawWizardTerminalUnknownError";
  }
}

class OpenClawWizardRecoveryVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenClawWizardRecoveryVerificationError";
  }
}

export function useWizardSession({
  setupStep,
  report,
  patchStep,
  updateOnboardingRequirement,
  appendSetupLog,
  replaceSetupStep,
  setPostStorageStep,
  setSetupError,
  setGatewayRunning,
}: WizardSessionPorts) {
  const { t } = useTranslation();
  const [wizardStep, setWizardStep] = useState<OpenClawWizardStep | null>(null);
  const [wizardSubmitting, setWizardSubmitting] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [wizardRecoveryMode, setWizardRecoveryModeState] = useState<WizardRecoveryMode>(null);
  const [wizardActivity, setWizardActivity] = useState<string | null>(null);
  const wizardSubmitInFlightRef = useRef(false);
  const wizardNavigationInFlightRef = useRef<"next" | null>(null);
  const wizardRecoveryInFlightRef = useRef<"retry" | "reclaim" | null>(null);
  const wizardOperationRef = useRef(0);
  const wizardSessionScopeRef = useRef<OpenClawWizardSessionScope | null>(null);
  const wizardRecoveryModeRef = useRef<WizardRecoveryMode>(null);
  const wizardClientRef = useRef<OpenClawWizardClient | null>(null);
  if (!wizardClientRef.current) {
    wizardClientRef.current = new OpenClawWizardClient(
      (method, params, options) => gateway.callPrivileged(method, params, options),
      createScopedOpenClawWizardSessionStore(() => wizardSessionScopeRef.current),
    );
  }
  const setWizardRecoveryMode = useCallback((mode: WizardRecoveryMode) => {
    wizardRecoveryModeRef.current = mode;
    setWizardRecoveryModeState(mode);
  }, []);
  const wizardFailureMessage = useCallback((error: unknown): string => {
    const diagnostic = sanitizeSetupDiagnostic(error instanceof Error ? error.message : error);
    appendSetupLog({
      source: "setup",
      step: "gateway",
      message: diagnostic,
      level: "error",
    });
    if (error instanceof GatewayPrivilegedAuthorizationError) {
      return diagnostic;
    }
    if (error instanceof OpenClawWizardGatewayConnectionTimeoutError) {
      return diagnostic;
    }
    if (
      error instanceof OpenClawWizardTerminalUnknownError
      || error instanceof OpenClawWizardRecoveryVerificationError
    ) {
      return diagnostic;
    }
    switch (classifyOpenClawWizardFailure(error)) {
      case "session_lost":
        return t("setup.wizard.sessionExpired", "OpenClaw 配置会话已失效，请重新连接。");
      case "step_desynchronized":
        return t("setup.wizard.stepSynchronizing", "正在恢复 OpenClaw 配置会话，请稍候。");
      case "already_running":
        return t("setup.wizard.alreadyRunning", "另一个 OpenClaw 配置会话仍在运行，请完成或关闭后重试。");
      case "request_timeout":
        return t("setup.wizard.requestTimeout", "OpenClaw 配置请求等待超时，请重新连接后继续。");
      case "protocol_unsupported":
        return t("setup.wizard.protocolIncompatible", "OpenClaw Gateway 返回 INVALID_REQUEST，并明确拒绝 wizard.start.installDaemon。JunQi 需要该参数关闭 Wizard 的 Gateway service 安装分支，不能安全省略，也不会重复发送同一无效请求。");
      case "cancelled":
        return t("setup.wizard.cancelled", "OpenClaw 配置向导已取消，请重试以开始新的配置会话。");
      case "unknown": {
        const sessionId = wizardClientRef.current?.diagnosticSessionId ?? "(none)";
        const lastStepId = wizardClientRef.current?.failedStepView?.id
          ?? wizardClientRef.current?.currentStepView?.id
          ?? "(unknown)";
        return diagnostic.startsWith("OpenClaw wizard failed at step ")
          ? diagnostic
          : `OpenClaw wizard failed at step "${lastStepId}" (session=${sessionId}): ${diagnostic}`;
      }
    }
  }, [appendSetupLog, t]);
  const wizardRecoveryModeForFailure = useCallback((
    error: unknown,
    fallback: WizardRecoveryMode = "wizard",
  ): WizardRecoveryMode => {
    if (error instanceof OpenClawWizardTerminalUnknownError) return "terminal-unknown";
    if (error instanceof OpenClawWizardRecoveryVerificationError) return "session";
    const failure = classifyOpenClawWizardFailure(error);
    if (failure === "already_running") return "reclaim";
    if (failure === "protocol_unsupported") return "protocol-incompatible";
    return fallback;
  }, []);
  const invalidateWizardOperations = useCallback(() => {
    wizardOperationRef.current += 1;
    wizardSubmitInFlightRef.current = false;
    wizardNavigationInFlightRef.current = null;
    wizardRecoveryInFlightRef.current = null;
    wizardClientRef.current?.invalidatePendingOperations();
    gateway.cancelActivePrivilegedRequest();
  }, []);

  const beginWizardOperation = useCallback(() => {
    // 管理 RPC 通道串行执行；先废弃旧的临时请求，避免被中断的轮询阻塞新的向导操作。
    wizardClientRef.current?.invalidatePendingOperations();
    gateway.cancelActivePrivilegedRequest();
    const operationId = wizardOperationRef.current + 1;
    wizardOperationRef.current = operationId;
    // 被替代的提交不会进入释放重入锁的分支；锁属于当前操作，因此接管时同步接管该锁。
    // `submitWizardStep` 会先读取此锁，双击保护不会受影响。
    wizardSubmitInFlightRef.current = false;
    wizardNavigationInFlightRef.current = null;
    wizardRecoveryInFlightRef.current = null;
    return operationId;
  }, []);

  const showWizardActivity = useCallback((message: string) => {
    setWizardActivity(message);
    appendSetupLog({ source: "setup", step: "wizard", message, level: "info" });
  }, [appendSetupLog]);

  const assertWizardOperationCurrent = useCallback((operationId: number) => {
    if (wizardOperationRef.current !== operationId) {
      throw new OpenClawWizardOperationSupersededError();
    }
  }, []);

  const refreshWizardSessionScope = useCallback(async () => {
    try {
      const target = await detectGatewayConfig();
      cacheGatewayTarget(target.port);
      const gatewayWsUrl = target.ws_url;
      if (!gatewayWsUrl) {
        wizardSessionScopeRef.current = null;
        return null;
      }
      wizardSessionScopeRef.current = {
        runtimeMode: target.runtime_mode,
        gatewayWsUrl,
      };
      return target;
    } catch (error) {
      wizardSessionScopeRef.current = null;
      throw error;
    }
  }, []);

  const refreshGatewayConnectionTarget = useCallback(async () => {
    const target = await refreshWizardSessionScope();
    if (!target?.ws_url) {
      throw new Error(t(
        "setup.wizard.selectedRuntimeTargetUnavailable",
        "所选 OpenClaw Runtime 未提供可连接的 Gateway 地址。",
      ));
    }
    // 官方向导可能重写端点或共享凭据。这里统一走所选 Runtime 解析器，读取失败
    // 必须停止交接，不能退回旧内存令牌或其他 Runtime 的设备凭据。
    const connectionTarget = await resolveGatewayConnectionTarget({
      targetScope: "selected-runtime",
    });
    gatewayManager.connect(
      connectionTarget.wsUrl,
      connectionTarget.token,
      connectionTarget.deviceToken,
    );
  }, [refreshWizardSessionScope, t]);

  const waitForGatewayConnection = useCallback(async (operationId: number, timeoutMs = 20_000) => {
    if (!captureCurrentAttestedGatewayConnectionId()) await refreshGatewayConnectionTarget();
    else await refreshWizardSessionScope();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      assertWizardOperationCurrent(operationId);
      if (captureCurrentAttestedGatewayConnectionId()) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assertWizardOperationCurrent(operationId);
    throw new OpenClawWizardGatewayConnectionTimeoutError(t(
      "setup.wizard.connectionTimeout",
      "Gateway 进程已就绪，但 JunQi 未能在限定时间内完成认证连接与运行时身份核验。",
    ));
  }, [assertWizardOperationCurrent, refreshGatewayConnectionTarget, refreshWizardSessionScope, t]);

  const startManagedWizardSession = useCallback(() => {
    // JunQi 已在运行时阶段安装并启动 Gateway。官方 Wizard 仅负责配置，
    // 否则 QuickStart 可能重启承载该进程内 Wizard 会话的 Gateway，使终态无法回收。
    return wizardClientRef.current!.start({ installDaemon: false });
  }, []);

  const completeWizardRuntime = useCallback(async (operationId: number): Promise<boolean> => {
    assertWizardOperationCurrent(operationId);
    setWizardStep(null);
    setWizardRecoveryMode("runtime");
    try {
      const handoff = await performOpenClawSetupHandoff({
        waitForLifecycleIdle: (boundary) => gatewayLifecycle.waitForIdle(boundary),
        isLifecycleReceiptCurrent: (receipt) => gatewayLifecycle.isIdleReceiptCurrent(receipt),
        captureAttestedConnectionId: captureCurrentAttestedGatewayConnectionId,
        isAttestedConnectionCurrent: isAttestedGatewayConnectionCurrent,
        reconnectSelectedRuntime: async (boundary) => {
          const result = await gatewayLifecycle.reconnectSelectedRuntimeAfterCurrent(
            WIZARD_COMPLETION_RECONNECT_SOURCE,
            boundary,
          );
          return {
            success: result.success && !result.superseded,
            ...(result.connectionId ? { connectionId: result.connectionId } : {}),
            ...(result.error ? { diagnostic: result.error } : {}),
          };
        },
        restartSelectedRuntime: async (boundary, configRevisionHash) => {
          const result = await gatewayLifecycle.restartAfterCurrent(
            "wizard-reload-disabled",
            "OpenClaw configuration reload is disabled",
            boundary,
            configRevisionHash,
          );
          return {
            success: result.success && !result.superseded,
            ...(result.connectionId ? { connectionId: result.connectionId } : {}),
            ...(result.error ? { diagnostic: result.error } : {}),
          };
        },
        probeSelectedGateway: () => probeSelectedGateway().catch(() => false),
        readConfigApplication: readOpenClawConfigApplicationEvidence,
      }, {
        kind: "classic-wizard-terminal",
      });
      assertWizardOperationCurrent(operationId);
      if (!handoff.ready) {
        if (handoff.diagnostic) {
          appendSetupLog({
            source: "setup",
            step: "gateway",
            message: sanitizeSetupDiagnostic(handoff.diagnostic),
            level: "error",
          });
        }
        throw new Error(t(
          `setup.handoff.${handoff.reason}`,
          "OpenClaw 配置已结束，但 JunQi 尚未完成运行时交接。请核验当前连接后重试。",
        ));
      }
    } catch (handoffError) {
      // 已废弃操作不能提交界面；仍有效的失败只进入 Runtime 核验，不回到 Wizard。
      assertWizardOperationCurrent(operationId);
      const message = sanitizeSetupDiagnostic(
        handoffError instanceof Error ? handoffError.message : handoffError,
      );
      setWizardStep(null);
      setWizardRecoveryMode("runtime");
      setWizardActivity(null);
      setWizardError(message);
      setGatewayRunning(false);
      patchStep("gateway", "error", message);
      appendSetupLog({ source: "setup", step: "gateway", message, level: "error" });
      setSetupError(message);
      report(message);
      replaceSetupStep("configure-openclaw");
      return false;
    }
    setWizardStep(null);
    setWizardActivity(null);
    setWizardError(null);
    setWizardRecoveryMode(null);
    setSetupError(null);
    setGatewayRunning(true);
    updateOnboardingRequirement(false);
    setPostStorageStep("ready");
    report(t("setup.ready"), 100);
    replaceSetupStep("ready");
    return true;
  }, [appendSetupLog, assertWizardOperationCurrent, patchStep, replaceSetupStep, report, setGatewayRunning, setPostStorageStep, setSetupError, setWizardRecoveryMode, t, updateOnboardingRequirement]);

  const applyWizardResult = useCallback(async (
    result: OpenClawWizardResult,
    operationId: number,
    navigateOnStep = true,
  ): Promise<OpenClawWizardResult> => {
    assertWizardOperationCurrent(operationId);
    const terminal = isOpenClawWizardTerminalResult(result);
    if (result.error || (terminal && result.status === "error")) {
      // 终端错误保留 Gateway 原始诊断和当前会话上下文，避免通用文案掩盖协议失败。
      const rawError = sanitizeSetupDiagnostic(
        result.error || t("setup.wizard.failed", "OpenClaw 配置向导执行失败。"),
      );
      const sessionId = wizardClientRef.current?.diagnosticSessionId ?? "(none)";
      const lastStepId = wizardClientRef.current?.failedStepView?.id
        ?? wizardClientRef.current?.currentStepView?.id
        ?? "(unknown)";
      const debugMessage = `OpenClaw wizard failed at step "${lastStepId}" (session=${sessionId}): ${rawError}`;
      appendSetupLog({ source: "setup", step: "wizard", message: debugMessage, level: "error" });
      throw new Error(debugMessage);
    }
    if (terminal && result.status === "cancelled") {
      setWizardStep(null);
      setWizardRecoveryMode(null);
      throw new OpenClawWizardCancelledError();
    }
    if (terminal && result.status === "done") {
      await completeWizardRuntime(operationId);
      return result;
    }
    if (!result.step) {
      throw new Error(t("setup.wizard.missingStep", "OpenClaw 配置向导没有返回下一步。"));
    }
    setWizardStep(result.step);
    report(result.step.title || result.step.message || t("setup.wizard.title", "配置 OpenClaw"), 82);
    if (navigateOnStep) replaceSetupStep("configure-openclaw");
    return result;
  }, [appendSetupLog, assertWizardOperationCurrent, completeWizardRuntime, report, replaceSetupStep, setWizardRecoveryMode, t]);

  const reconcileLostWizardSession = useCallback(async (
    operationId: number,
  ): Promise<null> => {
    wizardClientRef.current!.forgetSession();
    setWizardStep(null);
    setWizardRecoveryMode("session");
    try {
      showWizardActivity(t(
        "setup.wizard.sessionRecoveryChecking",
        "配置会话已断开，正在重新连接当前 Gateway 并恢复原会话…",
      ));
      const reconnected = await gatewayLifecycle.reconnectSelectedRuntimeAfterCurrent(WIZARD_SESSION_RECOVERY_RECONNECT_SOURCE);
      assertWizardOperationCurrent(operationId);
      if (!reconnected.success) {
        throw new Error(reconnected.error || t(
          "setup.wizard.connectionTimeout",
          "Gateway 进程已就绪，但 JunQi 未能在限定时间内完成认证连接与运行时身份核验。",
        ));
      }
      const reconciliation = await reconcileWizardSessionLoss({
        probeGateway: () => probeSelectedGateway().catch(() => false),
      });
      assertWizardOperationCurrent(operationId);
      if (reconciliation.state === "terminal-unknown") {
        throw new OpenClawWizardTerminalUnknownError(t(
          "setup.wizard.sessionTerminalUnknown",
          "原 OpenClaw 配置会话在返回最终结果前已失效，当前无法核验它是完成还是失败。JunQi 不会自动重放；重新开始可能再次执行配置写入，请确认后继续。",
        ));
      }
      throw new Error(t(
        "setup.wizard.sessionRecoveryUnavailable",
        "原 OpenClaw 配置会话已失效，当前 Gateway 尚不可核验。请恢复连接后重新核验。",
      ));
    } catch (error) {
      if (
        error instanceof OpenClawWizardOperationSupersededError
        || error instanceof OpenClawWizardTerminalUnknownError
        || error instanceof OpenClawWizardRecoveryVerificationError
      ) throw error;
      throw new OpenClawWizardRecoveryVerificationError(sanitizeSetupDiagnostic(
        error instanceof Error ? error.message : error,
      ));
    }
  }, [assertWizardOperationCurrent, setWizardRecoveryMode, showWizardActivity, t]);

  const recoverAfterGatewayHandoff = useCallback(async (
    operationId: number,
  ): Promise<OpenClawWizardResult | null> => {
    const reconnected = await gatewayLifecycle.reconnectSelectedRuntimeAfterCurrent(WIZARD_SESSION_RECOVERY_RECONNECT_SOURCE);
    assertWizardOperationCurrent(operationId);
    if (!reconnected.success) {
      throw new OpenClawWizardRecoveryVerificationError(reconnected.error || t(
        "setup.wizard.connectionTimeout",
        "Gateway 进程已就绪，但 JunQi 未能在限定时间内完成认证连接与运行时身份核验。",
      ));
    }
    const client = wizardClientRef.current!;
    try {
      return await client.resume();
    } catch (error) {
      if (!isOpenClawWizardSessionLost(error)) throw error;
      return await reconcileLostWizardSession(operationId);
    }
  }, [assertWizardOperationCurrent, reconcileLostWizardSession, t]);

  const startOfficialOnboarding = useCallback(async (
    surfaceFailureOnConfigurationPage = true,
    navigateOnStep = true,
  ): Promise<OpenClawWizardResult | null> => {
    const operationId = beginWizardOperation();
    setWizardError(null);
    setWizardRecoveryMode(null);
    setWizardSubmitting(true);
    try {
      showWizardActivity(t("setup.wizard.connectingGateway", "正在连接 OpenClaw Gateway…"));
      await waitForGatewayConnection(operationId);
      assertWizardOperationCurrent(operationId);
      const client = wizardClientRef.current!;
      let result: OpenClawWizardResult;
      if (client.hasActiveSession) {
        showWizardActivity(t("setup.wizard.inspectingSession", "正在检查已有的 OpenClaw 配置会话…"));
        try {
          result = await client.resume();
        } catch (error) {
          if (!isOpenClawWizardSessionLost(error)) throw error;
          return await reconcileLostWizardSession(operationId);
        }
      } else {
        showWizardActivity(t("setup.wizard.startingSession", "正在启动 OpenClaw 官方配置向导…"));
        result = await startManagedWizardSession();
      }
      assertWizardOperationCurrent(operationId);
      return await applyWizardResult(result, operationId, navigateOnStep);
    } catch (error) {
      if (error instanceof OpenClawWizardOperationSupersededError) return null;
      const message = wizardFailureMessage(error);
      const recoveryMode = wizardRecoveryModeForFailure(error);
      setWizardRecoveryMode(recoveryMode);
      setWizardActivity(null);
      setWizardError(message);
      setSetupError(message);
      const failureDestination = wizardFailureDestination(
        surfaceFailureOnConfigurationPage,
        recoveryMode,
      );
      if (failureDestination) {
        replaceSetupStep(failureDestination);
      } else {
        throw new Error(message);
      }
      return null;
    } finally {
      if (wizardOperationRef.current === operationId) setWizardSubmitting(false);
    }
  }, [applyWizardResult, assertWizardOperationCurrent, beginWizardOperation, reconcileLostWizardSession, replaceSetupStep, report, setPostStorageStep, setSetupError, setWizardRecoveryMode, showWizardActivity, startManagedWizardSession, t, updateOnboardingRequirement, waitForGatewayConnection, wizardFailureMessage, wizardRecoveryModeForFailure]);

  const resumeOfficialOnboarding = useCallback(async (): Promise<OpenClawWizardResult | null> => {
    const operationId = beginWizardOperation();
    setWizardError(null);
    setWizardRecoveryMode(null);
    setWizardSubmitting(true);
    try {
      showWizardActivity(t("setup.wizard.connectingGateway", "正在连接 OpenClaw Gateway…"));
      await waitForGatewayConnection(operationId);
      showWizardActivity(t("setup.wizard.inspectingSession", "正在检查已有的 OpenClaw 配置会话…"));
      const result = await wizardClientRef.current!.resume();
      assertWizardOperationCurrent(operationId);
      return await applyWizardResult(result, operationId);
    } catch (error) {
      if (error instanceof OpenClawWizardOperationSupersededError) return null;
      let failure = error;
      if (isOpenClawWizardSessionLost(error)) {
        try {
          return await reconcileLostWizardSession(operationId);
        } catch (recoveryError) {
          if (recoveryError instanceof OpenClawWizardOperationSupersededError) return null;
          failure = recoveryError;
        }
      }
      const message = wizardFailureMessage(failure);
      setWizardRecoveryMode(wizardRecoveryModeForFailure(failure));
      setWizardActivity(null);
      setWizardError(message);
      setSetupError(message);
      replaceSetupStep("configure-openclaw");
      return null;
    } finally {
      if (wizardOperationRef.current === operationId) setWizardSubmitting(false);
    }
  }, [applyWizardResult, assertWizardOperationCurrent, beginWizardOperation, reconcileLostWizardSession, replaceSetupStep, setSetupError, setWizardRecoveryMode, showWizardActivity, t, waitForGatewayConnection, wizardFailureMessage, wizardRecoveryModeForFailure]);

  const submitWizardStep = useCallback(async (stepId: string, value?: unknown) => {
    // React 状态更新异步。终态说明在按钮进入提交态前可能收到双击，第二个请求会与官方
    // 终态响应竞争并在完成后得到 "wizard not found"。
    if (wizardNavigationInFlightRef.current) return null;
    const operationId = beginWizardOperation();
    wizardSubmitInFlightRef.current = true;
    wizardNavigationInFlightRef.current = "next";
    setWizardError(null);
    setWizardRecoveryMode(null);
    setWizardSubmitting(true);
    try {
      await waitForGatewayConnection(operationId);
      const result = await wizardClientRef.current!.next(stepId, value);
      assertWizardOperationCurrent(operationId);
      return await applyWizardResult(result, operationId);
    } catch (error) {
      if (error instanceof OpenClawWizardOperationSupersededError) return null;
      if (
        error instanceof GatewayPrivilegedSourceChangedError
        || /gateway (?:connection|credentials) (?:changed|closed)|verified gateway connection changed/i.test(
          error instanceof Error ? error.message : String(error),
        )
      ) {
        try {
          const result = await recoverAfterGatewayHandoff(operationId);
          assertWizardOperationCurrent(operationId);
          if (!result) return null;
          return await applyWizardResult(result, operationId);
        } catch (recoveryError) {
          error = recoveryError;
        }
      }
      if (isOpenClawWizardStepDesynchronized(error)) {
        return await resumeOfficialOnboarding();
      }
      if (isOpenClawWizardSessionLost(error)) {
        try {
          return await reconcileLostWizardSession(operationId);
        } catch (recoveryError) {
          if (recoveryError instanceof OpenClawWizardOperationSupersededError) return null;
          error = recoveryError;
        }
      }
      const message = wizardFailureMessage(error);
      setWizardRecoveryMode(wizardRecoveryModeForFailure(error));
      setWizardError(message);
      setSetupError(message);
      return null;
    } finally {
      if (wizardOperationRef.current === operationId) {
        wizardSubmitInFlightRef.current = false;
        wizardNavigationInFlightRef.current = null;
        setWizardSubmitting(false);
      }
    }
  }, [applyWizardResult, assertWizardOperationCurrent, beginWizardOperation, reconcileLostWizardSession, recoverAfterGatewayHandoff, resumeOfficialOnboarding, setSetupError, setWizardRecoveryMode, waitForGatewayConnection, wizardFailureMessage, wizardRecoveryModeForFailure]);

  const retryOfficialOnboarding = useCallback(async (): Promise<OpenClawWizardResult | null> => {
    if (wizardRecoveryInFlightRef.current || wizardNavigationInFlightRef.current) return null;
    const operationId = beginWizardOperation();
    wizardRecoveryInFlightRef.current = "retry";
    setWizardError(null);
    const recoveryMode = wizardRecoveryModeRef.current;
    setWizardRecoveryMode(recoveryMode);
    setWizardSubmitting(true);
    try {
      if (recoveryMode === "runtime") {
        await completeWizardRuntime(operationId);
        return null;
      }
      if (recoveryMode === "session") {
        return await reconcileLostWizardSession(operationId);
      }
      if (recoveryMode === "terminal-unknown") {
        await waitForGatewayConnection(operationId);
        wizardClientRef.current!.forgetSession();
        const restarted = await startManagedWizardSession();
        assertWizardOperationCurrent(operationId);
        return await applyWizardResult(restarted, operationId);
      }
      await waitForGatewayConnection(operationId);
      let result: OpenClawWizardResult;
      try {
        result = await wizardClientRef.current!.retry();
      } catch (error) {
        if (!isOpenClawWizardSessionLost(error)) throw error;
        return await reconcileLostWizardSession(operationId);
      }
      assertWizardOperationCurrent(operationId);
      return await applyWizardResult(result, operationId);
    } catch (error) {
      if (error instanceof OpenClawWizardOperationSupersededError) return null;
      const message = wizardFailureMessage(error);
      setWizardRecoveryMode(wizardRecoveryModeForFailure(error, recoveryMode || "wizard"));
      setWizardError(message);
      setSetupError(message);
      replaceSetupStep("configure-openclaw");
      return null;
    } finally {
      if (wizardOperationRef.current === operationId) {
        wizardRecoveryInFlightRef.current = null;
        setWizardSubmitting(false);
      }
    }
  }, [applyWizardResult, assertWizardOperationCurrent, beginWizardOperation, completeWizardRuntime, reconcileLostWizardSession, replaceSetupStep, setSetupError, setWizardRecoveryMode, startManagedWizardSession, waitForGatewayConnection, wizardFailureMessage, wizardRecoveryModeForFailure]);

  const pollOfficialOnboarding = useCallback(async (): Promise<OpenClawWizardResult | null> => {
    if (wizardNavigationInFlightRef.current || wizardRecoveryInFlightRef.current) return null;
    return await resumeOfficialOnboarding();
  }, [resumeOfficialOnboarding]);

  const clearWizardFailure = useCallback(() => {
    invalidateWizardOperations();
    setWizardActivity(null);
    setWizardError(null);
    setWizardRecoveryMode(null);
    setWizardSubmitting(false);
    setSetupError(null);
  }, [invalidateWizardOperations, setSetupError, setWizardRecoveryMode]);

  const reclaimOfficialOnboarding = useCallback(async (): Promise<OpenClawWizardResult | null> => {
    if (wizardRecoveryInFlightRef.current || wizardNavigationInFlightRef.current) return null;
    const operationId = beginWizardOperation();
    wizardRecoveryInFlightRef.current = "reclaim";
    setWizardError(null);
    setWizardRecoveryMode(null);
    setWizardSubmitting(true);
    try {
      // OpenClaw 没有枚举其他客户端向导的接口。重启所选运行时只清除进程内会话锁，
      // 不改变所选数据目录、工作区或配置。
      wizardClientRef.current!.forgetSession();
      const restarted = await gatewayLifecycle.restart("wizard-reclaim");
      if (restarted?.success === false) {
        throw new Error(restarted.error || "OpenClaw Gateway restart failed.");
      }
      await waitForGatewayConnection(operationId);
      const result = await startManagedWizardSession();
      assertWizardOperationCurrent(operationId);
      return await applyWizardResult(result, operationId);
    } catch (error) {
      if (error instanceof OpenClawWizardOperationSupersededError) return null;
      const message = wizardFailureMessage(error);
      setWizardRecoveryMode(wizardRecoveryModeForFailure(error));
      setWizardError(message);
      setSetupError(message);
      replaceSetupStep("configure-openclaw");
      return null;
    } finally {
      if (wizardOperationRef.current === operationId) {
        wizardRecoveryInFlightRef.current = null;
        setWizardSubmitting(false);
      }
    }
  }, [applyWizardResult, assertWizardOperationCurrent, beginWizardOperation, replaceSetupStep, setSetupError, setWizardRecoveryMode, startManagedWizardSession, waitForGatewayConnection, wizardFailureMessage, wizardRecoveryModeForFailure]);

  return {
    wizardStep,
    wizardSubmitting,
    wizardActivity,
    wizardError,
    wizardRecoveryMode,
    submitWizardStep,
    pollWizard: pollOfficialOnboarding,
    retryWizard: retryOfficialOnboarding,
    reclaimWizard: reclaimOfficialOnboarding,
    prepareWizard: () => startOfficialOnboarding(false, setupStep !== "configure-openclaw"),
    clearWizardFailure,
    invalidateWizardOperations,
    setWizardStep,
    setWizardError,
    setWizardSubmitting,
    isWizardOperationInFlight: () => Boolean(
      wizardNavigationInFlightRef.current || wizardRecoveryInFlightRef.current
    ),
  };
}
