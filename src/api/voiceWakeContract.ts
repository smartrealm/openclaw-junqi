export type VoiceWakeCaptureMode = 'dictation' | 'wake_word';

export interface VoiceWakeStatus {
  listening: boolean;
  mode: VoiceWakeCaptureMode | null;
}

export interface NativeVoiceWakeStartRequest extends Record<string, unknown> {
  mode: VoiceWakeCaptureMode;
  streamPcm: boolean;
  ownerId: string;
}

/** 语音采集只能通过带所有者标识的原生 Tauri command 启动。 */
export function createNativeVoiceWakeStartRequest(
  mode: VoiceWakeCaptureMode,
  options: { streamPcm?: boolean; ownerId: string },
): NativeVoiceWakeStartRequest {
  const ownerId = options.ownerId.trim();
  if (!ownerId) throw new Error('voice wake listener owner is required');
  return {
    mode,
    streamPcm: options.streamPcm === true,
    ownerId,
  };
}

export function isRequestedVoiceWakeListener(
  status: VoiceWakeStatus,
  mode: VoiceWakeCaptureMode,
): boolean {
  return status.listening && status.mode === mode;
}
