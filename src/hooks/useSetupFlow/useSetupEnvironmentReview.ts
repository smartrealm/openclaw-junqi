import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  checkDocker,
  checkOpenclaw,
  detectGatewayConfig,
  probeSelectedGateway,
  type DockerStatus,
  type OpenclawStatus,
} from "@/api/tauri-commands";
import type { PostStorageStep } from "@/stores/app-store";
import type { InstallMode, SetupStep } from "@/stores/setup-navigation";
import { cacheGatewayTarget } from "./helpers";
import {
  isEnvironmentReviewActionInFlight,
  transitionEnvironmentReviewAction,
  type EnvironmentReviewActionState,
} from "./environmentReviewAction";
import type { InstallTarget, StepState } from "./types";

interface SetupEnvironmentReviewPorts {
  setupStep: SetupStep;
  dockerStatus: DockerStatus | null;
  navigationLeavingRef: MutableRefObject<boolean>;
  relocationRequestedRef: MutableRefObject<boolean>;
  stepsRef: MutableRefObject<StepState[]>;
  beginRun: () => number;
  isRunActive: (runId: number) => boolean;
  resolveOnboardingRequirement: () => Promise<boolean>;
  updateOnboardingRequirement: (required: boolean) => void;
  setGatewayRunning: (running: boolean) => void;
  setInstallMode: (mode: InstallMode) => void;
  setOpenclawStatus: (status: OpenclawStatus | null) => void;
  setInstallTarget: (target: InstallTarget) => void;
  setDockerStatus: (status: DockerStatus) => void;
  setCheckingDocker: (checking: boolean) => void;
  setSetupComplete: (complete: boolean | null) => void;
  setPostStorageStep: (step: PostStorageStep) => void;
  commitSteps: (steps: StepState[]) => void;
  report: (message: string, progress?: number) => void;
  navigateSetup: (step: SetupStep, mode?: "push" | "replace") => void;
}

const unavailableDockerStatus = (): DockerStatus => ({
  available: false,
  version: null,
  daemon_running: false,
  unsupported_reason: null,
  image_available: false,
});

