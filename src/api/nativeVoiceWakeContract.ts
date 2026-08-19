export const NATIVE_VOICE_WAKE_EVENT = 'voice-wake-native';
export const NATIVE_VOICE_WAKE_OWNER_ID_MAX_LENGTH = 128;
export const NATIVE_VOICE_WAKE_TRIGGER_MAX_COUNT = 32;
export const NATIVE_VOICE_WAKE_TRIGGER_MAX_UTF16_LENGTH = 64;

export interface NativeVoiceWakeCapability {
  supported: boolean;
  engine: 'windows-sapi' | null;
}

export interface NativeVoiceWakeCommandResult {
  ownerId: string;
  supported: boolean;
  listening: boolean;
  reused: boolean;
  stopped: boolean;
}

export type NativeVoiceWakeEvent =
  | { ownerId: string; state: 'listening' }
  | { ownerId: string; state: 'detected'; trigger: string }
  | { ownerId: string; state: 'error'; error: string }
  | { ownerId: string; state: 'stopped' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maxLength?: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || (maxLength !== undefined && normalized.length > maxLength)) return null;
  return normalized;
}

export function decodeNativeVoiceWakeCapability(value: unknown): NativeVoiceWakeCapability | null {
  if (!isRecord(value) || typeof value.supported !== 'boolean') return null;
  if (value.supported) {
    return value.engine === 'windows-sapi'
      ? { supported: true, engine: 'windows-sapi' }
      : null;
  }
  return value.engine === null
    ? { supported: false, engine: null }
    : null;
}

export function decodeNativeVoiceWakeCommandResult(
  value: unknown,
): NativeVoiceWakeCommandResult | null {
  if (!isRecord(value)) return null;
  const ownerId = nonEmptyString(value.ownerId, NATIVE_VOICE_WAKE_OWNER_ID_MAX_LENGTH);
  if (
    !ownerId
    || typeof value.supported !== 'boolean'
    || typeof value.listening !== 'boolean'
    || typeof value.reused !== 'boolean'
    || typeof value.stopped !== 'boolean'
  ) return null;
  if (!value.supported && (value.listening || value.reused || value.stopped)) return null;
  return {
    ownerId,
    supported: value.supported,
    listening: value.listening,
    reused: value.reused,
    stopped: value.stopped,
  };
}

export function decodeNativeVoiceWakeEvent(value: unknown): NativeVoiceWakeEvent | null {
  if (!isRecord(value)) return null;
  const ownerId = nonEmptyString(value.ownerId, NATIVE_VOICE_WAKE_OWNER_ID_MAX_LENGTH);
  if (!ownerId || typeof value.state !== 'string') return null;
  if (value.state === 'listening' || value.state === 'stopped') {
    return { ownerId, state: value.state };
  }
  if (value.state === 'detected') {
    const trigger = nonEmptyString(value.trigger, NATIVE_VOICE_WAKE_TRIGGER_MAX_UTF16_LENGTH);
    return trigger ? { ownerId, state: 'detected', trigger } : null;
  }
  if (value.state === 'error') {
    const error = nonEmptyString(value.error);
    return error ? { ownerId, state: 'error', error } : null;
  }
  return null;
}

export function normalizeNativeVoiceWakeTriggers(triggers: readonly string[]): string[] | null {
  if (triggers.length < 1 || triggers.length > NATIVE_VOICE_WAKE_TRIGGER_MAX_COUNT) return null;
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const trigger of triggers) {
    const value = trigger.trim();
    if (!value || value.length > NATIVE_VOICE_WAKE_TRIGGER_MAX_UTF16_LENGTH) return null;
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(value);
    }
  }
  return normalized.length > 0 ? normalized : null;
}
