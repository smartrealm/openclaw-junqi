export type NativeVoiceWakePhase =
  | 'checking'
  | 'unsupported'
  | 'disabled'
  | 'waiting_gateway'
  | 'paused_busy'
  | 'preparing'
  | 'listening'
  | 'activating'
  | 'error';

export interface NativeVoiceWakePolicyInput {
  capability: boolean | null;
  enabled: boolean;
  connected: boolean;
  voiceBusy: boolean;
  triggersReady: boolean;
  error: string | null;
}

export interface NativeVoiceWakePolicy {
  phase: NativeVoiceWakePhase;
  shouldListen: boolean;
}

/** 本地监听必须同时满足平台、用户偏好、Gateway 配置和麦克风空闲条件。 */
export function resolveNativeVoiceWakePolicy(
  input: NativeVoiceWakePolicyInput,
): NativeVoiceWakePolicy {
  if (input.capability === null) return { phase: 'checking', shouldListen: false };
  if (!input.capability) return { phase: 'unsupported', shouldListen: false };
  if (!input.enabled) return { phase: 'disabled', shouldListen: false };
  if (!input.connected) return { phase: 'waiting_gateway', shouldListen: false };
  if (input.voiceBusy) return { phase: 'paused_busy', shouldListen: false };
  if (input.error) return { phase: 'error', shouldListen: false };
  if (!input.triggersReady) return { phase: 'preparing', shouldListen: false };
  return { phase: 'preparing', shouldListen: true };
}
