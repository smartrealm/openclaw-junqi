export interface SetupCompletionDependencies {
  probeGateway: () => Promise<boolean>;
  requiresOnboarding: () => Promise<boolean>;
}

export type SetupCompletionResult =
  | { ready: true }
  | { ready: false; reason: 'gateway-unavailable' | 'onboarding-required' };

/** 按 OpenClaw 原生跳过引导条件验证选定运行时。 */
export async function validateSetupCompletion(
  dependencies: SetupCompletionDependencies,
): Promise<SetupCompletionResult> {
  if (!(await dependencies.probeGateway())) {
    return { ready: false, reason: 'gateway-unavailable' };
  }
  if (await dependencies.requiresOnboarding()) {
    return { ready: false, reason: 'onboarding-required' };
  }

  return { ready: true };
}