export function useSetupEnvironmentReview({
  setupStep,
  dockerStatus,
  navigationLeavingRef,
  relocationRequestedRef,
  stepsRef,
  beginRun,
  isRunActive,
  resolveOnboardingRequirement,
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
}: SetupEnvironmentReviewPorts) {
  const { t } = useTranslation();
  const environmentActionStateRef = useRef<EnvironmentReviewActionState>("idle");
  const [environmentActionState, setEnvironmentActionState] = useState<EnvironmentReviewActionState>("idle");
  const dockerDetectingRef = useRef(false);

  const updateEnvironmentAction = useCallback((
    event: Parameters<typeof transitionEnvironmentReviewAction>[1],
  ): EnvironmentReviewActionState => {
    const next = transitionEnvironmentReviewAction(environmentActionStateRef.current, event);
    environmentActionStateRef.current = next;
    setEnvironmentActionState(next);
    return next;
  }, []);

  const beginEnvironmentNavigation = useCallback((): boolean => {
    if (isEnvironmentReviewActionInFlight(environmentActionStateRef.current)) return false;
    return updateEnvironmentAction({ type: "begin", action: "navigating" }) === "navigating";
  }, [updateEnvironmentAction]);

  const finishEnvironmentAction = useCallback(() => {
    updateEnvironmentAction({ type: "finished" });
  }, [updateEnvironmentAction]);

  const detectEnvironment = useCallback(async (runId: number): Promise<PostStorageStep | null> => {
    const cancelled = () => !isRunActive(runId) || navigationLeavingRef.current;
    setGatewayRunning(false);
    try {
      const runtimeTarget = await detectGatewayConfig();
      if (cancelled()) return null;
      const runtime = runtimeTarget.runtime_mode;
      setInstallMode(runtime);
      cacheGatewayTarget(runtimeTarget.port);

      const openclaw = await checkOpenclaw();
      if (cancelled()) return null;
      setOpenclawStatus(openclaw);
      if (runtime === "native" && (!openclaw.installed || openclaw.relocation_required)) {
        relocationRequestedRef.current = openclaw.relocation_required;
        setSetupComplete(null);
        return "choosing-mode";
      }

      const onboardingRequired = await resolveOnboardingRequirement();
      if (cancelled()) return null;
      updateOnboardingRequirement(onboardingRequired);
      if (openclaw.path) {
        setInstallTarget({
          tier: "existing",
          path: openclaw.path,
          version: openclaw.version ?? undefined,
        });
      }
      try {
        const reachable = await probeSelectedGateway();
        if (cancelled()) return null;
        if (reachable) {
          setGatewayRunning(true);
          commitSteps([{ id: "gateway", label: "Gateway", status: "done", progress: 100 }]);
          return onboardingRequired ? "configure-openclaw" : "configure-channels";
        }
      } catch {
        if (cancelled()) return null;
      }

      commitSteps(stepsRef.current.map((step) => step.id === "gateway"
        ? { ...step, status: "pending", progress: undefined }
        : step));
      return "gateway-stopped";
    } catch {
      if (cancelled()) return null;
      setOpenclawStatus(null);
      return "choosing-mode";
    }
  }, [commitSteps, isRunActive, navigationLeavingRef, relocationRequestedRef, resolveOnboardingRequirement, setGatewayRunning, setInstallMode, setInstallTarget, setOpenclawStatus, setSetupComplete, stepsRef, updateOnboardingRequirement]);

  useEffect(() => {
    if (setupStep !== "detecting") return;
    const runId = beginRun();
    void (async () => {
      report(t("setup.detecting"), 0);
      const next = await detectEnvironment(runId);
      if (!next || !isRunActive(runId) || navigationLeavingRef.current) return;
      setPostStorageStep(next);
      report(t("setup.runtimeTitle"), 18);
      navigateSetup("environment-review", "replace");
    })();
  }, [beginRun, detectEnvironment, isRunActive, navigateSetup, navigationLeavingRef, report, setPostStorageStep, setupStep, t]);

  useLayoutEffect(() => {
    updateEnvironmentAction({ type: "step-entered" });
  }, [setupStep, updateEnvironmentAction]);

  const continueAfterEnvironmentReview = useCallback(() => {
    if (setupStep !== "environment-review"
      || navigationLeavingRef.current
      || isEnvironmentReviewActionInFlight(environmentActionStateRef.current)
      || dockerDetectingRef.current) return;
    if (!beginEnvironmentNavigation()) return;
    report(t("storage.title", "选择 OpenClaw 数据位置"), 24);
    navigateSetup("storage", "push");
  }, [beginEnvironmentNavigation, navigateSetup, navigationLeavingRef, report, setupStep, t]);

  const redetectEnvironment = useCallback(async () => {
    if (setupStep !== "environment-review"
      || navigationLeavingRef.current
      || isEnvironmentReviewActionInFlight(environmentActionStateRef.current)
      || dockerDetectingRef.current) return;
    updateEnvironmentAction({ type: "begin", action: "redetecting" });
    dockerDetectingRef.current = true;
    const runId = beginRun();
    setCheckingDocker(true);
    report(t("setup.recheckingEnvironment", "正在重新检测…"), 0);
    try {
      const [next, docker] = await Promise.all([
        detectEnvironment(runId),
        checkDocker().catch(unavailableDockerStatus),
      ]);
      if (!next || !isRunActive(runId)) return;
      setDockerStatus(docker);
      setPostStorageStep(next);
      report(t("setup.runtimeTitle"), 18);
    } finally {
      dockerDetectingRef.current = false;
      finishEnvironmentAction();
      setCheckingDocker(false);
    }
  }, [beginRun, detectEnvironment, finishEnvironmentAction, isRunActive, navigationLeavingRef, report, setCheckingDocker, setDockerStatus, setPostStorageStep, setupStep, t, updateEnvironmentAction]);

  useEffect(() => {
    if (setupStep === "welcome" || dockerStatus || dockerDetectingRef.current) return;
    void (async () => {
      dockerDetectingRef.current = true;
      setCheckingDocker(true);
      try {
        setDockerStatus(await checkDocker());
      } catch {
        setDockerStatus(unavailableDockerStatus());
      } finally {
        dockerDetectingRef.current = false;
        setCheckingDocker(false);
      }
    })();
  }, [dockerStatus, setCheckingDocker, setDockerStatus, setupStep]);

  return {
    continueAfterEnvironmentReview,
    redetectEnvironment,
    environmentActionStateRef,
    environmentReviewBusy: isEnvironmentReviewActionInFlight(environmentActionState),
    beginEnvironmentNavigation,
    finishEnvironmentAction,
    dockerDetectingRef,
  };
}
