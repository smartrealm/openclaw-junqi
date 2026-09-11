// Setup flow contracts shared by the hook, its sub-hooks, and the step screens.
import type { InstallMode } from "@/stores/setup-navigation";
import type { DockerStatus, OpenclawStatus } from "@/api/tauri-commands";
import type { BrokenGatewayPlugin } from "@/services/gateway/pluginRecovery";
import type { OpenClawWizardResult, OpenClawWizardStep } from "@/services/openclawWizard";
import type { OnboardingPresentation } from "@/services/setup/onboardingPresentation";
import type { GuidedSetupController } from "./useGuidedSetupSession";

export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface StepState {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
  progress?: number;
}

export type InstallTargetTier = "custom" | "existing";

export interface InstallTarget {
  /** OpenClaw 的安装来源只包括用户明确选择的 npm 目录或已检测到的已有安装。 */
  tier: InstallTargetTier;
  path: string;
  /** Only set for the `existing` tier, when a version string was returned. */
  version?: string;
}

export type GatewayReadyContinuation =
  | { status: "idle"; error: null }
  | { status: "checking"; error: null }
  | { status: "failed"; error: string };

export type WizardRecoveryMode = "wizard" | "reclaim" | "runtime" | "session" | "terminal-unknown" | null;

export interface SetupFlow {
  presentation: OnboardingPresentation;
  progress: number;
  statusMessage: string;
  installMode: InstallMode;
  dockerStatus: DockerStatus | null;
  openclawStatus: OpenclawStatus | null;
  checkingDocker: boolean;
  environmentReviewBusy: boolean;
  needsGit: boolean;
  nodeRequirement: string | null;
  steps: StepState[];
  installTarget: InstallTarget | null;
  wizardStep: OpenClawWizardStep | null;
  wizardSubmitting: boolean;
  wizardActivity: string | null;
  wizardError: string | null;
  wizardRecoveryMode: WizardRecoveryMode;
  configurationMode: "guided" | "classic";
  guidedSetup: GuidedSetupController;
  needsOnboarding: boolean;
  gatewayReadyContinuation: GatewayReadyContinuation;
  repairing: boolean;
  brokenPlugins: BrokenGatewayPlugin[];
  forceStorageSelection: boolean;
  /** Reject progress from an obsolete or unrelated native setup operation. */
  acceptSetupProgressOperation: (operationId: string | null) => boolean;
  continueAfterEnvironmentReview: () => void;
  redetectEnvironment: () => void;
  startGateway: () => Promise<boolean>;
  retryGateway: () => Promise<boolean>;
  continueAfterGatewayReady: () => Promise<void>;
  continueAfterOpenClawUpdate: () => Promise<void>;
  repairAndRetry: () => Promise<void>;
  disablePluginsAndRetry: () => Promise<void>;
  submitWizardStep: (stepId: string, value?: unknown) => Promise<OpenClawWizardResult | null>;
  pollWizard: () => Promise<OpenClawWizardResult | null>;
  retryWizard: () => Promise<OpenClawWizardResult | null>;
  reclaimWizard: () => Promise<OpenClawWizardResult | null>;
  openClassicSetup: () => Promise<void>;
  runNativeSetup: () => Promise<boolean>;
  runDockerSetup: () => Promise<boolean>;
  repairNodeRuntimeForStorage: () => Promise<boolean>;
  retrySetup: () => Promise<boolean>;
  requestReinstall: () => void;
  completeStorageSetup: (result?: {
    createdFresh: boolean;
    runtimeReconfigurationRequired?: boolean;
    openclawRelocationRequired?: boolean;
  }) => void;
  selectMode: (mode: InstallMode) => Promise<void>;
  detectDocker: () => Promise<void>;
  refreshRuntime: () => Promise<{
    status: OpenclawStatus | null;
    gatewayRunning: boolean;
    needsOnboarding: boolean;
  }>;
  goBack: () => Promise<void>;
  leaveRuntimeRecovery: () => Promise<void>;
  /** Abort a running install and return to the last user-selected screen. */
  cancelSetupRun: () => Promise<void>;
  retryGit: () => void;
  retryNode: () => void;
  enteringDashboard: boolean;
  dashboardEntryError: string | null;
  enterDashboard: (origin?: Element | null) => Promise<void>;
}
