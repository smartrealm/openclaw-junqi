export interface VoiceTalkPlaybackAppendResult {
  queued: boolean;
}

export function decodeVoiceTalkPlaybackAppendResult(
  value: unknown,
): VoiceTalkPlaybackAppendResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const queued = (value as Record<string, unknown>).queued;
  return typeof queued === 'boolean' ? { queued } : null;
}
