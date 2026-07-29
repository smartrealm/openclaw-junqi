import { useCallback, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  checkGit,
  checkOpenclaw,
  checkSetupNode,
  installGit,
  installNode,
  installOpenclaw,
  pullOpenclawImage,
  relocateOpenclaw,
  reinstallOpenclaw,
  repairSetupNodeRuntime,
  type DockerStatus,
  type OpenclawStatus,
} from "@/api/tauri-commands";
import type { SetupStep } from "@/stores/setup-navigation";
import type { SetupOperationKind } from "@/services/setup/setupOperationCoordinator";
import type { SetupProgressPhase } from "../setupProgressModel";
import {
  INITIAL_DOCKER_STEPS,
  INITIAL_NATIVE_STEPS,
  isMissingGitDependencyError,
  SetupPrerequisiteError,
} from "./helpers";
import type { InstallTarget, StepState, StepStatus } from "./types";

type RunSetupOperation = <T>(
  runId: number,
  kind: SetupOperationKind,
  execute: (operationId: string) => Promise<T>,
) => Promise<T>;

interface SetupInstallerPorts {
  dockerStatus: DockerStatus | null;
  reinstallRequestedRef: MutableRefObject<boolean>;
  relocationRequestedRef: MutableRefObject<boolean>;
  beginRun: () => number;
  beginSetupOperation: (runId: number) => boolean;
  finishSetupOperation: (runId: number) => void;
  isRunActive: (runId: number) => boolean;
  runSetupOperation: RunSetupOperation;
  startGateway: (mode: "native" | "docker", runId: number) => Promise<boolean>;
  replaceSetupStep: (step: SetupStep) => void;
  commitSteps: (steps: StepState[]) => void;
  patchStep: (id: string, status: StepStatus, detail?: string) => void;
  ensureStepBefore: (step: StepState, beforeId: string) => void;
  failRunningStep: (message: string) => void;
  report: (message: string, progress?: number) => void;
  reportPhase: (phase: SetupProgressPhase, message: string, localPercent?: number) => void;
  setNodeRequirement: (requirement: string | null) => void;
  setOpenclawStatus: (status: OpenclawStatus | null) => void;
  setInstallTarget: (target: InstallTarget | null) => void;
  setNeedsGit: (needsGit: boolean) => void;
  setGatewayRunning: (running: boolean) => void;
  setSetupError: (error: string | null) => void;
  updateOnboardingRequirement: (required: boolean) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Owns the cancellable Native and Docker installation transactions. */
export function useSetupInstallers({
  dockerStatus,
  reinstallRequestedRef,
  relocationRequestedRef,
  beginRun,
  beginSetupOperation,
  finishSetupOperation,
  isRunActive,
  runSetupOperation,
  startGateway,
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
}: SetupInstallerPorts) {
  const { t } = useTranslation();

  const runNativeSetup = useCallback(async (existingRunId?: number): Promise<boolean> => {
    const runId = existingRunId ?? beginRun();
    if (!beginSetupOperation(runId)) return false;
    commitSteps([...INITIAL_NATIVE_STEPS]);
    try {
      replaceSetupStep("checking");

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
        setupNode = await runSetupOperation(
          runId,
          "node",
          (operationId) => installNode(false, operationId),
        );
        if (!isRunActive(runId)) return false;
        nodeStatus = setupNode.node;
        setNodeRequirement(setupNode.requirement);
        if (!nodeStatus.available) {
          throw new SetupPrerequisiteError(
            "node-missing",
            t("setup.nodeInstallFailed", "Node.js 安装后校验失败"),
          );
        }
        patchStep("node", "done", nodeStatus.version ?? undefined);
      } else {
        patchStep("node", "done", nodeStatus.version ?? undefined);
      }

      patchStep("npm", "running", t("setup.checkingNpm", "正在检查 npm 版本…"));
      let npmStatus = setupNode.npm;
      if (nodeStatus.available && !npmStatus.available) {
        const repairing = t("setup.repairingNodeRuntime", "正在修复所选 Node.js 运行时…");
        patchStep("node", "running", repairing);
        patchStep("npm", "running", repairing);
        replaceSetupStep("install-node");
        reportPhase("node", repairing, 20);
        setupNode = await runSetupOperation(runId, "node", repairSetupNodeRuntime);
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

      patchStep("openclaw", "running", t("setup.checkingOpenclaw"));
      reportPhase("openclaw", t("setup.checkingOpenclaw"));
      const openclaw = await checkOpenclaw();
      setOpenclawStatus(openclaw);
      if (!isRunActive(runId)) return false;
      const repairInvalidInstall = openclaw.binary_found && (
        !openclaw.version_ok
        || !openclaw.package_valid
        || !openclaw.gateway_command_ok
      );
      const forceReinstall = reinstallRequestedRef.current || repairInvalidInstall;
      const forceRelocation = relocationRequestedRef.current || openclaw.relocation_required;
      if (!openclaw.installed || forceReinstall || forceRelocation) {
        if (!openclaw.installed) updateOnboardingRequirement(true);
        patchStep("openclaw", "running", t("setup.installingOpenclaw"));
        replaceSetupStep("install-openclaw");
        reportPhase("openclaw", t("setup.installingOpenclaw"), 10);
        const installSelectedOpenclaw = async (operationId: string) => {
          if (forceRelocation) await relocateOpenclaw(operationId);
          else if (forceReinstall) await reinstallOpenclaw(operationId);
          else await installOpenclaw(operationId);
        };
        try {
          await runSetupOperation(runId, "openclaw", installSelectedOpenclaw);
        } catch (error) {
          if (!isMissingGitDependencyError(error)) throw error;
          patchStep("openclaw", "pending");
          ensureStepBefore({ id: "git", label: "Git", status: "running" }, "openclaw");
          patchStep("git", "running", t("setup.installingGit", "正在安装 Git…"));
          replaceSetupStep("install-git");
          reportPhase("openclaw", t("setup.installingGit", "正在安装 Git…"), 10);
          await runSetupOperation(runId, "git", installGit);
          if (!isRunActive(runId)) return false;
          const installedGit = await checkGit();
          if (!isRunActive(runId)) return false;
          if (!installedGit.available) {
            throw new SetupPrerequisiteError("git-missing", t("setup.gitRequiredDesc"));
          }
          patchStep("git", "done", installedGit.version ?? undefined);
          patchStep("openclaw", "running", t("setup.installingOpenclaw"));
          replaceSetupStep("install-openclaw");
          reportPhase("openclaw", t("setup.installingOpenclaw"), 10);
          await runSetupOperation(runId, "openclaw", installSelectedOpenclaw);
        }
        if (!isRunActive(runId)) return false;
        const installed = await checkOpenclaw();
        setOpenclawStatus(installed);
        if (!isRunActive(runId)) return false;
        if (!installed.installed) {
          throw new Error(installed.error || t("setup.openclawInstallFailed", "OpenClaw 安装后校验失败"));
        }
        reinstallRequestedRef.current = false;
        relocationRequestedRef.current = false;
        patchStep("openclaw", "done", installed.version ?? undefined);
      } else {
        if (openclaw.path) {
          setInstallTarget({
            tier: "existing",
            path: openclaw.path,
            version: openclaw.version ?? undefined,
          });
        }
        patchStep("openclaw", "done", openclaw.version ?? undefined);
      }

      return await startGateway("native", runId);
    } catch (error) {
      if (!isRunActive(runId)) return false;
      const message = errorMessage(error);
      failRunningStep(message);
      setSetupError(message);
      report(message);
      if (error instanceof SetupPrerequisiteError) {
        if (error.step === "git-missing") setNeedsGit(true);
        replaceSetupStep(error.step);
        return false;
      }
      replaceSetupStep("error");
      return false;
    } finally {
      finishSetupOperation(runId);
    }
  }, [beginRun, beginSetupOperation, commitSteps, ensureStepBefore, failRunningStep,
    finishSetupOperation, isRunActive, patchStep, relocationRequestedRef,
    reinstallRequestedRef, replaceSetupStep, report, reportPhase, runSetupOperation,
    setInstallTarget, setNeedsGit, setNodeRequirement, setOpenclawStatus, setSetupError,
    startGateway, t, updateOnboardingRequirement]);

  const runDockerSetup = useCallback(async (existingRunId?: number): Promise<boolean> => {
    const runId = existingRunId ?? beginRun();
    if (!beginSetupOperation(runId)) return false;
    commitSteps([...INITIAL_DOCKER_STEPS]);
    try {
      replaceSetupStep("checking");
      if (dockerStatus?.image_available) {
        const reused = t("setup.reusingDockerImage", "已复用本地 OpenClaw 镜像");
        patchStep("pull", "done", reused);
        report(reused, 30);
      } else {
        patchStep("pull", "running", t("setup.pullingImage"));
        report(t("setup.pullingImage"), 10);
        await runSetupOperation(
          runId,
          "docker-image",
          (operationId) => pullOpenclawImage(undefined, operationId),
        );
        if (!isRunActive(runId)) return false;
        patchStep("pull", "done");
      }
      return await startGateway("docker", runId);
    } catch (error) {
      if (!isRunActive(runId)) return false;
      setGatewayRunning(false);
      const message = errorMessage(error);
      failRunningStep(message);
      setSetupError(message);
      report(message);
      replaceSetupStep("error");
      return false;
    } finally {
      finishSetupOperation(runId);
    }
  }, [beginRun, beginSetupOperation, commitSteps, dockerStatus, failRunningStep,
    finishSetupOperation, isRunActive, patchStep, replaceSetupStep, report,
    runSetupOperation, setGatewayRunning, setSetupError, startGateway, t]);

  return { runNativeSetup, runDockerSetup };
}
