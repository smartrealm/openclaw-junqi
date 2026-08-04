import type {
  VoiceWakeGatewayEvent,
  VoiceWakeGatewayEventListener,
} from '@/services/gateway/voiceWakeEventBridge';

export type VoiceWakeGatewayEventSubscriber = (
  listener: VoiceWakeGatewayEventListener,
) => () => void;

/** Projects only Gateway-owned trigger events into the Settings view model. */
export function subscribeVoiceWakeSettingsTriggerProjection(
  subscribe: VoiceWakeGatewayEventSubscriber,
  replaceTriggers: (triggers: readonly string[]) => void,
): () => void {
  return subscribe((event: VoiceWakeGatewayEvent) => {
    if (event.type !== 'triggers') return;
    replaceTriggers([...event.snapshot.triggers]);
  });
}
