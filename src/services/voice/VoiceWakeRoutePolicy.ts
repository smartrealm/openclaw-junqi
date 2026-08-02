import type { VoiceWakeGatewayConfiguration } from '@/services/gateway/VoiceWakeGatewayClient';
import {
  includesVoiceWakeTrigger,
  resolveVoiceWakeRoute,
  type VoiceWakeRouteTarget,
} from '@/services/gateway/voiceWakeTypes';

export type VoiceWakeRouteDisposition = 'accepted' | 'unknown_trigger' | 'target_changed';

function targetsSession(target: VoiceWakeRouteTarget, sessionKey: string): boolean {
  if ('mode' in target) return true;
  if ('sessionKey' in target) return target.sessionKey === sessionKey;
  const [, agentId] = sessionKey.split(':');
  return agentId === target.agentId;
}

export function decideVoiceWakeRoute(
  configuration: VoiceWakeGatewayConfiguration | null,
  recognizedTrigger: string,
  sessionKey: string,
): VoiceWakeRouteDisposition {
  if (!configuration || !includesVoiceWakeTrigger(configuration.triggers.triggers, recognizedTrigger)) {
    return 'unknown_trigger';
  }
  return targetsSession(resolveVoiceWakeRoute(configuration.routing, recognizedTrigger), sessionKey)
    ? 'accepted'
    : 'target_changed';
}
