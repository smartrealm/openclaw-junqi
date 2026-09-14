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
    | 'update-openclaw'
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
  agentRuntimeVerified,
  runtime,
  runtimeError,
  pluginNeedsInstall,
  pluginStatusPending,
  restartRequired,
  pluginCompatibility,
  gatewayVersion,
  minimumGatewayVersion,
  agentId,
}: {
  sessionExists: boolean;
  runtimeToolAvailable: boolean;
  agentRuntimeVerified: boolean;
  runtime: DingTalkRuntimeIdentityProjection | null;
  runtimeError: string | null;
  pluginNeedsInstall: boolean;
  pluginStatusPending: boolean;
  restartRequired: boolean;
  pluginCompatibility?: 'compatible' | 'incompatible' | 'unknown';
  gatewayVersion?: string | null;
  minimumGatewayVersion?: string | null;
  agentId: string | null;
}): DingTalkReadiness {
  if (!sessionExists) {
    return { tone: 'blocked', titleKey: 'sessionRequiredTitle', descriptionKey: 'sessionRequiredDescription', action: null };
  }
  if (!runtimeToolAvailable) {
    if (pluginNeedsInstall && pluginCompatibility === 'incompatible') {
      return {
        tone: 'blocked',
        titleKey: 'pluginRuntimeIncompatibleTitle',
        descriptionKey: 'pluginRuntimeIncompatibleDescription',
        descriptionParams: {
          gatewayVersion: gatewayVersion ?? '-',
          minimumGatewayVersion: minimumGatewayVersion ?? '-',
        },
        action: 'update-openclaw',
      };
    }
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
    return {
      tone: 'pending',
      titleKey: 'agentAuthorizationPendingTitle',
      rawDescription: runtimeError,
      action: 'configure-agent',
    };
  }
  if (!runtime || !agentRuntimeVerified) {
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
