import { resolveOpenClawSessionTarget } from '@/services/gateway/OpenClawSessionTarget';
import {
  normalizeVoiceWakeRouteTrigger,
  type VoiceWakeRouteTarget,
  type VoiceWakeRoutingConfig,
} from '@/types/voiceWake';

export interface NativeVoiceWakeSessionProjection {
  activeSessionKey: string;
  sessions: readonly {
    key: string;
    agentId?: string;
  }[];
}

export function resolveNativeVoiceWakeTarget(
  config: VoiceWakeRoutingConfig,
  trigger: string,
): VoiceWakeRouteTarget {
  const normalizedTrigger = normalizeVoiceWakeRouteTrigger(trigger);
  const route = config.routes.find((candidate) => candidate.trigger === normalizedTrigger);
  return route ? { ...route.target } : { ...config.defaultTarget };
}

/** 只从 Gateway 会话投影解析目标，不拼接或猜测新的会话键。 */
export function resolveNativeVoiceWakeSessionKey(
  target: VoiceWakeRouteTarget,
  projection: NativeVoiceWakeSessionProjection,
  resolvedAgentSessionKey: string | null = null,
): string | null {
  if ('mode' in target) {
    return projection.sessions.some((session) => session.key === projection.activeSessionKey)
      ? projection.activeSessionKey
      : null;
  }
  if ('sessionKey' in target) {
    return projection.sessions.some((session) => session.key === target.sessionKey)
      ? target.sessionKey
      : null;
  }

  if (!resolvedAgentSessionKey) return null;
  let resolvedTargetKey: string;
  try {
    resolvedTargetKey = resolveOpenClawSessionTarget(
      resolvedAgentSessionKey,
      target.agentId,
    ).key;
  } catch {
    return null;
  }
  const candidates = projection.sessions.filter((session) => session.agentId === target.agentId);
  const matches = candidates.filter((session) => {
    try {
      return resolveOpenClawSessionTarget(session.key, session.agentId).key
        === resolvedTargetKey;
    } catch {
      return false;
    }
  });
  return matches.length === 1 ? matches[0].key : null;
}
