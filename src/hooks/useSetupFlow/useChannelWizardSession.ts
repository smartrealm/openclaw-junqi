import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RefObject } from "react";
import type { SetupStep } from "@/stores/setup-navigation";
import type { SetupLog } from "@/stores/app-store";
import { detectGatewayConfig } from "@/api/tauri-commands";
import type { ChannelWizardPhase } from "./types";
import {
  classifyOpenClawWizardFailure,
  createScopedOpenClawWizardSessionStore,
  isOpenClawWizardSessionLost,
  OpenClawWizardClient,
  OpenClawWizardOperationSupersededError,
  OPENCLAW_WIZARD_SESSION_STORAGE_KEYS,
  type OpenClawWizardConfiguredAccount,
  type OpenClawWizardResult,
  type OpenClawWizardSessionScope,
  type OpenClawWizardStep,
} from "@/services/openclawWizard";
import { gateway } from "@/services/gateway";
import { sanitizeSetupDiagnostic } from "@/services/setup/setupDiagnostic";

export interface ChannelWizardSessionPorts {
  setupStep: SetupStep;
  appendSetupLog: (log: Omit<SetupLog, "ts"> & { ts?: number }) => void;
  navigationLeavingRef: RefObject<boolean>;
}

export function useChannelWizardSession({
  setupStep,
  appendSetupLog,
  navigationLeavingRef,
}: ChannelWizardSessionPorts) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<ChannelWizardPhase>("decision");
  const [wizardStep, setWizardStep] = useState<OpenClawWizardStep | null>(null);
  const [wizardSubmitting, setWizardSubmitting] = useState(false);
  const [wizardActivity, setWizardActivity] = useState<string | null>(null);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [configuredAccounts, setConfiguredAccounts] = useState<OpenClawWizardConfiguredAccount[]>([]);
  const operationRef = useRef(0);
  const inFlightRef = useRef(false);
  const clientRef = useRef<OpenClawWizardClient | null>(null);
  const sessionScopeRef = useRef<OpenClawWizardSessionScope | null>(null);

  if (!clientRef.current) {
    clientRef.current = new OpenClawWizardClient(
      (method, params, options) => gateway.callPrivileged(method, params, options),
      createScopedOpenClawWizardSessionStore(
        () => sessionScopeRef.current,
        OPENCLAW_WIZARD_SESSION_STORAGE_KEYS.channels,
      ),
    );
  }

  const refreshSessionScope = useCallback(async () => {
    try {
      const target = await detectGatewayConfig();
      sessionScopeRef.current = target.ws_url
        ? { runtimeMode: target.runtime_mode, gatewayWsUrl: target.ws_url }
        : null;
    } catch {
      sessionScopeRef.current = null;
    }
  }, []);

  const assertCurrent = useCallback((operation: number) => {
    if (operation !== operationRef.current) throw new OpenClawWizardOperationSupersededError();
  }, []);

  const beginOperation = useCallback(() => {
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    inFlightRef.current = true;
    setWizardSubmitting(true);
    setWizardError(null);
    return operation;
  }, []);

  const finishOperation = useCallback((operation: number) => {
    if (operation !== operationRef.current) return;
    inFlightRef.current = false;
    setWizardSubmitting(false);
  }, []);

  const presentFailure = useCallback((error: unknown) => {
    const detail = sanitizeSetupDiagnostic(error instanceof Error ? error.message : error);
    const message = classifyOpenClawWizardFailure(error) === "session_lost"
      ? t("setup.channelWizard.sessionExpired", "官方渠道配置会话已失效，请重新开始。")
      : detail;
    appendSetupLog({ source: "setup", step: "channels", message, level: "error" });
    setWizardActivity(null);
    setWizardError(message);
    setPhase("error");
  }, [appendSetupLog, t]);

  const applyResult = useCallback((result: OpenClawWizardResult, operation: number) => {
    assertCurrent(operation);
    if (result.error || result.status === "error") {
      throw new Error(result.error || t("setup.channelWizard.failed", "OpenClaw 官方渠道配置失败。"));
    }
    if (result.status === "cancelled") {
      setWizardActivity(null);
      setWizardStep(null);
      setPhase("decision");
      return result;
    }
    if (result.done || result.status === "done") {
      setWizardActivity(null);
      setWizardStep(null);
      setConfiguredAccounts(result.accounts ?? []);
      setPhase("completed");
      return result;
    }
    if (!result.step) {
      throw new Error(t("setup.channelWizard.missingStep", "OpenClaw 官方渠道配置没有返回下一步。"));
    }
    setWizardActivity(null);
    setWizardStep(result.step);
    setPhase("active");
    return result;
  }, [assertCurrent, t]);

  const startChannelWizard = useCallback(async (): Promise<OpenClawWizardResult | null> => {
    if (inFlightRef.current) return null;
    const operation = beginOperation();
    setConfiguredAccounts([]);
    setWizardActivity(t("setup.channelWizard.starting", "正在启动 OpenClaw 官方渠道配置…"));
    try {
      await refreshSessionScope();
      const result = await clientRef.current!.start({ flow: "channels" });
      return applyResult(result, operation);
    } catch (error) {
      if (error instanceof OpenClawWizardOperationSupersededError) return null;
      presentFailure(error);
      return null;
    } finally {
      finishOperation(operation);
    }
  }, [applyResult, beginOperation, finishOperation, presentFailure, refreshSessionScope, t]);

  const submitChannelWizardStep = useCallback(async (
    stepId: string,
    value?: unknown,
  ): Promise<OpenClawWizardResult | null> => {
    if (inFlightRef.current) return null;
    const operation = beginOperation();
    try {
      return applyResult(await clientRef.current!.next(stepId, value), operation);
    } catch (error) {
      if (error instanceof OpenClawWizardOperationSupersededError) return null;
      presentFailure(error);
      return null;
    } finally {
      finishOperation(operation);
    }
  }, [applyResult, beginOperation, finishOperation, presentFailure]);

  const pollChannelWizard = useCallback(async (): Promise<OpenClawWizardResult | null> => {
    if (inFlightRef.current) return null;
    const operation = beginOperation();
    try {
      return applyResult(await clientRef.current!.resume(), operation);
    } catch (error) {
      if (error instanceof OpenClawWizardOperationSupersededError) return null;
      presentFailure(error);
      return null;
    } finally {
      finishOperation(operation);
    }
  }, [applyResult, beginOperation, finishOperation, presentFailure]);

  const retryChannelWizard = useCallback(async (): Promise<OpenClawWizardResult | null> => {
    if (inFlightRef.current) return null;
    const operation = beginOperation();
    setWizardActivity(t("setup.channelWizard.retrying", "正在恢复 OpenClaw 官方渠道配置…"));
    try {
      let result: OpenClawWizardResult;
      try {
        result = await clientRef.current!.retry();
      } catch (error) {
        if (!isOpenClawWizardSessionLost(error)) throw error;
        await refreshSessionScope();
        result = await clientRef.current!.start({ flow: "channels" });
      }
      return applyResult(result, operation);
    } catch (error) {
      if (error instanceof OpenClawWizardOperationSupersededError) return null;
      presentFailure(error);
      return null;
    } finally {
      finishOperation(operation);
    }
  }, [applyResult, beginOperation, finishOperation, presentFailure, refreshSessionScope, t]);

  const cancelChannelWizard = useCallback(async () => {
    operationRef.current += 1;
    inFlightRef.current = false;
    setWizardSubmitting(false);
    clientRef.current?.invalidatePendingOperations();
    gateway.cancelActivePrivilegedRequest();
    try {
      await clientRef.current?.cancel();
    } catch (error) {
      if (!isOpenClawWizardSessionLost(error)) {
        appendSetupLog({
          source: "setup",
          step: "channels",
          message: sanitizeSetupDiagnostic(error instanceof Error ? error.message : error),
          level: "warn",
        });
      }
    } finally {
      clientRef.current?.forgetSession();
      setWizardActivity(null);
      setWizardStep(null);
      setWizardError(null);
      setConfiguredAccounts([]);
      setPhase("decision");
    }
  }, [appendSetupLog]);

  useEffect(() => {
    if (setupStep === "configure-channels" || navigationLeavingRef.current) return;
    void cancelChannelWizard();
  }, [cancelChannelWizard, navigationLeavingRef, setupStep]);

  return {
    phase,
    wizardStep,
    wizardSubmitting,
    wizardActivity,
    wizardError,
    wizardRecoveryRequired: false,
    configuredAccounts,
    startChannelWizard,
    submitChannelWizardStep,
    pollChannelWizard,
    retryChannelWizard,
    cancelChannelWizard,
    isChannelWizardOperationInFlight: () => inFlightRef.current,
  };
}
