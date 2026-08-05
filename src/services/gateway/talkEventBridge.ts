import {
  decodeTalkEvent,
  decodeTalkToolCallPayload,
  type TalkEvent,
} from './talkTypes';

export type TalkGatewayEvent = TalkEvent;

export type TalkEventListener = (event: TalkGatewayEvent) => void;

export type TalkRelayEvent =
  | {
    type: 'audio';
    relaySessionId: string;
    turnId: string;
    audioBase64: string;
  }
  | {
    type: 'clear';
    relaySessionId: string;
    turnId: string | null;
  }
  | {
    type: 'mark';
    relaySessionId: string;
    turnId: string;
    markName: string;
  }
  | {
    type: 'toolCall';
    relaySessionId: string;
    callId: string;
    name: string;
    args: unknown;
    forced: boolean;
  }
  | {
    type: 'toolCallCancelled';
    relaySessionId: string;
    callId: string;
  }
  | {
    type: 'toolResult';
    relaySessionId: string;
    callId: string;
    final: boolean;
  }
  | {
    type: 'protocolError';
    relaySessionId: string;
    issue: 'identity' | 'canonical-event' | 'audio' | 'mark' | 'tool';
  };

export type TalkRelayEventListener = (event: TalkRelayEvent) => void;

const listeners = new Set<TalkEventListener>();
const relayListeners = new Set<TalkRelayEventListener>();
const latestSequenceBySession = new Map<string, number>();

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function protocolError(
  relaySessionId: string,
  issue: Extract<TalkRelayEvent, { type: 'protocolError' }>['issue'],
): TalkRelayEvent {
  return { type: 'protocolError', relaySessionId, issue };
}

function decodeRelayEvent(
  payload: Record<string, unknown>,
  talkEvent: TalkEvent | null,
  relaySessionId: string,
): TalkRelayEvent | null {
  const type = payload.type;
  if (type === 'audio') {
    const audioBase64 = nonEmptyString(payload.audioBase64);
    if (!talkEvent
      || (talkEvent.type !== 'output.audio.started' && talkEvent.type !== 'output.audio.delta')
      || !talkEvent.turnId
      || !audioBase64) return protocolError(relaySessionId, 'audio');
    return { type, relaySessionId, turnId: talkEvent.turnId, audioBase64 };
  }
  if (type === 'clear') {
    return { type, relaySessionId, turnId: talkEvent?.turnId ?? null };
  }
  if (type === 'mark') {
    const markName = nonEmptyString(payload.markName);
    const canonicalMarkName = nonEmptyString(record(talkEvent?.payload)?.markName);
    if (!talkEvent || talkEvent.type !== 'output.audio.done' || !talkEvent.turnId
      || !markName || canonicalMarkName !== markName) {
      return protocolError(relaySessionId, 'mark');
    }
    return { type, relaySessionId, turnId: talkEvent.turnId, markName };
  }
  if (type === 'toolCallCancelled') {
    const callId = nonEmptyString(payload.callId);
    return callId
      ? { type, relaySessionId, callId }
      : protocolError(relaySessionId, 'tool');
  }
  if (type === 'toolCall') {
    const callId = nonEmptyString(payload.callId);
    const name = nonEmptyString(payload.name);
    const decodedPayload = decodeTalkToolCallPayload(talkEvent?.payload);
    const forced = payload.forced === undefined ? false : payload.forced;
    if (!talkEvent || talkEvent.type !== 'tool.call' || !callId || talkEvent.callId !== callId
      || !name || !decodedPayload || decodedPayload.name !== name
      || typeof forced !== 'boolean' || decodedPayload.forced !== forced) {
      return protocolError(relaySessionId, 'tool');
    }
    return {
      type,
      relaySessionId,
      callId,
      name,
      args: decodedPayload.args,
      forced,
    };
  }
  if (type === 'toolResult') {
    const callId = nonEmptyString(payload.callId);
    if (!talkEvent || !callId || talkEvent.callId !== callId
      || (talkEvent.type !== 'tool.progress' && talkEvent.type !== 'tool.result'
        && talkEvent.type !== 'tool.error')) {
      return protocolError(relaySessionId, 'tool');
    }
    return {
      type,
      relaySessionId,
      callId,
      final: talkEvent.type !== 'tool.progress'
        && !(talkEvent.type === 'tool.result' && talkEvent.final === false),
    };
  }
  return null;
}

function extract(message: unknown): {
  recognized: boolean;
  event?: TalkGatewayEvent;
  relayEvent?: TalkRelayEvent;
  relayLinkedToEvent?: boolean;
} {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return { recognized: false };
  const envelope = message as Record<string, unknown>;
  if (envelope.type !== 'event' || envelope.event !== 'talk.event') return { recognized: false };
  const payload = record(envelope.payload);
  if (!payload) return { recognized: true };

  const hasCanonicalEvent = Object.prototype.hasOwnProperty.call(payload, 'talkEvent');
  const event = decodeTalkEvent(payload.talkEvent);
  const relaySessionId = nonEmptyString(payload.relaySessionId);
  if (!relaySessionId) {
    return event
      ? {
        recognized: true,
        relayEvent: protocolError(event.sessionId, 'identity'),
      }
      : { recognized: true };
  }
  if (hasCanonicalEvent && !event) {
    return {
      recognized: true,
      relayEvent: protocolError(relaySessionId, 'canonical-event'),
    };
  }
  if (event && event.sessionId !== relaySessionId) {
    return {
      recognized: true,
      relayEvent: protocolError(relaySessionId, 'identity'),
    };
  }

  const relayEvent = decodeRelayEvent(payload, event, relaySessionId);
  return {
    recognized: true,
    ...(event ? { event } : {}),
    ...(relayEvent ? { relayEvent, relayLinkedToEvent: Boolean(event) } : {}),
  };
}

function dispatchRelayEvent(event: TalkRelayEvent): void {
  for (const listener of [...relayListeners]) {
    try { listener(event); } catch { /* 中继监听器不能阻塞 Gateway 事件分发。 */ }
  }
}

function dispatchTalkEvent(event: TalkGatewayEvent): void {
  for (const listener of [...listeners]) {
    try { listener(event); } catch { /* 展示层监听器不能阻塞 Gateway 事件分发。 */ }
  }
}

export function publishTalkGatewayEvent(message: unknown): boolean {
  const extracted = extract(message);
  if (!extracted.recognized) return false;

  let eventAccepted = false;
  if (extracted.event) {
    const latest = latestSequenceBySession.get(extracted.event.sessionId);
    if (latest === undefined || extracted.event.seq > latest) {
      eventAccepted = true;
      latestSequenceBySession.set(extracted.event.sessionId, extracted.event.seq);
      if (latestSequenceBySession.size > 256) {
        const oldest = latestSequenceBySession.keys().next().value;
        if (oldest) latestSequenceBySession.delete(oldest);
      }
    }
  }

  if (extracted.relayEvent && (!extracted.relayLinkedToEvent || eventAccepted)) {
    dispatchRelayEvent(extracted.relayEvent);
  }
  if (eventAccepted && extracted.event) dispatchTalkEvent(extracted.event);
  return true;
}

export function subscribeTalkGatewayEvents(listener: TalkEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeTalkRelayEvents(listener: TalkRelayEventListener): () => void {
  relayListeners.add(listener);
  return () => relayListeners.delete(listener);
}

export function routeTalkGatewayEvent(message: unknown, fallback: (message: unknown) => void): void {
  if (publishTalkGatewayEvent(message)) return;
  fallback(message);
}
