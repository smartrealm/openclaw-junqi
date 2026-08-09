// 官方向导会话只投影 Gateway 持有的步骤和终态，不从本地配置推断会话结果。
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { SetupStep } from "@/stores/setup-navigation";
import type { PostStorageStep, SetupLog } from "@/stores/app-store";
import {
  gateway,
  GatewayPrivilegedAuthorizationError,
  GatewayPrivilegedSourceChangedError,
} from "@/services/gateway";
import { gatewayManager } from "@/services/gateway/GatewayConnectionManager";
import { gatewayLifecycle } from "@/runtime/gatewayLifecycle";
import {
  detectGatewayConfig,
  getGatewayToken,
  handoffGatewayToOfficialService,
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
  type OpenClawWizardResult,
  type OpenClawWizardSessionScope,
  type OpenClawWizardStep,
} from "@/services/openclawWizard";
import { cacheGatewayTarget } from "./helpers";
import type { StepStatus } from "./types";
import { sanitizeSetupDiagnostic } from "@/services/setup/setupDiagnostic";
import { getGatewayDeviceCredentialForUrl } from "@/services/gateway/credentialProvider";
import type { SetupInferenceVerification } from "@/services/setup/setupCompletionGate";

const GATEWAY_HANDOFF_CONNECTION_TIMEOUT_MS = 120_000;

export interface WizardSessionPorts {
  setupStep: SetupStep;
  report: (message: string, nextProgress?: number) => void;
  patchStep: (id: string, status: StepStatus, detail?: string) => void;
  verifyConfiguredInference: () => Promise<SetupInferenceVerification>;
  updateOnboardingRequirement: (required: boolean) => void;
  appendSetupLog: (log: Omit<SetupLog, "ts"> & { ts?: number }) => void;
  replaceSetupStep: (step: SetupStep) => void;
  setPostStorageStep: (step: PostStorageStep) => void;
  setSetupError: (error: string | null) => void;
  setGatewayRunning: (running: boolean) => void;
  navigationLeavingRef: RefObject<boolean>;
}

class OpenClawWizardGatewayConnectionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenClawWizardGatewayConnectionTimeoutError";
  }
}

