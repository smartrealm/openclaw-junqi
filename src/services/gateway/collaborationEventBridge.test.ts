import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishCollaborationChangedEvent,
  routeGatewayEvent,
  subscribeCollaborationChangedHints,
} from './collaborationEventBridge';

const HINT = {
  collaborationInstanceId: 'instance-a',
  runId: 'run-1',
  runRevision: 7,
  lastSequence: 11,
};

test('routes the OpenClaw agent stream shape to typed collaboration listeners only', () => {
  const seen: unknown[] = [];
  let fallbackCalls = 0;
  const unsubscribe = subscribeCollaborationChangedHints((hint) => seen.push(hint));
  try {
    routeGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: { stream: 'junqi-collab.changed', data: HINT },
    }, () => { fallbackCalls += 1; });
  } finally {
    unsubscribe();
  }

  assert.deepEqual(seen, [HINT]);
  assert.equal(fallbackCalls, 0);
});

test('accepts the documented direct event shape without coupling it to ChatHandler', () => {
  const seen: unknown[] = [];
  const unsubscribe = subscribeCollaborationChangedHints((hint) => seen.push(hint));
  try {
    assert.equal(publishCollaborationChangedEvent({
      type: 'event',
      event: 'junqi-collab.changed',
      payload: HINT,
    }), true);
  } finally {
    unsubscribe();
  }
  assert.deepEqual(seen, [HINT]);
});

test('malformed reserved hints fail closed and do not fall through or throw', () => {
  const seen: unknown[] = [];
  let fallbackCalls = 0;
  const unsubscribe = subscribeCollaborationChangedHints((hint) => seen.push(hint));
  const malformed = [
    null,
    {},
    { ...HINT, collaborationInstanceId: ' ' },
    { ...HINT, runId: '' },
    { ...HINT, runRevision: '7' },
    { ...HINT, runRevision: -1 },
    { ...HINT, lastSequence: Number.MAX_SAFE_INTEGER + 1 },
  ];
  try {
    for (const data of malformed) {
      assert.doesNotThrow(() => routeGatewayEvent({
        type: 'event',
        event: 'agent',
        payload: { stream: 'junqi-collab.changed', data },
      }, () => { fallbackCalls += 1; }));
    }
  } finally {
    unsubscribe();
  }

  assert.deepEqual(seen, []);
  assert.equal(fallbackCalls, 0);
});

test('unrelated events retain normal routing and listener failures are isolated', () => {
  let fallbackMessage: unknown;
  const unrelated = { type: 'event', event: 'agent', payload: { stream: 'assistant' } };
  routeGatewayEvent(unrelated, (message) => { fallbackMessage = message; });
  assert.equal(fallbackMessage, unrelated);

  const seen: unknown[] = [];
  const removeThrowing = subscribeCollaborationChangedHints(() => { throw new Error('listener failed'); });
  const removeHealthy = subscribeCollaborationChangedHints((hint) => seen.push(hint));
  try {
    assert.doesNotThrow(() => publishCollaborationChangedEvent({
      type: 'event',
      event: 'agent',
      payload: { stream: 'junqi-collab.changed', data: HINT },
    }));
  } finally {
    removeThrowing();
    removeThrowing();
    removeHealthy();
  }
  assert.deepEqual(seen, [HINT]);
});
