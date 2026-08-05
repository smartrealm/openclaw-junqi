import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOpenClawChatSendTiming } from './chatSendTiming';

test('decodes the official OpenClaw chat.send_timing payload without inferring fields', () => {
  assert.deepEqual(parseOpenClawChatSendTiming({
    sessionKey: ' agent:main:chat ',
    runId: ' run-1 ',
    phase: 'agent-run-started',
    ackToPhaseMs: 12.25,
    receivedToPhaseMs: 18.5,
    dispatchStartedToPhaseMs: 8,
    provider: 'example-provider',
  }), {
    sessionKey: 'agent:main:chat',
    runId: 'run-1',
    phase: 'agent-run-started',
    ackToPhaseMs: 12.25,
    receivedToPhaseMs: 18.5,
    dispatchStartedToPhaseMs: 8,
  });
});

test('rejects malformed and unknown OpenClaw chat.send_timing payloads', () => {
  for (const payload of [
    null,
    {},
    { sessionKey: 'session', runId: 'run', phase: 'future-phase', ackToPhaseMs: 1, receivedToPhaseMs: 2 },
    { sessionKey: 'session', runId: 'run', phase: 'dispatch-started', ackToPhaseMs: -1, receivedToPhaseMs: 2 },
    { sessionKey: 'session', runId: 'run', phase: 'dispatch-started', ackToPhaseMs: 1, receivedToPhaseMs: '2' },
    { sessionKey: 'session', runId: 'run', phase: 'dispatch-started', ackToPhaseMs: 1, receivedToPhaseMs: 2, dispatchStartedToPhaseMs: -1 },
  ]) {
    assert.equal(parseOpenClawChatSendTiming(payload), null);
  }
});
