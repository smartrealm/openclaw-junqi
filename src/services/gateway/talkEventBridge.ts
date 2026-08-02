import { decodeTalkEvent, type TalkEvent } from './talkTypes';

export interface TalkGatewayEvent extends TalkEvent {
  audioBase64: string | null;
  relayType: string | null;
}

export type TalkEventListener = (event: TalkGatewayEvent) => void;

const listeners = new Set<TalkEventListener>();
const latestSequenceBySession = new Map<string, number>();

function extract(message: unknown): { recognized: boolean; event?: TalkGatewayEvent } {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return { recognized: false };
  const envelope = message as Record<string, unknown>;
  if (envelope.type !== 'event' || envelope.event !== 'talk.event') return { recognized: false };
  if (!envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) {
    return { recognized: true };
  }
  // Gateway relay delivery includes transport data such as `audioBase64` beside
  // the canonical event envelope. Only `talkEvent` has the session sequence.
  const payload = envelope.payload as Record<string, unknown>;
  const event = decodeTalkEvent(payload.talkEvent);
  if (!event) return { recognized: true };
  const audioBase64 = typeof payload.audioBase64 === 'string' && payload.audioBase64.length > 0
    ? payload.audioBase64
    : null;
  return {
    recognized: true,
    event: { ...event, audioBase64, relayType: typeof payload.type === 'string' ? payload.type : null },
  };
}

export function publishTalkGatewayEvent(message: unknown): boolean {
  const extracted = extract(message);
  if (!extracted.recognized) return false;
  const event = extracted.event;
  if (!event) return true;
  const latest = latestSequenceBySession.get(event.sessionId);
  if (latest !== undefined && event.seq <= latest) return true;
  latestSequenceBySession.set(event.sessionId, event.seq);
  if (event.type === 'session.closed' || event.type === 'session.error') {
    latestSequenceBySession.delete(event.sessionId);
  } else if (latestSequenceBySession.size > 256) {
    const oldest = latestSequenceBySession.keys().next().value;
    if (oldest) latestSequenceBySession.delete(oldest);
  }
  for (const listener of [...listeners]) {
    try { listener(event); } catch { /* Presentation listeners cannot block gateway dispatch. */ }
  }
  return true;
}

export function subscribeTalkGatewayEvents(listener: TalkEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function routeTalkGatewayEvent(message: unknown, fallback: (message: unknown) => void): void {
  if (publishTalkGatewayEvent(message)) return;
  fallback(message);
}
