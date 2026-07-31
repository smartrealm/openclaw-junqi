import { useEffect, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import type { InstallMode } from "@/stores/setup-navigation";
import { subscribeTauriEvent } from "@/utils/tauriEvents";
import { translateSetupProgressMessage } from "../setupProgressParams";
import { progressForSetupEvent } from "../setupProgressModel";
import {
  isCurrentSetupOperationProgress,
  normalizeSetupProgressPayload,
} from "../setupProgressEvents";
import { pickInstallTargetFromProgress } from "./helpers";
import type { InstallTarget, StepState, StepStatus } from "./types";

const STEP_IDS: Readonly<Record<string, string>> = {
  node: "node",
  npm: "npm",
  git: "git",
  openclaw: "openclaw",
  gateway: "gateway",
  pull: "pull",
  container: "container",
};

interface SetupProgressEventPorts {
  installMode: InstallMode;
  stepsRef: MutableRefObject<StepState[]>;
  report: (message: string, progress?: number) => void;
  setInstallTarget: (target: InstallTarget) => void;
  commitSteps: (steps: StepState[]) => void;
  isCurrentOperationId: (operationId: string) => boolean;
}

export function useSetupProgressEvents({
  installMode,
  stepsRef,
  report,
  setInstallTarget,
  commitSteps,
  isCurrentOperationId,
}: SetupProgressEventPorts): void {
  const { t } = useTranslation();

  useEffect(() => subscribeTauriEvent<{
    step: string;
    message: string;
    progress: number | null;
    error: string | null;
    key?: string;
  } | string>("setup-progress", (event) => {
    const normalized = normalizeSetupProgressPayload(event.payload);
    if (
      !normalized
      || normalized.diagnostic
      || !isCurrentSetupOperationProgress(normalized.operationId, isCurrentOperationId)
    ) return;
    const { step, message, progress, error, key, params, status } = normalized;
    if (!step) {
      report(message);
      return;
    }

    const display = translateSetupProgressMessage(
      key,
      message,
      (translationKey, options) => t(translationKey, options),
      params,
    );
    const target = pickInstallTargetFromProgress(String(key ?? ""), message, params);
    if (target) setInstallTarget(target);
    const overallProgress = typeof progress === "number"
      ? progressForSetupEvent(step, progress, installMode) ?? undefined
      : undefined;
    const gatewayDiagnostic = step === "gateway"
      && typeof key === "string"
      && key.startsWith("setup.gateway.");
    report(gatewayDiagnostic ? t("setup.preparingGateway") : display, overallProgress);

    const stepId = STEP_IDS[step];
    if (!stepId) return;
    const nextStatus: StepStatus = status === "completed"
      ? "done"
      : status === "failed" || error
        ? "error"
        : "running";
    commitSteps(stepsRef.current.map((current) => current.id === stepId
      ? {
          ...current,
          status: nextStatus,
          detail: display,
          progress: typeof progress === "number"
            ? Math.max(current.progress ?? 0, progress)
            : current.progress,
        }
      : current));
  }), [commitSteps, installMode, isCurrentOperationId, report, setInstallTarget, stepsRef, t]);
}
