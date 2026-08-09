import assert from 'node:assert/strict';
import test from 'node:test';
import { chatNotificationTarget, projectChatNotification } from './chatNotificationProjection';

const baseEvent = {
  sessionKey: 'agent:main:main',
  role: 'assistant',
  text: 'Completed response.',
};

test('chat notification projection uses the native OpenClaw run identity', () => {
  const projected = projectChatNotification({
    ...baseEvent,
    runId: 'run-42',
  });

  assert.equal(projected?.dedupeKey, 'chat:assistant:agent:main:main:run-42');
});

test('chat notification target preserves the full OpenClaw session key', () => {
  assert.equal(
    chatNotificationTarget('agent:research/main?draft'),
    '/chat?session=agent%3Aresearch%2Fmain%3Fdraft',
  );
});

test('chat notification projection rejects a missing native run identity or empty body', () => {
  assert.equal(projectChatNotification({
    ...baseEvent,
    runId: undefined,
  }), null);
  assert.equal(projectChatNotification({
    ...baseEvent,
    runId: 'run-empty-reply',
    text: '   ',
  }), null);
});
