export interface SetupCompletionModelProbe {
  ready: boolean;
  model?: string | null;
  detail?: string | null;
}

export interface SetupCompletionDependencies {
  probeGateway: () => Promise<boolean>;
  requiresOnboarding: () => Promise<boolean>;
  probeModel: () => Promise<SetupCompletionModelProbe>;
}

export type SetupCompletionResult =
  | { ready: true; model?: string | null }
  | {
      ready: false;
      reason: 'gateway-unavailable' | 'onboarding-required' | 'model-unavailable';
      detail?: string | null;
    };

/** Validate the selected runtime in the same action that persists setup. */
export async function validateSetupCompletion(
  dependencies: SetupCompletionDependencies,
): Promise<SetupCompletionResult> {
  if (!(await dependencies.probeGateway())) {
    return { ready: false, reason: 'gateway-unavailable' };
  }
  if (await dependencies.requiresOnboarding()) {
    return { ready: false, reason: 'onboarding-required' };
  }

  const model = await dependencies.probeModel();
  if (!model.ready) {
    return {
      ready: false,
      reason: 'model-unavailable',
      ...(model.detail ? { detail: model.detail } : {}),
    };
  }
  return { ready: true, ...(model.model ? { model: model.model } : {}) };
}
