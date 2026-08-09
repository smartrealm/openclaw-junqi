import {
  decodeVoiceWakeRoutingSnapshot,
  decodeVoiceWakeTriggerSnapshot,
  type VoiceWakeRoutingConfig,
  type VoiceWakeTriggerSnapshot,
} from '@/types/voiceWake';

export type VoiceWakeGatewayEvent =
  | { type: 'triggers'; snapshot: VoiceWakeTriggerSnapshot }
  | { type: 'routing'; config: VoiceWakeRoutingConfig };

export type VoiceWakeGatewayEventListener = (event: VoiceWakeGatewayEvent) => void;

const listeners = new Set<VoiceWakeGatewayEventListener>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extractVoiceWakeEvent(message: unknown): { recognized: boolean; event?: VoiceWakeGatewayEvent } {
  if (!isRecord(message) || message.type !== 'event') return { recognized: false };
  const envelope = message;

  if (envelope.event === 'voicewake.changed') {
    const snapshot = decodeVoiceWakeTriggerSnapshot(envelope.payload);
    return snapshot
      ? { recognized: true, event: { type: 'triggers', snapshot } }
      : { recognized: true };
  }

  if (envelope.event === 'voicewake.routing.changed') {
    const config = decodeVoiceWakeRoutingSnapshot(envelope.payload);
    return config
      ? { recognized: true, event: { type: 'routing', config } }
      : { recognized: true };
  }

  return { recognized: false };
}

export function publishVoiceWakeGatewayEvent(message: unknown): boolean {
  const extracted = extractVoiceWakeEvent(message);
  if (!extracted.recognized) return false;
  if (!extracted.event) return true;

  for (const listener of [...listeners]) {
    try {
      listener(extracted.event);
    } catch {
      // A presentation listener must not block the Gateway event dispatcher.
    }
  }
  return true;
}

export function subscribeVoiceWakeGatewayEvents(listener: VoiceWakeGatewayEventListener): () => void {
  listeners.add(listener);
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    listeners.delete(listener);
  };
}

export function routeVoiceWakeGatewayEvent(
  message: unknown,
  fallback: (message: unknown) => void,
): void {
  if (publishVoiceWakeGatewayEvent(message)) return;
  fallback(message);
}
