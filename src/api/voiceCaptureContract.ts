export interface VoiceCaptureCommandResult {
  ownerId: string;
  listening: boolean;
  stopped: boolean | null;
  reused: boolean;
}

export type VoiceCaptureEvent =
  | { ownerId: string; state: 'listening' }
  | { ownerId: string; state: 'speech_started' }
  | { ownerId: string; state: 'speech_ended' }
  | {
    ownerId: string;
    state: 'pcm';
    data: string;
    encoding: 'pcm16';
    sampleRateHz: number;
    channels: number;
    inputLevel: number;
  }
  | { ownerId: string; state: 'error'; error: string }
  | { ownerId: string; state: 'stopped'; reason: string | null };

export const VOICE_CAPTURE_OWNER_ID_MAX_LENGTH = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maxLength?: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized.length === 0 || (maxLength !== undefined && normalized.length > maxLength)) {
    return null;
  }
  return normalized;
}

export function decodeVoiceCaptureCommandResult(value: unknown): VoiceCaptureCommandResult | null {
  if (!isRecord(value)) return null;
  const ownerId = nonEmptyString(value.ownerId, VOICE_CAPTURE_OWNER_ID_MAX_LENGTH);
  if (!ownerId || typeof value.listening !== 'boolean') return null;
  if (value.stopped !== undefined && typeof value.stopped !== 'boolean') return null;
  if (value.reused !== undefined && typeof value.reused !== 'boolean') return null;
  return {
    ownerId,
    listening: value.listening,
    stopped: typeof value.stopped === 'boolean' ? value.stopped : null,
    reused: value.reused === true,
  };
}

export function decodeVoiceCaptureEvent(value: unknown): VoiceCaptureEvent | null {
  if (!isRecord(value)) return null;
  const ownerId = nonEmptyString(value.ownerId, VOICE_CAPTURE_OWNER_ID_MAX_LENGTH);
  if (!ownerId || typeof value.state !== 'string') return null;

  if (
    value.state === 'listening'
    || value.state === 'speech_started'
    || value.state === 'speech_ended'
  ) {
    return { ownerId, state: value.state };
  }
  if (value.state === 'pcm') {
    if (
      value.encoding !== 'pcm16'
      || typeof value.data !== 'string'
      || value.data.length === 0
      || typeof value.sampleRateHz !== 'number'
      || !Number.isInteger(value.sampleRateHz)
      || value.sampleRateHz < 1
      || typeof value.channels !== 'number'
      || !Number.isInteger(value.channels)
      || value.channels < 1
      || typeof value.inputLevel !== 'number'
      || !Number.isFinite(value.inputLevel)
      || value.inputLevel < 0
      || value.inputLevel > 1
    ) return null;
    return {
      ownerId,
      state: 'pcm',
      data: value.data,
      encoding: 'pcm16',
      sampleRateHz: value.sampleRateHz,
      channels: value.channels,
      inputLevel: value.inputLevel,
    };
  }
  if (value.state === 'error') {
    const error = nonEmptyString(value.error);
    return error ? { ownerId, state: 'error', error } : null;
  }
  if (value.state === 'stopped') {
    const reason = value.reason === undefined ? null : nonEmptyString(value.reason);
    return reason === null && value.reason !== undefined
      ? null
      : { ownerId, state: 'stopped', reason };
  }
  return null;
}
