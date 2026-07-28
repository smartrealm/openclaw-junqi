// The official OpenClaw wizard session: version-guarded operations over one
// Gateway-owned session, plus the recovery paths for a lost or seized session.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { SetupStep } from "@/stores/setup-navigation";
import type { SetupLog } from "@/stores/app-store";
import {
  gateway,
  GatewayPrivilegedAuthorizationError,
  GatewayPrivilegedSourceChangedError,
} from "@/services/gateway";
import { gatewayManager } from "@/services/gateway/GatewayConnectionManager";
import { detectGatewayConfig, handoffGatewayToOfficialService } from "@/api/tauri-commands";
import {
  classifyOpenClawWizardFailure,
  createBrowserOpenClawWizardSessionStore,
  isOpenClawWizardCompletionStep,
  OpenClawWizardCancelledError,
  OpenClawWizardClient,
  OpenClawWizardOperationSupersededError,
  isOpenClawWizardSessionLost,
  isOpenClawWizardStepDesynchronized,
  type OpenClawWizardResult,
  type OpenClawWizardStep,
} from "@/services/openclawWizard";
import { cacheGatewayTarget } from "./helpers";
import type { StepStatus } from "./types";

export interface WizardSessionPorts {
  setupStep: SetupStep;
  report: (message: string, nextProgress?: number) => void;
  patchStep: (id: string, status: StepStatus, detail?: string) => void;
  probeActiveRuntimeModel: () => Promise<{ ready: boolean; model?: string | null; detail?: string | null }>;
  resolveActiveRuntimeOnboardingRequirement: () => Promise<boolean>;
  updateOnboardingRequirement: (required: boolean) => void;
  appendSetupLog: (log: Omit<SetupLog, "ts"> & { ts?: number }) => void;
  replaceSetupStep: (step: SetupStep) => void;
  setPostStorageStep: (step: any) => void;
  setSetupError: (error: string | null) => void;
  setGatewayRunning: (running: boolean) => void;
  navigationLeavingRef: RefObject<boolean>;
}

