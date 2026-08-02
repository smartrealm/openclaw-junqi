export interface VoiceWakeResidencyStatus {
  listening: boolean;
  mode: 'dictation' | 'wake_word' | null;
}

/** Only the verified native wake listener may keep the desktop process resident. */
export function shouldKeepVoiceWakeResident(status: VoiceWakeResidencyStatus | null): boolean {
  return status?.listening === true && status.mode === 'wake_word';
}
