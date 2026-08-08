// Setup flow contracts shared by the hook, its sub-hooks, and the step screens.
import type { InstallMode } from "@/stores/setup-navigation";
import type { DockerStatus, OpenclawStatus } from "@/api/tauri-commands";
import type { BrokenGatewayPlugin } from "@/services/gateway/pluginRecovery";
import type { OpenClawWizardResult, OpenClawWizardStep } from "@/services/openclawWizard";
import type { OnboardingPresentation } from "@/services/setup/onboardingPresentation";

export type ChannelWizardPhase = "decision" | "active" | "completed" | "error";

export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface StepState {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
  progress?: number;
}

export type InstallTargetTier = "user" | "userMissingPath" | "custom" | "existing";

export interface InstallTarget {
  /**
   * Where the installer decided to put `openclaw`.
   *  - "user": same dir as the user's terminal `npm i -g` (their
   *    actual `npm config get prefix`) and its bin directory is on PATH.
   *  - "userMissingPath": same npm prefix as the user's terminal, but
   *    its bin directory is not currently on the login-shell PATH.
   *  - "custom": explicit global prefix selected during setup.
   *  - "existing": an `openclaw` install was already on disk before
   *    setup ran, so we skipped the install. The card surfaces the
   *    detected path and version.
   */
  tier: InstallTargetTier;
  path: string;
  /** Only set for the `existing` tier, when a version string was returned. */
  version?: string;
}

export type GatewayReadyContinuation =
  | { status: "idle"; error: null }
  | { status: "checking"; error: null }
  | { status: "failed"; error: string };

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
  wizardRecoveryRequired: boolean;
  channelWizardPhase: ChannelWizardPhase;
  channelWizardStep: OpenClawWizardStep | null;
  channelWizardSubmitting: boolean;
  channelWizardActivity: string | null;
  channelWizardError: string | null;
  channelWizardConfiguredAccounts: Array<{ channel: string; accountId: string }>;
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
  repairAndRetry: () => Promise<void>;
  disablePluginsAndRetry: () => Promise<void>;
  submitWizardStep: (stepId: string, value?: unknown) => Promise<OpenClawWizardResult | null>;
  pollWizard: () => Promise<OpenClawWizardResult | null>;
  retryWizard: () => Promise<OpenClawWizardResult | null>;
  reclaimWizard: () => Promise<OpenClawWizardResult | null>;
  startChannelWizard: () => Promise<OpenClawWizardResult | null>;
  submitChannelWizardStep: (stepId: string, value?: unknown) => Promise<OpenClawWizardResult | null>;
  pollChannelWizard: () => Promise<OpenClawWizardResult | null>;
  retryChannelWizard: () => Promise<OpenClawWizardResult | null>;
  deferChannelConfiguration: () => void;
  completeChannelConfiguration: () => void;
  runNativeSetup: () => Promise<boolean>;
  runDockerSetup: () => Promise<boolean>;
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
  /** Abort a running install and return to the last user-selected screen. */
  cancelSetupRun: () => Promise<void>;
  retryGit: () => void;
  retryNode: () => void;
  enteringDashboard: boolean;
  dashboardEntryError: string | null;
  enterDashboard: (origin?: Element | null) => Promise<void>;
}
