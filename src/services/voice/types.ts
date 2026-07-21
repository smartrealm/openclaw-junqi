export type VoicePhase =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'queued'
  | 'speaking'
  | 'interrupted'
  | 'error';

export const VOICE_INTERRUPT_EVENT = 'junqi:voice-interrupt';
export const VOICE_MEDIA_REQUEST_EVENT = 'junqi:voice-media-request';
export const VOICE_GLOBAL_CONTROL_EVENT = 'junqi:voice-global-control';

export interface VoiceGlobalClaim {
  claimedAt: number;
  sequence: number;
  instanceId: string;
  sessionKey: string;
}

export type VoiceGlobalControl =
  | { type: 'claim'; claim: VoiceGlobalClaim }
  | { type: 'release'; claim: VoiceGlobalClaim }
  | { type: 'stop'; claim: VoiceGlobalClaim };

export interface VoiceRuntimeSnapshot {
  phase: VoicePhase;
  sessionKey: string | null;
  queueLength: number;
  startedAt: number | null;
  lastError: string | null;
}

export function compareVoiceGlobalClaims(left: VoiceGlobalClaim, right: VoiceGlobalClaim): number {
  if (left.claimedAt !== right.claimedAt) return left.claimedAt - right.claimedAt;
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  return left.instanceId.localeCompare(right.instanceId);
}
