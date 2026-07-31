import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishVoiceWakeGatewayEvent,
  subscribeVoiceWakeGatewayEvents,
} from './voiceWakeEventBridge';

test('voice wake event bridge publishes only valid trigger events', () => {
  const received: string[][] = [];
  const unsubscribe = subscribeVoiceWakeGatewayEvents((event) => {
    if (event.type === 'triggers') received.push(event.snapshot.triggers);
  });

  try {
    assert.equal(publishVoiceWakeGatewayEvent({
      type: 'event',
      event: 'voicewake.changed',
      payload: { triggers: ['junqi'] },
    }), true);
    assert.equal(publishVoiceWakeGatewayEvent({
      type: 'event',
      event: 'voicewake.changed',
      payload: { triggers: [17] },
    }), true);
    assert.deepEqual(received, [['junqi']]);
  } finally {
    unsubscribe();
  }
});

test('voice wake event bridge does not swallow unrelated Gateway events', () => {
  assert.equal(publishVoiceWakeGatewayEvent({ type: 'event', event: 'agent', payload: {} }), false);
});

test('voice wake event bridge decodes the routing change wrapper from Gateway', () => {
  const received: string[] = [];
  const unsubscribe = subscribeVoiceWakeGatewayEvents((event) => {
    if (event.type === 'routing' && 'mode' in event.config.defaultTarget) {
      received.push(event.config.defaultTarget.mode);
    }
  });

  try {
    assert.equal(publishVoiceWakeGatewayEvent({
      type: 'event',
      event: 'voicewake.routing.changed',
      payload: {
        config: {
          version: 1,
          defaultTarget: { mode: 'current' },
          routes: [],
          updatedAtMs: 100,
        },
      },
    }), true);
    assert.deepEqual(received, ['current']);
  } finally {
    unsubscribe();
  }
});
