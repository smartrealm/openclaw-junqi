import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { SetupLog } from "@/stores/app-store";
import {
  setupStepMessageKey,
  setupStepProgress,
  type SetupStep,
} from "@/stores/setup-navigation";
import { sanitizeSetupDiagnostic } from "@/services/setup/setupDiagnostic";
import {
  advanceSetupProgress,
  type SetupProgressPhase,
} from "../setupProgressModel";
import type { StepState, StepStatus } from "./types";

interface SetupPresentationPorts {
  progress: number;
  setProgress: (value: number) => void;
  setStatusMessage: (message: string) => void;
  steps: StepState[];
  setSteps: (steps: StepState[]) => void;
  setSetupStatus: (message: string, progress?: number) => void;
  appendSetupLog: (log: Omit<SetupLog, "ts"> & { ts?: number }) => void;
}

/** Owns all derived setup progress, step, status, and diagnostic presentation state. */
export function useSetupPresentation({
  progress,
  setProgress,
  setStatusMessage,
  steps,
  setSteps,
  setSetupStatus,
  appendSetupLog,
}: SetupPresentationPorts) {
  const { t } = useTranslation();
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const commitSteps = useCallback((next: StepState[]) => {
    const safe = next.map((step) => ({
      ...step,
      detail: step.detail ? sanitizeSetupDiagnostic(step.detail) : step.detail,
    }));
    stepsRef.current = safe;
    setSteps(safe);
  }, [setSteps]);

  const report = useCallback((message: string, nextProgress?: number) => {
    const safeMessage = sanitizeSetupDiagnostic(message);
    setStatusMessage(safeMessage);
    if (typeof nextProgress === "number") {
      const monotonicProgress = Math.max(progressRef.current, nextProgress);
      progressRef.current = monotonicProgress;
      setProgress(monotonicProgress);
      setSetupStatus(safeMessage, monotonicProgress);
      return;
    }
    setSetupStatus(safeMessage);
  }, [setProgress, setSetupStatus, setStatusMessage]);

  const reportPhase = useCallback((
    phase: SetupProgressPhase,
    message: string,
    localPercent = 0,
  ) => {
    report(message, advanceSetupProgress(progressRef.current, phase, localPercent));
  }, [report]);

  const presentSetupStep = useCallback((step: SetupStep) => {
    const message = t(setupStepMessageKey(step));
    const nextProgress = setupStepProgress(step);
    progressRef.current = nextProgress;
    setStatusMessage(message);
    setProgress(nextProgress);
    setSetupStatus(message, nextProgress);
  }, [setProgress, setSetupStatus, setStatusMessage, t]);

  const patchStep = useCallback((id: string, status: StepStatus, detail?: string) => {
    const current = stepsRef.current.find((step) => step.id === id);
    commitSteps(stepsRef.current.map((step) => step.id === id
      ? {
          ...step,
          status,
          detail,
          progress: status === "done" ? 100 : status === "pending" ? undefined : step.progress,
        }
      : step));
    if (!detail || (current?.status === status && current.detail === detail)) return;
    appendSetupLog({
      source: "setup",
      step: id,
      message: detail,
      level: status === "error" ? "error" : status === "done" ? "success" : "info",
      progress: status === "done" ? 1 : undefined,
    });
  }, [appendSetupLog, commitSteps]);

  const ensureStepBefore = useCallback((step: StepState, beforeId: string) => {
    if (stepsRef.current.some((current) => current.id === step.id)) return;
    const next = [...stepsRef.current];
    const insertionIndex = next.findIndex((current) => current.id === beforeId);
    next.splice(insertionIndex >= 0 ? insertionIndex : next.length, 0, step);
    commitSteps(next);
  }, [commitSteps]);

  const failRunningStep = useCallback((message: string) => {
    const running = stepsRef.current.find((step) => step.status === "running");
    if (running) patchStep(running.id, "error", message);
    appendSetupLog({
      source: "setup",
      message,
      step: running?.id,
      level: "error",
    });
  }, [appendSetupLog, patchStep]);

  return {
    progressRef,
    stepsRef,
    commitSteps,
    report,
    reportPhase,
    presentSetupStep,
    patchStep,
    ensureStepBefore,
    failRunningStep,
  };
}