export function useWizardSession({
  setupStep,
  report,
  patchStep,
  verifyConfiguredInference,
  updateOnboardingRequirement,
  appendSetupLog,
  replaceSetupStep,
  setPostStorageStep,
  setSetupError,
  setGatewayRunning,
  navigationLeavingRef,
}: WizardSessionPorts) {
  const { t } = useTranslation();
  const [wizardStep, setWizardStep] = useState<OpenClawWizardStep | null>(null);
  const [wizardSubmitting, setWizardSubmitting] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [wizardRecoveryRequired, setWizardRecoveryRequired] = useState(false);
  const [wizardActivity, setWizardActivity] = useState<string | null>(null);
  const wizardSubmitInFlightRef = useRef(false);
  const wizardNavigationInFlightRef = useRef<"next" | null>(null);
  const wizardRecoveryInFlightRef = useRef<"retry" | "reclaim" | null>(null);
  const wizardOperationRef = useRef(0);
  const wizardSessionScopeRef = useRef<OpenClawWizardSessionScope | null>(null);
  const wizardClientRef = useRef<OpenClawWizardClient | null>(null);
  if (!wizardClientRef.current) {
    wizardClientRef.current = new OpenClawWizardClient(
      (method, params, options) => gateway.callPrivileged(method, params, options),
      createScopedOpenClawWizardSessionStore(() => wizardSessionScopeRef.current),
    );
  }
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
    switch (classifyOpenClawWizardFailure(error)) {
      case "session_lost":
        return t("setup.wizard.sessionExpired", "OpenClaw 配置会话已失效，请重新连接。");
      case "step_desynchronized":
        return t("setup.wizard.stepSynchronizing", "正在恢复 OpenClaw 配置会话，请稍候。");
      case "already_running":
        return t("setup.wizard.alreadyRunning", "另一个 OpenClaw 配置会话仍在运行，请完成或关闭后重试。");
      case "request_timeout":
        return t("setup.wizard.requestTimeout", "OpenClaw 配置请求等待超时，请重新连接后继续。");
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
    } catch {
      wizardSessionScopeRef.current = null;
      return null;
    }
  }, []);

  const refreshGatewayConnectionTarget = useCallback(async () => {
    try {
      const target = await refreshWizardSessionScope();
      if (!target?.ws_url) {
        gatewayManager.reconnect();
        return false;
      }
      const gatewayWsUrl = target.ws_url;
      // 官方向导可能在安装或重启服务前写入最终 Gateway token，必须重新读取，不能沿用
      // 启动进程的内存凭据。
      const token = String(await getGatewayToken().catch(() => target.token || "")).trim();
      const deviceToken = (await getGatewayDeviceCredentialForUrl(gatewayWsUrl)).token ?? '';
      gatewayManager.connect(gatewayWsUrl, token, deviceToken);
      return true;
    } catch {
      // The normal connection resolver can still read settings/config later.
      gatewayManager.reconnect();
      return false;
    }
  }, [refreshWizardSessionScope]);

  const waitForGatewayConnection = useCallback(async (operationId: number, timeoutMs = 20_000) => {
    if (!gateway.getStatus().connected) await refreshGatewayConnectionTarget();
    else await refreshWizardSessionScope();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      assertWizardOperationCurrent(operationId);
      if (gateway.getStatus().connected) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assertWizardOperationCurrent(operationId);
    throw new OpenClawWizardGatewayConnectionTimeoutError(t(
      "setup.wizard.connectionTimeout",
      "Gateway 进程已就绪，但 JunQi 未能在限定时间内完成经认证的 Gateway 连接。",
    ));
  }, [assertWizardOperationCurrent, refreshGatewayConnectionTarget, refreshWizardSessionScope, t]);

  const applyWizardResult = useCallback(async (
    result: OpenClawWizardResult,
    operationId: number,
  ): Promise<OpenClawWizardResult> => {
    assertWizardOperationCurrent(operationId);
    if (result.error || result.status === "error") {
      // 终端错误往往包含 Gateway 的真实诊断(`wizard: ...` / JSON 校验失败
      // / 单会话冲突等),但此前统一替换成一句通用文案,导致同一症状
      // 会反复复现而拿不到根因。透传原文并附上当前会话上下文,异常发生时
      // 用户能直接看到错误并复贴给我们定位。
      const rawError = sanitizeSetupDiagnostic(
        result.error || t("setup.wizard.failed", "OpenClaw 配置向导执行失败。"),
      );
      const sessionId = wizardClientRef.current?.diagnosticSessionId ?? "(none)";
      const lastStepId = wizardClientRef.current?.failedStepView?.id
        ?? wizardClientRef.current?.currentStepView?.id
        ?? "(unknown)";
      const debugMessage = `OpenClaw wizard failed at step "${lastStepId}" (session=${sessionId}): ${rawError}`;
      appendSetupLog({
        source: "setup",
        step: "wizard",
        message: debugMessage,
        level: "error",
      });
      throw new Error(debugMessage);
    }
    if (result.status === "cancelled") {
      setWizardStep(null);
      throw new OpenClawWizardCancelledError();
    }
    if (result.done || result.status === "done") {
      // 官方会话已经终态，即使下方运行时交接失败也不能重放已接受的凭据；恢复只能重新
      // 核验 Gateway 所有权与所选配置身份。
      // 官方向导可能默认安装平台服务，宣布完成前必须收敛所有权，避免前台子进程与系统服务
      // 争用同一端口。
      try {
        await handoffGatewayToOfficialService();
        assertWizardOperationCurrent(operationId);
        await waitForGatewayConnection(operationId, GATEWAY_HANDOFF_CONNECTION_TIMEOUT_MS);
        assertWizardOperationCurrent(operationId);
        const selectedGatewayReady = await probeSelectedGateway();
        assertWizardOperationCurrent(operationId);
        if (!selectedGatewayReady) {
          throw new Error(t(
            "setup.wizard.handoffNotReady",
            "OpenClaw 配置已完成，但切换运行方式后无法验证所选 Gateway。请修复并重试。",
          ));
        }
        const verification = await verifyConfiguredInference();
        if (verification.status === "unavailable") {
          // 稳定版 Gateway 可能没有实时验证 RPC；记录待核验状态，不阻断官方向导完成。
          appendSetupLog({
            source: "setup",
            step: "gateway",
            message: t(
              "setup.wizard.inferenceVerificationUnavailable",
              "OpenClaw 配置已完成，但当前 Gateway 未提供官方实时模型验证。模型可用性暂未核验。",
            ),
            level: "warn",
          });
        }
        if (verification.status === "failed") {
          throw new Error(t(
            "setup.wizard.inferenceUnverified",
            "OpenClaw 配置已完成，但默认模型尚未通过实时验证。请修正模型或凭据后重试。",
          ));
        }
      } catch (handoffError) {
        // Rust 侧已完成的交接可能晚于渲染层导航；后续连接可继续观测，但已废弃的操作不能
        // 修改引导界面或启动后续探测。
        assertWizardOperationCurrent(operationId);
        const message = sanitizeSetupDiagnostic(
          handoffError instanceof Error ? handoffError.message : handoffError,
        );
        setWizardStep(null);
        setWizardRecoveryRequired(false);
        setGatewayRunning(false);
        patchStep("gateway", "error", message);
        appendSetupLog({ source: "setup", step: "gateway", message, level: "error" });
        setSetupError(message);
        report(message);
        replaceSetupStep("error");
        return result;
      }
      updateOnboardingRequirement(false);
      setWizardStep(null);
      setWizardError(null);
      setWizardRecoveryRequired(false);
      setSetupError(null);
      setPostStorageStep("ready");
      await refreshGatewayConnectionTarget();
      assertWizardOperationCurrent(operationId);
      report(t("setup.ready"), 100);
      replaceSetupStep("ready");
      return result;
    }
    if (!result.step) {
      throw new Error(t("setup.wizard.missingStep", "OpenClaw 配置向导没有返回下一步。"));
    }
    setWizardStep(result.step);
    report(result.step.title || result.step.message || t("setup.wizard.title", "配置 OpenClaw"), 82);
    replaceSetupStep("configure-openclaw");
    return result;
  }, [appendSetupLog, assertWizardOperationCurrent, refreshGatewayConnectionTarget, report, setGatewayRunning, setPostStorageStep, replaceSetupStep, setSetupError, t, updateOnboardingRequirement, verifyConfiguredInference]);

  const recoverAfterGatewayHandoff = useCallback(async (
    operationId: number,
  ): Promise<OpenClawWizardResult> => {
    await refreshGatewayConnectionTarget();
    await waitForGatewayConnection(operationId, GATEWAY_HANDOFF_CONNECTION_TIMEOUT_MS);
    assertWizardOperationCurrent(operationId);
    const client = wizardClientRef.current!;
    try {
      return await client.resume();
    } catch (error) {
      if (!isOpenClawWizardSessionLost(error)) throw error;
      // 向导会话只存在于 Gateway 进程内；官方终结流程可能在配置持久化后替换该进程。
      return await client.restartAfterSessionLoss();
    }
  }, [assertWizardOperationCurrent, refreshGatewayConnectionTarget, waitForGatewayConnection]);

  const startOfficialOnboarding = useCallback(async (): Promise<OpenClawWizardResult | null> => {
    const operationId = beginWizardOperation();
    setWizardError(null);
    setWizardRecoveryRequired(false);
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
          result = await client.restartAfterSessionLoss();
        }
      } else {
        showWizardActivity(t("setup.wizard.startingSession", "正在启动 OpenClaw 官方配置向导…"));
        result = await client.start();
      }
      assertWizardOperationCurrent(operationId);
      return await applyWizardResult(result, operationId);
    } catch (error) {
      if (error instanceof OpenClawWizardOperationSupersededError) return null;
      const message = wizardFailureMessage(error);
      setWizardRecoveryRequired(classifyOpenClawWizardFailure(error) === "already_running");
      setWizardActivity(null);
      setWizardError(message);
      setSetupError(message);
      replaceSetupStep("configure-openclaw");
      return null;
    } finally {
      if (wizardOperationRef.current === operationId) setWizardSubmitting(false);
    }
  }, [applyWizardResult, assertWizardOperationCurrent, beginWizardOperation, replaceSetupStep, setSetupError, showWizardActivity, t, waitForGatewayConnection, wizardFailureMessage]);

  const resumeOfficialOnboarding = useCallback(async (): Promise<OpenClawWizardResult | null> => {
    const operationId = beginWizardOperation();
    setWizardError(null);
    setWizardRecoveryRequired(false);
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
          const result = await wizardClientRef.current!.restartAfterSessionLoss();
          assertWizardOperationCurrent(operationId);
          return await applyWizardResult(result, operationId);
        } catch (recoveryError) {
          if (recoveryError instanceof OpenClawWizardOperationSupersededError) return null;
          failure = recoveryError;
        }
      }
      const message = wizardFailureMessage(failure);
      setWizardRecoveryRequired(classifyOpenClawWizardFailure(failure) === "already_running");
      setWizardActivity(null);
      setWizardError(message);
      setSetupError(message);
      replaceSetupStep("configure-openclaw");
      return null;
    } finally {
      if (wizardOperationRef.current === operationId) setWizardSubmitting(false);
    }
  }, [applyWizardResult, assertWizardOperationCurrent, beginWizardOperation, replaceSetupStep, setSetupError, showWizardActivity, t, waitForGatewayConnection, wizardFailureMessage]);

  const submitWizardStep = useCallback(async (stepId: string, value?: unknown) => {
    // React 状态更新异步。终态说明在按钮进入提交态前可能收到双击，第二个请求会与官方
    // 终态响应竞争并在完成后得到 "wizard not found"。
    if (wizardNavigationInFlightRef.current) return null;
    const operationId = beginWizardOperation();
    wizardSubmitInFlightRef.current = true;
    wizardNavigationInFlightRef.current = "next";
    setWizardError(null);
    setWizardRecoveryRequired(false);
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
          const result = await wizardClientRef.current!.restartAfterSessionLoss();
          assertWizardOperationCurrent(operationId);
          return await applyWizardResult(result, operationId);
        } catch (recoveryError) {
          if (recoveryError instanceof OpenClawWizardOperationSupersededError) return null;
          error = recoveryError;
        }
      }
      const message = wizardFailureMessage(error);
      setWizardRecoveryRequired(classifyOpenClawWizardFailure(error) === "already_running");
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
  }, [applyWizardResult, assertWizardOperationCurrent, beginWizardOperation, recoverAfterGatewayHandoff, resumeOfficialOnboarding, setSetupError, t, waitForGatewayConnection, wizardFailureMessage]);

  const retryOfficialOnboarding = useCallback(async (): Promise<OpenClawWizardResult | null> => {
    if (wizardRecoveryInFlightRef.current || wizardNavigationInFlightRef.current) return null;
    const operationId = beginWizardOperation();
    wizardRecoveryInFlightRef.current = "retry";
    setWizardError(null);
    setWizardRecoveryRequired(false);
    setWizardSubmitting(true);
    try {
      await waitForGatewayConnection(operationId);
      let result: OpenClawWizardResult;
      try {
        result = await wizardClientRef.current!.retry();
      } catch (error) {
        if (!isOpenClawWizardSessionLost(error)) throw error;
        // 官方终态与服务交接会清除进程内向导会话。重试时先从当前运行时的持久化配置
        // 恢复，不能把已回收的 sessionId 当作新的用户错误。
        result = await wizardClientRef.current!.restartAfterSessionLoss();
      }
      assertWizardOperationCurrent(operationId);
      return await applyWizardResult(result, operationId);
    } catch (error) {
      if (error instanceof OpenClawWizardOperationSupersededError) return null;
      const message = wizardFailureMessage(error);
      setWizardRecoveryRequired(classifyOpenClawWizardFailure(error) === "already_running");
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
  }, [applyWizardResult, assertWizardOperationCurrent, beginWizardOperation, replaceSetupStep, setSetupError, waitForGatewayConnection, wizardFailureMessage]);

  const pollOfficialOnboarding = useCallback(async (): Promise<OpenClawWizardResult | null> => {
    if (wizardNavigationInFlightRef.current || wizardRecoveryInFlightRef.current) return null;
    return await resumeOfficialOnboarding();
  }, [resumeOfficialOnboarding]);

  const reclaimOfficialOnboarding = useCallback(async (): Promise<OpenClawWizardResult | null> => {
    if (wizardRecoveryInFlightRef.current || wizardNavigationInFlightRef.current) return null;
    const operationId = beginWizardOperation();
    wizardRecoveryInFlightRef.current = "reclaim";
    setWizardError(null);
    setWizardRecoveryRequired(false);
    setWizardSubmitting(true);
    try {
      // OpenClaw exposes no API for enumerating another client's wizard. A
      // selected-runtime restart safely clears that in-memory lock without
      // changing the selected data directory, workspace, or configuration.
      wizardClientRef.current!.forgetSession();
      const restarted = await gatewayLifecycle.restart("wizard-reclaim");
      if (restarted?.success === false) {
        throw new Error(restarted.error || "OpenClaw Gateway restart failed.");
      }
      await waitForGatewayConnection(operationId);
      const result = await wizardClientRef.current!.start();
      assertWizardOperationCurrent(operationId);
      return await applyWizardResult(result, operationId);
    } catch (error) {
      if (error instanceof OpenClawWizardOperationSupersededError) return null;
      const message = wizardFailureMessage(error);
      setWizardRecoveryRequired(classifyOpenClawWizardFailure(error) === "already_running");
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
  }, [applyWizardResult, assertWizardOperationCurrent, beginWizardOperation, replaceSetupStep, setSetupError, waitForGatewayConnection, wizardFailureMessage]);

  const wizardAutoStartRef = useRef(false);
  useEffect(() => {
    if (setupStep !== "configure-openclaw") {
      wizardAutoStartRef.current = false;
      return;
    }
    if (navigationLeavingRef.current || wizardStep || wizardSubmitting || wizardError) return;
    if (wizardAutoStartRef.current) return;
    wizardAutoStartRef.current = true;
    void startOfficialOnboarding();
  }, [setupStep, startOfficialOnboarding, wizardError, wizardStep, wizardSubmitting]);

  return {
    wizardStep,
    wizardSubmitting,
    wizardActivity,
    wizardError,
    wizardRecoveryRequired,
    submitWizardStep,
    pollWizard: pollOfficialOnboarding,
    retryWizard: retryOfficialOnboarding,
    reclaimWizard: reclaimOfficialOnboarding,
    invalidateWizardOperations,
    setWizardStep,
    setWizardError,
    setWizardSubmitting,
    isWizardOperationInFlight: () => Boolean(
      wizardNavigationInFlightRef.current || wizardRecoveryInFlightRef.current
    ),
  };
}
