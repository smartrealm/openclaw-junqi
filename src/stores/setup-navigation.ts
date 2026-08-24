import type { SetupStep } from '@/types/setupNavigation';

export type { SetupStep } from '@/types/setupNavigation';

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
    case "environment-review":
      return "setup.runtimeTitle";
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
    case "update-openclaw":
      return "setup.openclawUpdate.stepTitle";
    case "configure-openclaw":
      return "setup.wizard.title";
  }
}

export function setupStepProgress(step: SetupStep): number {
  switch (step) {
    case "welcome":
      return 0;
    case "detecting":
    case "environment-review":
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
    case "update-openclaw":
      return 78;
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

/// 这些步骤描述一次执行而不是用户选择；执行结束后返回它们只会显示已过期状态。
/// 进度步骤没有可重复操作，错误步骤则可能误导用户修复已经恢复的问题。
const STALE_BACK_DESTINATIONS = new Set<SetupStep>([
  "detecting",
  // 此页面立即启动所选 Gateway，不持有稳定的用户决策；返回会再次自动前进并可能重放启动。
  "gateway-stopped",
  "checking",
  "install-git",
  "install-node",
  "install-openclaw",
  "error",
]);

export function isStaleSetupBackDestination(step: SetupStep): boolean {
  // 历史只保留用户可见的明确决策；执行诊断已进入活动日志，因此跳过这些步骤不会丢失事实。
  return STALE_BACK_DESTINATIONS.has(step);
}
