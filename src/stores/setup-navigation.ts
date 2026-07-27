export type SetupStep =
  | "welcome"
  | "detecting"
  | "storage"
  | "gateway-stopped"
  | "choosing-mode"
  | "checking"
  | "install-git"
  | "git-missing"
  | "node-missing"
  | "install-node"
  | "install-openclaw"
  | "gateway-ready"
  | "configure-openclaw"
  | "ready"
  | "error";

export type SetupNavigationMode = "push" | "replace" | "reset";
export type InstallMode = "native" | "docker";

export interface SetupNavigationState {
  setupStep: SetupStep;
  setupHistory: SetupStep[];
}

const MAX_SETUP_HISTORY = 24;

export function normalizeInstallMode(value: string | null): InstallMode {
  return value === "docker" ? "docker" : "native";
}

export function setupStepMessageKey(step: SetupStep): string {
  switch (step) {
    case "welcome":
      return "setup.petWelcome";
    case "detecting":
      return "setup.detecting";
    case "storage":
      return "storage.title";
    case "gateway-stopped":
      return "setup.gatewayNotRunning";
    case "choosing-mode":
      return "setup.chooseMode";
    case "git-missing":
      return "setup.gitRequired";
    case "node-missing":
      return "setup.nodeRequired";
    case "ready":
      return "setup.ready";
    case "error":
      return "pet.status.error";
    case "checking":
    case "install-git":
    case "install-node":
    case "install-openclaw":
    case "gateway-ready":
      return "setup.gatewayConnected";
    case "configure-openclaw":
      return "setup.wizard.title";
  }
}

export function setupStepProgress(step: SetupStep): number {
  switch (step) {
    case "welcome":
      return 0;
    case "detecting":
    case "gateway-stopped":
    case "choosing-mode":
      return 18;
    case "storage":
      return 24;
    case "git-missing":
    case "node-missing":
    case "checking":
    case "install-git":
    case "install-node":
    case "install-openclaw":
    case "error":
      return 52;
    case "gateway-ready":
      return 74;
    case "configure-openclaw":
      return 82;
    case "ready":
      return 100;
  }
}

export function transitionSetupNavigation(
  state: SetupNavigationState,
  nextStep: SetupStep,
  mode: SetupNavigationMode = "push",
): SetupNavigationState {
  if (mode === "reset") {
    return { setupStep: nextStep, setupHistory: [] };
  }
  if (state.setupStep === nextStep) return state;
  if (mode === "replace") {
    return { ...state, setupStep: nextStep };
  }

  const setupHistory = [...state.setupHistory, state.setupStep].slice(-MAX_SETUP_HISTORY);
  return { setupStep: nextStep, setupHistory };
}

export function backSetupNavigation(
  state: SetupNavigationState,
  fallback: SetupStep = "welcome",
): SetupNavigationState {
  if (state.setupHistory.length === 0) {
    return { setupStep: fallback, setupHistory: [] };
  }

  const setupHistory = state.setupHistory.slice(0, -1);
  const setupStep = state.setupHistory[state.setupHistory.length - 1] ?? fallback;
  return { setupStep, setupHistory };
}

/// Steps whose screens describe a run rather than a choice, so returning to one
/// shows the user a report that the run itself has already superseded.
///
/// The progress steps render neither a Back nor a primary action while current,
/// because the run that owns them drives the next transition — landing on one
/// leaves nothing to click. `error` does render actions, which is worse: reached
/// from a later success it offers to repair a failure that is already fixed.
const STALE_BACK_DESTINATIONS = new Set<SetupStep>([
  "detecting",
  "checking",
  "install-git",
  "install-node",
  "install-openclaw",
  "error",
]);

export function isStaleSetupBackDestination(step: SetupStep): boolean {
  // Setup history represents explicit user-visible decisions, and Back must
  // never erase a prior configuration, install, or confirmation stage. None of
  // the steps above is such a decision, and the diagnostics they carried remain
  // in the activity log, so skipping them loses nothing.
  return STALE_BACK_DESTINATIONS.has(step);
}
