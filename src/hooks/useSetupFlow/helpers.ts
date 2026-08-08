// Constants and pure helpers with no React state of their own.
import type { SetupStep } from "@/stores/setup-navigation";
import { defaultGatewayWsUrl } from "@/config/runtimeDefaults";
import { setupProgressI18nParams } from "../setupProgressParams";
import type { InstallTarget, StepState } from "./types";

export const INSTALL_TARGET_KEYS = {
  user: "setup.openclaw.userNpmPrefix",
  userMissingPath: "setup.openclaw.userNpmPrefixMissingPath",
  custom: "setup.openclaw.customNpmPrefix",
  existing: "setup.openclaw.useExisting",
} as const;

/// The one step that means "the runtime is ready and nobody has started the
/// local Gateway yet". Starting it is an installation transition rather than a
/// user decision, so reaching this step starts it automatically.
export const AUTO_ADVANCE_GATEWAY_STEP: SetupStep = "gateway-stopped";

export type SetupBackPolicy =
  | "cancel-run"
  | "cancel-install"
  | "rollback-storage"
  | "navigate";

/**
 * Declares which durable side effect, if any, a page owns when leaving via Back.
 * Keeping this exhaustive and pure prevents a generic Back handler from
 * rolling back committed runtime state merely because every screen shares the
 * same button component.
 */
export function setupBackPolicy(step: SetupStep): SetupBackPolicy {
  switch (step) {
    case "detecting":
    case "gateway-stopped":
      return "cancel-run";
    case "checking":
    case "install-git":
    case "install-node":
    case "install-openclaw":
    case "git-missing":
    case "node-missing":
      return "cancel-install";
    case "storage":
    case "choosing-mode":
      return "rollback-storage";
    case "welcome":
    case "environment-review":
    case "gateway-ready":
    case "configure-openclaw":
    case "configure-channels":
    case "ready":
    case "error":
      return "navigate";
  }
}

/** A prerequisite the user must resolve before setup can be retried. */
export class SetupPrerequisiteError extends Error {
  constructor(readonly step: Extract<SetupStep, "git-missing" | "node-missing">, message: string) {
    super(message);
    this.name = "SetupPrerequisiteError";
  }
}

export function pickInstallTargetFromProgress(
  key: string,
  message: string,
  explicitParams: Partial<Record<string, string>> = {},
): InstallTarget | null {
  if (
    key !== INSTALL_TARGET_KEYS.user &&
    key !== INSTALL_TARGET_KEYS.userMissingPath &&
    key !== INSTALL_TARGET_KEYS.custom &&
    key !== INSTALL_TARGET_KEYS.existing
  ) {
    return null;
  }
  // Reuse the same rule table that drives i18next substitution so
  // the UI path stays in lockstep with the message formatting.
  const params = { ...setupProgressI18nParams(key, message), ...explicitParams };
  if (!params.path) return null;
  if (key === INSTALL_TARGET_KEYS.userMissingPath) {
    return { tier: "userMissingPath", path: params.path };
  }
  if (key === INSTALL_TARGET_KEYS.custom) {
    return { tier: "custom", path: params.path };
  }
  if (key === INSTALL_TARGET_KEYS.existing) {
    return { tier: "existing", path: params.path, version: params.version };
  }
  return { tier: "user", path: params.path };
}

export const INITIAL_NATIVE_STEPS: StepState[] = [
  { id: "node",      label: "Node.js",    status: "pending" },
  { id: "npm",       label: "npm",        status: "pending" },
  { id: "openclaw",  label: "OpenClaw",   status: "pending" },
  { id: "gateway",   label: "Gateway",    status: "pending" },
];

export const INITIAL_DOCKER_STEPS: StepState[] = [
  { id: "pull",      label: "Docker Image",  status: "pending" },
  { id: "container", label: "Container",     status: "pending" },
  { id: "gateway",   label: "Gateway",       status: "pending" },
];

export function cacheGatewayTarget(port?: number | null): void {
  if (!port) return;
  try {
    localStorage.setItem("aegis-gateway-url", defaultGatewayWsUrl(port));
  } catch {
    // 端点偏好写入失败时，连接解析仍以 OpenClaw 当前配置为准。
  }
}

export function isMissingGitDependencyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:spawn\s+git(?:\.exe)?\s+enoent|git(?:\.exe)?.*(?:enoent|not found|not recognized)|(?:cannot|could not|failed to)\s+(?:find|spawn)\s+git)/i.test(message);
}
