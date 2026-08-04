import type { VoiceWakeGatewayConfiguration } from '@/services/gateway/VoiceWakeGatewayClient';
import {
  includesVoiceWakeTrigger,
  resolveVoiceWakeRoute,
  type VoiceWakeRouteTarget,
} from '@/services/gateway/voiceWakeTypes';

export type VoiceWakeRouteDisposition = 'accepted' | 'unknown_trigger' | 'target_changed';

export interface VoiceWakeRouteContext {
  sessionKey: string;
  agentId?: string;
}

export function hasCompatibleVoiceWakeTrigger(
  modelKeywords: readonly string[],
  configuration: VoiceWakeGatewayConfiguration,
): boolean {
  return modelKeywords.some((keyword) => (
    includesVoiceWakeTrigger(configuration.triggers.triggers, keyword)
  ));
}

function targetsSession(target: VoiceWakeRouteTarget, context: VoiceWakeRouteContext): boolean {
  if ('mode' in target) return true;
  if ('sessionKey' in target) return target.sessionKey === context.sessionKey;
  const agentId = context.agentId?.trim();
  return Boolean(agentId) && agentId === target.agentId;
}

export function decideVoiceWakeRoute(
  configuration: VoiceWakeGatewayConfiguration | null,
  recognizedTrigger: string,
  context: VoiceWakeRouteContext,
): VoiceWakeRouteDisposition {
  if (!configuration || !includesVoiceWakeTrigger(configuration.triggers.triggers, recognizedTrigger)) {
    return 'unknown_trigger';
  }
  return targetsSession(resolveVoiceWakeRoute(configuration.routing, recognizedTrigger), context)
    ? 'accepted'
    : 'target_changed';
}
