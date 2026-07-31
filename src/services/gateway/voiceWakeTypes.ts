export interface VoiceWakeTriggerSnapshot {
  triggers: string[];
}

export type VoiceWakeRouteTarget =
  | { mode: 'current' }
  | { agentId: string }
  | { sessionKey: string };

export interface VoiceWakeRoute {
  trigger: string;
  target: VoiceWakeRouteTarget;
}

export interface VoiceWakeRoutingConfig {
  version: 1;
  defaultTarget: VoiceWakeRouteTarget;
  routes: VoiceWakeRoute[];
  updatedAtMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maxLength = 64): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function decodeVoiceWakeRouteTarget(value: unknown): VoiceWakeRouteTarget | null {
  if (!isRecord(value)) return null;
  const record = value;
  const hasMode = hasOwn(record, 'mode');
  const hasAgentId = hasOwn(record, 'agentId');
  const hasSessionKey = hasOwn(record, 'sessionKey');
  const targetCount = Number(hasMode) + Number(hasAgentId) + Number(hasSessionKey);
  if (targetCount !== 1) return null;

  if (hasMode) return record.mode === 'current' ? { mode: 'current' } : null;

  if (hasAgentId) {
    const agentId = nonEmptyString(record.agentId);
    return agentId ? { agentId } : null;
  }

  const sessionKey = nonEmptyString(record.sessionKey, 512);
  return sessionKey ? { sessionKey } : null;
}

export function decodeVoiceWakeTriggerSnapshot(value: unknown): VoiceWakeTriggerSnapshot | null {
  if (!isRecord(value)) return null;
  const rawTriggers = value.triggers;
  if (!Array.isArray(rawTriggers) || rawTriggers.length > 32) return null;

  const triggers: string[] = [];
  for (const entry of rawTriggers) {
    const trigger = nonEmptyString(entry);
    if (!trigger) return null;
    triggers.push(trigger);
  }
  return { triggers };
}

export function decodeVoiceWakeRoutingConfig(value: unknown): VoiceWakeRoutingConfig | null {
  if (!isRecord(value) || value.version !== 1) {
    return null;
  }
  const record = value;
  const rawRoutes = record.routes;
  if (!Array.isArray(rawRoutes) || rawRoutes.length > 32) return null;
  if (typeof record.updatedAtMs !== 'number' || !Number.isFinite(record.updatedAtMs) || record.updatedAtMs < 0) {
    return null;
  }

  const defaultTarget = decodeVoiceWakeRouteTarget(record.defaultTarget);
  if (!defaultTarget) return null;

  const routes: VoiceWakeRoute[] = [];
  for (const entry of rawRoutes) {
    const route = isRecord(entry) ? entry : null;
    const trigger = nonEmptyString(route?.trigger);
    const target = decodeVoiceWakeRouteTarget(route?.target);
    if (!trigger || !target) return null;
    routes.push({ trigger, target });
  }

  return {
    version: 1,
    defaultTarget,
    routes,
    updatedAtMs: record.updatedAtMs,
  };
}

export function decodeVoiceWakeRoutingSnapshot(value: unknown): VoiceWakeRoutingConfig | null {
  return isRecord(value) ? decodeVoiceWakeRoutingConfig(value.config) : null;
}
