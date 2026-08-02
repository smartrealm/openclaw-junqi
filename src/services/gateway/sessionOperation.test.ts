import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeOpenClawSessionOperation,
  parseOpenClawSessionOperationEvent,
} from './sessionOperation';

const translate = (key: string, options?: { reason: string }): string => (
  options ? `${key}:${options.reason}` : key
);

test('decodes the official session.operation compact start and end fields', () => {
  const start = parseOpenClawSessionOperationEvent({
    operationId: 'op-1',
    operation: 'compact',
    phase: 'start',
    sessionKey: 'agent:main:main',
    agentId: 'main',
    ts: 1_725_000_000_000,
  });
  assert.deepEqual(start, {
    operationId: 'op-1',
    operation: 'compact',
    phase: 'start',
    sessionKey: 'agent:main:main',
    agentId: 'main',
    ts: 1_725_000_000_000,
  });

  const end = parseOpenClawSessionOperationEvent({
    operationId: 'op-1',
    operation: 'compact',
    phase: 'end',
    sessionKey: 'agent:main:main',
    ts: 1_725_000_000_100,
    completed: false,
    reason: 'session changed',
  });
  assert.equal(end?.completed, false);
  assert.equal(end?.reason, 'session changed');
});

test('rejects malformed or non-official operation payloads', () => {
  assert.equal(parseOpenClawSessionOperationEvent(null), null);
  assert.equal(parseOpenClawSessionOperationEvent({
    operationId: 'op-1',
    operation: 'compact',
    phase: 'end',
    sessionKey: 'agent:main:main',
    ts: 1.5,
  }), null);
  assert.equal(parseOpenClawSessionOperationEvent({
    operationId: 'op-1',
    operation: 'reset',
    phase: 'end',
    sessionKey: 'agent:main:main',
    ts: 1,
  }), null);
  assert.equal(parseOpenClawSessionOperationEvent({
    operationId: 'op-1',
    operation: 'compact',
    phase: 'end',
    sessionKey: 'agent:main:main',
    ts: 1,
    completed: 'true',
  }), null);
  assert.equal(parseOpenClawSessionOperationEvent({
    operationId: 'op-1',
    operation: 'compact',
    phase: 'end',
    sessionKey: 'agent:main:main',
    ts: 1,
    runId: 'not-in-the-official-schema',
  }), null);
});

test('does not claim success when OpenClaw omits the terminal completion flag', () => {
  const operation = parseOpenClawSessionOperationEvent({
    operationId: 'op-2',
    operation: 'compact',
    phase: 'end',
    sessionKey: 'agent:main:main',
    ts: 2,
  });
  assert.ok(operation);
  assert.deepEqual(describeOpenClawSessionOperation(operation, translate), {
    kind: 'compaction',
    text: 'chat.sessionCompactionEnded',
  });
});
