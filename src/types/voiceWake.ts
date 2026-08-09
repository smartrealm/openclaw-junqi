export interface VoiceWakeTriggerSnapshot {
  triggers: string[];
}

export const MAX_VOICE_WAKE_TRIGGERS = 32;
export const MAX_VOICE_WAKE_TRIGGER_LENGTH = 64;
const OPENCLAW_AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

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

/** 与 Gateway 的路由键规范化保持一致。 */
export function normalizeVoiceWakeRouteTrigger(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ''))
    .filter(Boolean)
    .join(' ');
}

/** 全局触发词仅裁剪首尾空白，保留原始拼写。 */
export function normalizeVoiceWakeListTrigger(value: string): string {
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maxLength?: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0
    && (maxLength === undefined || normalized.length <= maxLength)
    ? normalized
    : null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** 对齐 OpenClaw 标准化核心中的智能体标识输入约束。 */
export function isValidVoiceWakeAgentId(value: string): boolean {
  return value.trim().length > 0 && OPENCLAW_AGENT_ID_PATTERN.test(value.trim());
}

/** 对齐 OpenClaw 语音唤醒路由对规范智能体会话键的校验。 */
export function isCanonicalVoiceWakeSessionKey(value: string): boolean {
  const parts = value.trim().split(':');
  return parts.length >= 3
    && parts[0].toLowerCase() === 'agent'
    && !parts.some((part) => part.length === 0);
}

export function isValidVoiceWakeRouteTarget(target: VoiceWakeRouteTarget): boolean {
  if ('mode' in target) return target.mode === 'current';
  if ('agentId' in target) return isValidVoiceWakeAgentId(target.agentId);
  return isCanonicalVoiceWakeSessionKey(target.sessionKey);
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
    return agentId && isValidVoiceWakeAgentId(agentId) ? { agentId } : null;
  }

  const sessionKey = nonEmptyString(record.sessionKey);
  return sessionKey && isCanonicalVoiceWakeSessionKey(sessionKey) ? { sessionKey } : null;
}

export function decodeVoiceWakeTriggerSnapshot(value: unknown): VoiceWakeTriggerSnapshot | null {
  if (!isRecord(value)) return null;
  const rawTriggers = value.triggers;
  if (
    !Array.isArray(rawTriggers)
    || rawTriggers.length === 0
    || rawTriggers.length > MAX_VOICE_WAKE_TRIGGERS
  ) return null;

  const triggers: string[] = [];
  for (const entry of rawTriggers) {
    const trigger = nonEmptyString(entry, MAX_VOICE_WAKE_TRIGGER_LENGTH);
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
  if (!Array.isArray(rawRoutes) || rawRoutes.length > MAX_VOICE_WAKE_TRIGGERS) return null;
  if (typeof record.updatedAtMs !== 'number' || !Number.isSafeInteger(record.updatedAtMs) || record.updatedAtMs < 0) {
    return null;
  }

  const defaultTarget = decodeVoiceWakeRouteTarget(record.defaultTarget);
  if (!defaultTarget) return null;

  const routes: VoiceWakeRoute[] = [];
  const normalizedTriggers = new Set<string>();
  for (const entry of rawRoutes) {
    const route = isRecord(entry) ? entry : null;
    const trigger = nonEmptyString(route?.trigger, MAX_VOICE_WAKE_TRIGGER_LENGTH);
    const target = decodeVoiceWakeRouteTarget(route?.target);
    const normalizedTrigger = trigger ? normalizeVoiceWakeRouteTrigger(trigger) : '';
    if (!trigger || !target || normalizedTrigger !== trigger || normalizedTriggers.has(normalizedTrigger)) {
      return null;
    }
    normalizedTriggers.add(normalizedTrigger);
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
