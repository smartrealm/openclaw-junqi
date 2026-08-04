import type {
  VoiceWakeGatewayEvent,
  VoiceWakeGatewayEventListener,
} from '@/services/gateway/voiceWakeEventBridge';
import type { VoiceWakeRoutingConfig } from '@/services/gateway/voiceWakeTypes';

export type VoiceWakeGatewayEventSubscriber = (
  listener: VoiceWakeGatewayEventListener,
) => () => void;

/** 把 Gateway 拥有的触发词和路由事件投影到设置视图。 */
export function subscribeVoiceWakeSettingsProjection(
  subscribe: VoiceWakeGatewayEventSubscriber,
  replaceTriggers: (triggers: readonly string[]) => void,
  replaceRouting: (routing: VoiceWakeRoutingConfig) => void,
): () => void {
  return subscribe((event: VoiceWakeGatewayEvent) => {
    if (event.type === 'triggers') {
      replaceTriggers([...event.snapshot.triggers]);
      return;
    }
    replaceRouting({
      ...event.config,
      defaultTarget: { ...event.config.defaultTarget },
      routes: event.config.routes.map((route) => ({
        trigger: route.trigger,
        target: { ...route.target },
      })),
    });
  });
}