export function useWizardSession({
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
  navigationLeavingRef,
}: WizardSessionPorts) {
  const { t } = useTranslation();
  const [wizardStep, setWizardStep] = useState<OpenClawWizardStep | null>(null);
  const [wizardSubmitting, setWizardSubmitting] = useState(false);
  const [wizardCanGoBack, setWizardCanGoBack] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [wizardRecoveryRequired, setWizardRecoveryRequired] = useState(false);
  const [wizardActivity, setWizardActivity] = useState<string | null>(null);
  const wizardSubmitInFlightRef = useRef(false);
  const wizardNavigationInFlightRef = useRef<"next" | "back" | null>(null);
  const wizardRecoveryInFlightRef = useRef<"retry" | "reclaim" | null>(null);
  const wizardOperationRef = useRef(0);
  const wizardClientRef = useRef<OpenClawWizardClient | null>(null);
  if (!wizardClientRef.current) {
    wizardClientRef.current = new OpenClawWizardClient(
      (method, params, options) => gateway.callPrivileged(method, params, options),
      createBrowserOpenClawWizardSessionStore(),
    );
  }
  const wizardFailureMessage = useCallback((error: unknown): string => {
    const diagnostic = error instanceof Error ? error.message : String(error);
    appendSetupLog({
      source: "setup",
      step: "gateway",
      message: diagnostic,
      level: "error",
    });
    if (error instanceof GatewayPrivilegedAuthorizationError) {
      return diagnostic;
    }
    if (diagnostic === t("setup.wizard.connectionTimeout", "Gateway 已启动，但配置向导连接超时。")) {
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
      case "cancellation_locked":
        return t("setup.wizard.cancellationLocked", "OpenClaw 正在提交持久化配置，当前无法取消。请等待后继续当前会话。");
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
    // The admin RPC lane is serialized. Supersede any old Wizard-owned
    // transient request before queueing the replacement, otherwise an
    // interrupted no-answer poll can keep the new operation behind it.
    wizardClientRef.current?.invalidatePendingOperations();
    gateway.cancelActivePrivilegedRequest();
    const operationId = wizardOperationRef.current + 1;
    wizardOperationRef.current = operationId;
    // A superseded submit never reaches the branch that releases its re-entry
    // guard, because that branch is gated on still being the current operation.
    // The guard belongs to whichever operation is current, so taking over also
    // takes it over. `submitWizardStep` reads the guard before calling this, so
    // its own protection against double submits is unaffected.
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

  const refreshGatewayConnectionTarget = useCallback(async () => {
    try {
      const target = await detectGatewayConfig();
      cacheGatewayTarget(target.port);
      // The official wizard writes the final Gateway token before installing or
      // restarting its service. Re-read it instead of retaining the bootstrap
      // process' stale in-memory credential.
      const resolved = await window.aegis.config.get();
      const token = String(
        resolved?.gatewayBootstrapToken
          || target.token
          || resolved?.gatewayToken
          || "",
      ).trim();
      const deviceToken = String(resolved?.gatewayDeviceToken || "").trim();
      gatewayManager.connect(target.ws_url, token, deviceToken);
      return true;
    } catch {
      // The normal connection resolver can still read settings/config later.
      gatewayManager.reconnect();
      return false;
    }
  }, []);

  const waitForGatewayConnection = useCallback(async (operationId: number, timeoutMs = 20_000) => {
    if (!gateway.getStatus().connected) {
      await refreshGatewayConnectionTarget();
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      assertWizardOperationCurrent(operationId);
      if (gateway.getStatus().connected) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assertWizardOperationCurrent(operationId);
    throw new Error(t("setup.wizard.connectionTimeout", "Gateway 已启动，但配置向导连接超时。"));
  }, [assertWizardOperationCurrent, refreshGatewayConnectionTarget, t]);

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
      const rawError = result.error
        ? result.error
        : t("setup.wizard.failed", "OpenClaw 配置向导执行失败。");
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
      setWizardCanGoBack(false);
      throw new OpenClawWizardCancelledError();
    }
    if (result.done || result.status === "done") {
      // The official session is terminal even when the lifecycle handoff below
      // fails. Do not replay accepted model credentials on recovery; recover
      // only the Gateway owner and verify the selected config identity.
      // OpenClaw's official wizard may install its platform service by
      // default. Reconcile ownership before declaring setup complete so the
      // foreground bootstrap child and Scheduled Task never race on one port.
      try {
        await handoffGatewayToOfficialService();
        assertWizardOperationCurrent(operationId);
        const selectedGatewayReady = await invoke<boolean>("probe_selected_gateway", {});
        assertWizardOperationCurrent(operationId);
        if (!selectedGatewayReady) {
          throw new Error(t(
            "setup.wizard.handoffNotReady",
            "OpenClaw 配置已完成，但切换运行方式后无法验证所选 Gateway。请修复并重试。",
          ));
        }
      } catch (handoffError) {
        // A completed Rust handoff may outlive renderer navigation. It is safe
        // to observe on the next connection, but this obsolete operation must
        // not mutate setup UI or launch subsequent probes.
        assertWizardOperationCurrent(operationId);
        const message = handoffError instanceof Error ? handoffError.message : String(handoffError);
        setWizardStep(null);
        setWizardCanGoBack(false);
        setWizardRecoveryRequired(false);
        setGatewayRunning(false);
        patchStep("gateway", "error", message);
        appendSetupLog({ source: "setup", step: "gateway", message, level: "error" });
        setSetupError(message);
        report(message);
        replaceSetupStep("error");
        return result;
      }
      const modelProbe = await probeActiveRuntimeModel();
      assertWizardOperationCurrent(operationId);
      if (!modelProbe.ready) {
        const message = t(
          "setup.wizard.modelNotReady",
          "所选模型尚未通过实时验证，请继续完成 OpenClaw 配置。",
        );
        updateOnboardingRequirement(true);
        setWizardStep(null);
        setWizardCanGoBack(false);
        setWizardRecoveryRequired(false);
        setWizardError(message);
        setSetupError(message);
        await refreshGatewayConnectionTarget();
        assertWizardOperationCurrent(operationId);
        replaceSetupStep("configure-openclaw");
        return result;
      }
      updateOnboardingRequirement(false);
      setWizardStep(null);
      setWizardCanGoBack(false);
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
    setWizardCanGoBack(wizardClientRef.current?.canGoBack ?? false);
    report(result.step.title || result.step.message || t("setup.wizard.title", "配置 OpenClaw"), 82);
    replaceSetupStep("configure-openclaw");
    return result;
  }, [appendSetupLog, assertWizardOperationCurrent, probeActiveRuntimeModel, refreshGatewayConnectionTarget, report, setGatewayRunning, setPostStorageStep, replaceSetupStep, setSetupError, t, updateOnboardingRequirement]);

  const recoverLostWizardSession = useCallback(async (
    client: OpenClawWizardClient,
  ): Promise<OpenClawWizardResult> => {
    client.forgetSession();
    const structurallyIncomplete = await resolveActiveRuntimeOnboardingRequirement();
    if (!structurallyIncomplete) {
      const modelProbe = await probeActiveRuntimeModel();
      if (modelProbe.ready) {
        return { done: true, status: "done" };
      }
    }
    return await client.start();
  }, [probeActiveRuntimeModel, resolveActiveRuntimeOnboardingRequirement]);

  const recoverAfterGatewayHandoff = useCallback(async (
    operationId: number,
  ): Promise<OpenClawWizardResult> => {
    await refreshGatewayConnectionTarget();
    await waitForGatewayConnection(operationId);
    assertWizardOperationCurrent(operationId);
    const client = wizardClientRef.current!;
    try {
      return await client.resume();
    } catch (error) {
      if (!isOpenClawWizardSessionLost(error)) throw error;
      // Wizard sessions are process-local. The official finalizer can replace
      // that process after durable model/config metadata has already landed.
      return await recoverLostWizardSession(client);
    }
  }, [assertWizardOperationCurrent, recoverLostWizardSession, refreshGatewayConnectionTarget, waitForGatewayConnection]);

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
          result = await recoverLostWizardSession(client);
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
  }, [applyWizardResult, assertWizardOperationCurrent, beginWizardOperation, recoverLostWizardSession, replaceSetupStep, setSetupError, showWizardActivity, t, waitForGatewayConnection, wizardFailureMessage]);

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
          const result = await recoverLostWizardSession(wizardClientRef.current!);
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
  }, [applyWizardResult, assertWizardOperationCurrent, beginWizardOperation, recoverLostWizardSession, replaceSetupStep, setSetupError, showWizardActivity, t, waitForGatewayConnection, wizardFailureMessage]);

  const submitWizardStep = useCallback(async (stepId: string, value?: unknown) => {
    // React state updates are asynchronous. A final note can receive two click
    // events before `wizardSubmitting` reaches the button, causing the second
    // request to race the official terminal response and report "wizard not
    // found" after onboarding already completed.
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
      const connectionTimedOut = (
        error instanceof Error
        && error.message === t("setup.wizard.connectionTimeout", "Gateway 已启动，但配置向导连接超时。")
      );
      if (
        connectionTimedOut
        && isOpenClawWizardCompletionStep(wizardClientRef.current?.currentStepView)
      ) {
        // The official final note can be visible before its service handoff
        // replaces the Gateway process. If the acknowledgement loses that
        // connection, recover only from provider-neutral terminal semantics;
        // applyWizardResult still verifies the selected Gateway identity and
        // performs a live model probe before Ready is committed.
        const structurallyIncomplete = await resolveActiveRuntimeOnboardingRequirement();
        assertWizardOperationCurrent(operationId);
        if (!structurallyIncomplete) {
          return await applyWizardResult({ done: true, status: "done" }, operationId);
        }
      }
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
          const result = await recoverLostWizardSession(wizardClientRef.current!);
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
  }, [applyWizardResult, assertWizardOperationCurrent, beginWizardOperation, recoverAfterGatewayHandoff, recoverLostWizardSession, resolveActiveRuntimeOnboardingRequirement, resumeOfficialOnboarding, setSetupError, t, waitForGatewayConnection, wizardFailureMessage]);

  const retryOfficialOnboarding = useCallback(async (): Promise<OpenClawWizardResult | null> => {
    if (wizardRecoveryInFlightRef.current || wizardNavigationInFlightRef.current) return null;
    const operationId = beginWizardOperation();
    wizardRecoveryInFlightRef.current = "retry";
    setWizardError(null);
    setWizardRecoveryRequired(false);
    setWizardSubmitting(true);
    try {
      await waitForGatewayConnection(operationId);
      const result = await wizardClientRef.current!.retry();
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

  const backOfficialOnboarding = useCallback(async (): Promise<OpenClawWizardResult | null> => {
    if (!wizardClientRef.current?.canGoBack || wizardNavigationInFlightRef.current) return null;
    const operationId = beginWizardOperation();
    wizardNavigationInFlightRef.current = "back";
    setWizardError(null);
    setWizardRecoveryRequired(false);
    setWizardSubmitting(true);
    try {
      await waitForGatewayConnection(operationId);
      const result = await wizardClientRef.current.back();
      assertWizardOperationCurrent(operationId);
      if (!result) return null;
      return await applyWizardResult(result, operationId);
    } catch (error) {
      if (error instanceof OpenClawWizardOperationSupersededError) return null;
      const message = wizardFailureMessage(error);
      setWizardError(message);
      setSetupError(message);
      return null;
    } finally {
      if (wizardOperationRef.current === operationId) {
        wizardNavigationInFlightRef.current = null;
        setWizardSubmitting(false);
      }
    }
  }, [applyWizardResult, assertWizardOperationCurrent, beginWizardOperation, setSetupError, waitForGatewayConnection, wizardFailureMessage]);

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
      const restarted = await gatewayManager.restart();
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
    wizardCanGoBack,
    wizardError,
    wizardRecoveryRequired,
    submitWizardStep,
    pollWizard: pollOfficialOnboarding,
    retryWizard: retryOfficialOnboarding,
    reclaimWizard: reclaimOfficialOnboarding,
    backWizard: backOfficialOnboarding,
    invalidateWizardOperations,
    setWizardStep,
    setWizardCanGoBack,
    setWizardError,
    setWizardSubmitting,
    isWizardOperationInFlight: () => Boolean(
      wizardNavigationInFlightRef.current || wizardRecoveryInFlightRef.current
    ),
  };
}
