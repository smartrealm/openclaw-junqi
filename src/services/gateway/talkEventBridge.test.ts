import assert from 'node:assert/strict';
import test from 'node:test';
import { publishTalkGatewayEvent, subscribeTalkGatewayEvents } from './talkEventBridge';

function event(sessionId: string, seq: number) {
  return {
    type: 'event', event: 'talk.event', payload: {
      relaySessionId: sessionId,
      type: 'audio',
      audioBase64: 'AA==',
      talkEvent: {
        id: `${sessionId}-${seq}`, type: 'output.audio.started', sessionId, turnId: `turn-${seq}`, seq,
        timestamp: '2026-08-02T00:00:00.000Z', mode: 'realtime', transport: 'gateway-relay', brain: 'agent-consult', payload: {},
      },
    },
  };
}

test('Talk event bridge publishes valid events once per monotonic session sequence', () => {
  const received: number[] = [];
  const unsubscribe = subscribeTalkGatewayEvents((value) => received.push(value.seq));
  try {
    assert.equal(publishTalkGatewayEvent(event('talk-event-test-a', 1)), true);
    assert.equal(publishTalkGatewayEvent(event('talk-event-test-a', 1)), true);
    assert.equal(publishTalkGatewayEvent(event('talk-event-test-a', 2)), true);
    assert.deepEqual(received, [1, 2]);
  } finally { unsubscribe(); }
});

test('Talk event bridge consumes malformed Talk envelopes without routing them as chat events', () => {
  assert.equal(publishTalkGatewayEvent({ type: 'event', event: 'talk.event', payload: { talkEvent: { sessionId: 'missing-fields' } } }), true);
  assert.equal(publishTalkGatewayEvent(event('talk-event-invalid-seq', 0)), true);
  assert.equal(publishTalkGatewayEvent({ type: 'event', event: 'agent', payload: {} }), false);
});
