import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { gateway } from "@/services/gateway";
import {
  OpenClawGuidedSetupClient,
  OpenClawGuidedSetupMethodUnavailableError,
  OpenClawGuidedSetupResponseError,
  type GuidedSetupActivation,
  type GuidedSetupCandidate,
  type GuidedSetupChatResult,
  type GuidedSetupDetection,
} from "@/services/gateway/OpenClawGuidedSetupClient";
import {
  OpenClawWizardClient,
  type OpenClawWizardResult,
  type OpenClawWizardStep,
} from "@/services/openclawWizard";
import { sanitizeSetupDiagnostic } from "@/services/setup/setupDiagnostic";
import { activateFirstWorkingGuidedCandidate } from "@/services/setup/guidedSetupCandidateLadder";
import { isGuidedSetupUnsupported } from "@/services/setup/openClawSetupCapability";
import { isOpenClawSetupAdmissionBusy } from "@/services/setup/openClawSetupAdmission";

export type GuidedSetupPhase =
  | "detecting"
  | "confirming"
  | "selecting"
  | "activating"
  | "provider-wizard"
  | "chat"
  | "completing"
  | "error";

export interface GuidedSetupController {
  phase: GuidedSetupPhase;
  detection: GuidedSetupDetection | null;
  activation: GuidedSetupActivation | null;
  activeCandidate: GuidedSetupCandidate | null;
  chat: GuidedSetupChatResult | null;
  wizardStep: OpenClawWizardStep | null;
  busy: boolean;
  error: string | null;
  activateCandidate: (candidate: GuidedSetupCandidate) => Promise<void>;
  activateManual: (authChoice: string, apiKey: string) => Promise<void>;
  startProviderAuth: (authChoice: string) => Promise<void>;
  startProviderPrepare: (authChoice: string) => Promise<void>;
  submitProviderWizard: (stepId: string, value?: unknown) => Promise<void>;
  cancelProviderWizard: () => Promise<void>;
  submitChat: (message?: string, wizardAnswer?: { stepId: string; value?: unknown }) => Promise<void>;
  cancelChatWizard: (stepId: string) => Promise<void>;
  confirmDetectedRoute: () => Promise<void>;
  chooseOtherRoute: () => void;
  finishChat: () => Promise<void>;
  retry: () => Promise<void>;
}

interface GuidedSetupSessionPorts {
  enabled: boolean;
  onComplete: () => Promise<void>;
  onUnsupported: () => void;
}

function operationError(error: unknown, t: (key: string, fallback: string) => string): string {
  if (error instanceof OpenClawGuidedSetupMethodUnavailableError) {
    return error.availability === "unsupported"
      ? t("setup.guided.unsupported", "当前 OpenClaw Runtime 不提供官方引导配置接口，请更新 OpenClaw 后继续。")
      : t("setup.guided.connectionUnavailable", "尚未建立具备管理权限的 Gateway 连接，请恢复连接后重试。");
  }
  if (error instanceof OpenClawGuidedSetupResponseError) {
    return t("setup.guided.invalidResponse", "OpenClaw 返回了无法识别的官方配置响应，请核对 Runtime 版本后重试。");
  }
  if (isOpenClawSetupAdmissionBusy(error)) {
    return t("setup.guided.alreadyRunning", "另一个 OpenClaw 配置会话仍在运行，请完成或取消后重试。");
  }
  return sanitizeSetupDiagnostic(error instanceof Error ? error.message : error);
}

