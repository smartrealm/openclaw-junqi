import assert from 'node:assert/strict';
import test from 'node:test';
import { projectChatNotification } from './chatNotificationProjection';

const baseEvent = {
  sessionKey: 'agent:main:main',
  role: 'assistant',
  text: 'Completed response.',
};

test('chat notification projection shares one run identity across live and durable events', () => {
  const live = projectChatNotification({
    ...baseEvent,
    source: 'stream-final',
    runId: 'run-42',
    nativeMessageId: 'live-message',
  });
  const durable = projectChatNotification({
    ...baseEvent,
    source: 'transcript',
    runId: 'run-42',
    nativeMessageId: 'durable-message',
    messageSeq: 9,
  });

  assert.equal(live?.dedupeKey, 'chat:assistant:agent:main:main:run-42');
  assert.equal(durable?.dedupeKey, live?.dedupeKey);
});

test('chat notification projection rejects ambiguous or already live-projected sources', () => {
  assert.equal(projectChatNotification({
    ...baseEvent,
    source: 'legacy-message',
    nativeMessageId: 'legacy-message',
  }), null);
  assert.equal(projectChatNotification({
    ...baseEvent,
    source: 'transcript',
    runId: 'run-42',
    liveProjected: true,
  }), null);
  assert.equal(projectChatNotification({
    ...baseEvent,
    source: 'stream-final',
  }), null);
  assert.equal(projectChatNotification({
    ...baseEvent,
    source: 'stream-final',
    runId: 'run-empty-reply',
    text: '   ',
  }), null);
});

test('chat notification projection classifies durable user messages without conflating them with replies', () => {
  const projected = projectChatNotification({
    ...baseEvent,
    source: 'transcript',
    role: 'user',
    clientMessageId: 'client-message-7',
  });

  assert.deepEqual(projected, {
    kind: 'message',
    body: 'Completed response.',
    dedupeKey: 'chat:user:agent:main:main:client-message-7',
  });
});
