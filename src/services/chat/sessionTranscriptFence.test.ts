import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionTranscriptFence } from './sessionTranscriptFence';

test('rejects a history response captured before a session reset', () => {
  const fence = new SessionTranscriptFence();
  const token = fence.capture('agent:main:desktop', 'session-before');
  fence.invalidate('agent:main:desktop');

  assert.equal(fence.isCurrent(token, 'session-before'), false);
  assert.equal(
    fence.isCurrent(fence.capture('agent:main:desktop', 'session-after'), 'session-after'),
    true,
  );
});

test('rejects history belonging to another native session identity', () => {
  const fence = new SessionTranscriptFence();
  const token = fence.capture('agent:main:desktop', 'session-before');
  assert.equal(fence.isCurrent(token, 'session-after'), false);
});
