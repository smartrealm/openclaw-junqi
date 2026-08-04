export type VoiceWakeCaptureMode = 'dictation' | 'wake_word';

export interface VoiceWakeStatus {
  listening: boolean;
  mode: VoiceWakeCaptureMode | null;
}

export function isRequestedVoiceWakeListener(
  status: VoiceWakeStatus,
  mode: VoiceWakeCaptureMode,
): boolean {
  return status.listening && status.mode === mode;
}