export function useGuidedSetupSession({
  enabled,
  onComplete,
  onUnsupported,
}: GuidedSetupSessionPorts): GuidedSetupController {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<GuidedSetupPhase>("detecting");
  const [detection, setDetection] = useState<GuidedSetupDetection | null>(null);
  const [activation, setActivation] = useState<GuidedSetupActivation | null>(null);
  const [activeCandidate, setActiveCandidate] = useState<GuidedSetupCandidate | null>(null);
  const [chat, setChat] = useState<GuidedSetupChatResult | null>(null);
  const [wizardStep, setWizardStep] = useState<OpenClawWizardStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationRef = useRef(0);
  const providerPrepareRef = useRef<string | null>(null);
  const chatSessionIdRef = useRef<string | null>(null);
  const guidedClientRef = useRef<OpenClawGuidedSetupClient | null>(null);
  const wizardClientRef = useRef<OpenClawWizardClient | null>(null);
  if (!guidedClientRef.current) {
    guidedClientRef.current = new OpenClawGuidedSetupClient({
      requestPrivileged: (method, params) => gateway.callPrivileged(method, params),
    });
  }
  if (!wizardClientRef.current) {
    wizardClientRef.current = new OpenClawWizardClient(
      (method, params, options) => gateway.callPrivileged(method, params, options),
    );
  }

  const beginOperation = useCallback(() => {
    operationRef.current += 1;
    setBusy(true);
    setError(null);
    return operationRef.current;
  }, []);

  const assertCurrent = useCallback((operation: number) => {
    if (operation !== operationRef.current) throw new Error("OpenClaw setup operation was superseded.");
  }, []);

  const completeHandoff = useCallback(async (operation: number) => {
    assertCurrent(operation);
    setPhase("completing");
    await onComplete();
  }, [assertCurrent, onComplete]);

  const applyChatResult = useCallback(async (result: GuidedSetupChatResult, operation: number) => {
    assertCurrent(operation);
    chatSessionIdRef.current = result.sessionId;
    setChat(result);
    setPhase("chat");
    if (result.action === "exit" || result.action === "open-agent") {
      await completeHandoff(operation);
    }
  }, [assertCurrent, completeHandoff]);

  const startOnboardingChat = useCallback(async (operation: number) => {
    const sessionId = crypto.randomUUID();
    chatSessionIdRef.current = sessionId;
    const result = await guidedClientRef.current!.chat({
      sessionId,
      welcomeVariant: "onboarding",
    });
    await applyChatResult(result, operation);
  }, [applyChatResult]);

  const continueFromDetection = useCallback(async (
    result: GuidedSetupDetection,
    operation: number,
  ) => {
    assertCurrent(operation);
    setDetection(result);
    if (result.setupComplete) {
      await completeHandoff(operation);
      return;
    }
    if (!result.candidates.length) {
      setPhase("selecting");
      return;
    }

    setPhase("activating");
    const ladder = await activateFirstWorkingGuidedCandidate(result, {
      activateCandidate: (candidate) => guidedClientRef.current!.activate({
        kind: candidate.kind,
        modelRef: candidate.modelRef,
        workspace: result.workspace,
      }),
    });
    assertCurrent(operation);
    if (ladder.activated) {
      setActivation(ladder.result);
      setActiveCandidate(ladder.candidate);
      setPhase("confirming");
      return;
    }
    setActivation(ladder.lastResult);
    setPhase("selecting");
    if (ladder.lastResult) setError(ladder.lastResult.error);
  }, [assertCurrent, completeHandoff]);

  const activate = useCallback(async (
    params: Parameters<OpenClawGuidedSetupClient["activate"]>[0],
  ) => {
    const operation = beginOperation();
    setPhase("activating");
    setActivation(null);
    setActiveCandidate(null);
    try {
      const result = await guidedClientRef.current!.activate(params);
      assertCurrent(operation);
      setActivation(result);
      if (!result.ok) {
        setPhase("selecting");
        setError(result.error);
        return;
      }
      await startOnboardingChat(operation);
    } catch (cause) {
      if (operation === operationRef.current) {
        setError(operationError(cause, t));
        setPhase("error");
      }
    } finally {
      if (operation === operationRef.current) setBusy(false);
    }
  }, [assertCurrent, beginOperation, startOnboardingChat, t]);

  const loadDetection = useCallback(async () => {
    const operation = beginOperation();
    setPhase("detecting");
    setActivation(null);
    setActiveCandidate(null);
    setChat(null);
    setWizardStep(null);
    try {
      const result = await guidedClientRef.current!.detect();
      await continueFromDetection(result, operation);
    } catch (cause) {
      if (isGuidedSetupUnsupported(cause)) {
        if (operation === operationRef.current) onUnsupported();
        return;
      }
      if (operation === operationRef.current) {
        setError(operationError(cause, t));
        setPhase("error");
      }
    } finally {
      if (operation === operationRef.current) setBusy(false);
    }
  }, [beginOperation, continueFromDetection, onUnsupported, t]);

  const applyProviderWizardResult = useCallback(async (
    result: OpenClawWizardResult,
    operation: number,
  ) => {
    let current = result;
    while (true) {
      assertCurrent(operation);
      if (current.error || current.status === "error") {
        throw new Error(current.error || t("setup.wizard.failed", "OpenClaw 配置向导执行失败。"));
      }
      if (!current.done && current.status !== "done") {
        if (!current.step) {
          current = await wizardClientRef.current!.resume({ timeoutMs: null });
          continue;
        }
        setWizardStep(current.step);
        setPhase("provider-wizard");
        return;
      }
      break;
    }
    setWizardStep(null);
    const prepareChoice = providerPrepareRef.current;
    providerPrepareRef.current = null;
    if (prepareChoice && current.preparedModelRef) {
      const activated = await guidedClientRef.current!.activate({
        kind: `provider-auto:${prepareChoice}`,
        modelRef: current.preparedModelRef,
        workspace: detection?.workspace,
      });
      assertCurrent(operation);
      setActivation(activated);
      if (!activated.ok) throw new Error(activated.error);
      await startOnboardingChat(operation);
      return;
    }
    const next = await guidedClientRef.current!.detect();
    await continueFromDetection(next, operation);
  }, [assertCurrent, continueFromDetection, detection?.workspace, startOnboardingChat, t]);

  const startProviderWizard = useCallback(async (authChoice: string, prepare: boolean) => {
    const operation = beginOperation();
    setPhase("provider-wizard");
    setWizardStep(null);
    providerPrepareRef.current = prepare ? authChoice : null;
    try {
      const params = {
        sessionId: crypto.randomUUID(),
        authChoice,
        ...(detection?.workspace ? { workspace: detection.workspace } : {}),
      };
      const started = prepare
        ? await guidedClientRef.current!.startPrepare(params)
        : await guidedClientRef.current!.startAuth(params);
      wizardClientRef.current!.adoptStartedSession(started);
      await applyProviderWizardResult(started, operation);
    } catch (cause) {
      if (operation === operationRef.current) {
        setError(operationError(cause, t));
        setPhase("error");
      }
    } finally {
      if (operation === operationRef.current) setBusy(false);
    }
  }, [applyProviderWizardResult, beginOperation, detection?.workspace, t]);

  useEffect(() => {
    if (!enabled) {
      operationRef.current += 1;
      return;
    }
    void loadDetection();
    return () => {
      operationRef.current += 1;
      gateway.cancelActivePrivilegedRequest();
      wizardClientRef.current?.invalidatePendingOperations();
      void wizardClientRef.current?.cancel().catch(() => undefined);
    };
  }, [enabled, loadDetection]);

  return {
    phase,
    detection,
    activation,
    activeCandidate,
    chat,
    wizardStep,
    busy,
    error,
    activateCandidate: async (candidate) => activate({
      kind: candidate.kind,
      modelRef: candidate.modelRef,
      workspace: detection?.workspace,
    }),
    activateManual: async (authChoice, apiKey) => activate({
      kind: "api-key",
      authChoice,
      apiKey,
      workspace: detection?.workspace,
    }),
    startProviderAuth: async (authChoice) => startProviderWizard(authChoice, false),
    startProviderPrepare: async (authChoice) => startProviderWizard(authChoice, true),
    submitProviderWizard: async (stepId, value) => {
      const operation = beginOperation();
      try {
        await applyProviderWizardResult(
          await wizardClientRef.current!.next(stepId, value),
          operation,
        );
      } catch (cause) {
        if (operation === operationRef.current) {
          setError(operationError(cause, t));
          setPhase("error");
        }
      } finally {
        if (operation === operationRef.current) setBusy(false);
      }
    },
    cancelProviderWizard: async () => {
      const operation = beginOperation();
      try {
        wizardClientRef.current!.invalidatePendingOperations();
        gateway.cancelActivePrivilegedRequest();
        await wizardClientRef.current!.cancel();
        assertCurrent(operation);
        setWizardStep(null);
        providerPrepareRef.current = null;
        const result = await guidedClientRef.current!.detect();
        assertCurrent(operation);
        setDetection(result);
        setActivation(null);
        setActiveCandidate(null);
        if (result.setupComplete) {
          await completeHandoff(operation);
        } else {
          setPhase("selecting");
        }
      } catch (cause) {
        if (operation === operationRef.current) {
          setError(operationError(cause, t));
          setPhase("error");
        }
      } finally {
        if (operation === operationRef.current) setBusy(false);
      }
    },
    submitChat: async (message, wizardAnswer) => {
      const sessionId = chatSessionIdRef.current;
      if (!sessionId) return;
      const operation = beginOperation();
      try {
        await applyChatResult(await guidedClientRef.current!.chat({
          sessionId,
          ...(message !== undefined ? { message } : {}),
          ...(wizardAnswer ? { wizardAnswer } : {}),
        }), operation);
      } catch (cause) {
        if (operation === operationRef.current) {
          setError(operationError(cause, t));
          setPhase("error");
        }
      } finally {
        if (operation === operationRef.current) setBusy(false);
      }
    },
    cancelChatWizard: async (stepId) => {
      const sessionId = chatSessionIdRef.current;
      if (!sessionId) return;
      const operation = beginOperation();
      try {
        await applyChatResult(await guidedClientRef.current!.chat({
          sessionId,
          wizardCancel: { stepId },
        }), operation);
      } catch (cause) {
        if (operation === operationRef.current) {
          setError(operationError(cause, t));
          setPhase("error");
        }
      } finally {
        if (operation === operationRef.current) setBusy(false);
      }
    },
    confirmDetectedRoute: async () => {
      if (!activeCandidate || !activation?.ok) return;
      const operation = beginOperation();
      try {
        await startOnboardingChat(operation);
      } catch (cause) {
        if (operation === operationRef.current) {
          setError(operationError(cause, t));
          setPhase("error");
        }
      } finally {
        if (operation === operationRef.current) setBusy(false);
      }
    },
    chooseOtherRoute: () => {
      if (!activeCandidate || !activation?.ok || busy) return;
      setError(null);
      setPhase("selecting");
    },
    finishChat: async () => {
      const operation = beginOperation();
      try {
        await completeHandoff(operation);
      } catch (cause) {
        if (operation === operationRef.current) {
          setError(operationError(cause, t));
          setPhase("error");
        }
      } finally {
        if (operation === operationRef.current) setBusy(false);
      }
    },
    retry: loadDetection,
  };
}
