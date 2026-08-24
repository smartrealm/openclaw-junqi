import type { DingTalkRuntimeIdentityProjection } from '@/business-applications/dingtalkTools';

export type DingTalkReadiness = {
  readonly tone: 'ready' | 'pending' | 'blocked';
  readonly titleKey: string;
  readonly descriptionKey?: string;
  readonly descriptionParams?: Record<string, string>;
  readonly rawDescription?: string;
  readonly action:
    | 'refresh'
    | 'install-plugin'
    | 'restart-gateway'
    | 'configure-agent'
    | 'install-dws'
    | 'authorize-dws'
    | null;
};

function dwsRuntimeMissing(code: string | null | undefined): boolean {
  return code === 'DWS_RUNTIME_NOT_FOUND' || code === 'DWS_RUNTIME_NOT_EXECUTABLE';
}

export function resolveDingTalkReadiness({
  sessionExists,
  runtimeToolAvailable,
  runtime,
  runtimeError,
  pluginNeedsInstall,
  pluginStatusPending,
  restartRequired,
  agentId,
}: {
  sessionExists: boolean;
  runtimeToolAvailable: boolean;
  runtime: DingTalkRuntimeIdentityProjection | null;
  runtimeError: string | null;
  pluginNeedsInstall: boolean;
  pluginStatusPending: boolean;
  restartRequired: boolean;
  agentId: string | null;
}): DingTalkReadiness {
  if (!sessionExists) {
    return { tone: 'blocked', titleKey: 'sessionRequiredTitle', descriptionKey: 'sessionRequiredDescription', action: null };
  }
  if (!runtimeToolAvailable) {
    if (restartRequired) {
      return { tone: 'pending', titleKey: 'restartRequiredTitle', descriptionKey: 'restartRequiredDescription', action: 'restart-gateway' };
    }
    if (pluginStatusPending) {
      return { tone: 'pending', titleKey: 'checkingTitle', descriptionKey: 'checkingDescription', action: null };
    }
    if (pluginNeedsInstall) {
      return { tone: 'blocked', titleKey: 'pluginMissingTitle', descriptionKey: 'pluginMissingDescription', action: 'install-plugin' };
    }
    return {
      tone: 'blocked',
      titleKey: 'effectiveToolMissingTitle',
      descriptionKey: agentId ? 'effectiveToolMissingDescription' : 'agentMissingDescription',
      ...(agentId ? { descriptionParams: { agentId } } : {}),
      action: 'configure-agent',
    };
  }
  if (runtimeError) {
    return { tone: 'pending', titleKey: 'readingTitle', rawDescription: runtimeError, action: 'refresh' };
  }
  if (!runtime) {
    return { tone: 'pending', titleKey: 'readingTitle', descriptionKey: 'readingDescription', action: 'refresh' };
  }
  if (!runtime.available) {
    const error = runtime.runtimeError;
    if (dwsRuntimeMissing(error?.code)) {
      return {
        tone: 'blocked',
        titleKey: 'dwsMissingTitle',
        descriptionKey: 'dwsMissingDescription',
        action: 'install-dws',
      };
    }
    return {
      tone: 'blocked',
      titleKey: 'dwsUnavailableTitle',
      ...(error?.message ? { rawDescription: error.message } : { descriptionKey: 'dwsUnavailableDescription' }),
      action: 'refresh',
    };
  }
  if (!runtime.currentProfile) {
    return {
      tone: 'blocked',
      titleKey: 'identityMissingTitle',
      descriptionKey: 'identityMissingDescription',
      action: 'authorize-dws',
    };
  }
  if (!runtime.user) {
    return { tone: 'pending', titleKey: 'userPendingTitle', descriptionKey: 'userPendingDescription', action: 'refresh' };
  }
  return { tone: 'ready', titleKey: 'readyTitle', descriptionKey: 'readyDescription', action: 'refresh' };
}
