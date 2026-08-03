import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSessionOperationEvent } from './sessionOperation';

test('parses the official compact session.operation start payload', () => {
  assert.deepEqual(parseSessionOperationEvent({
    operationId: 'operation-1',
    operation: 'compact',
    phase: 'start',
    sessionKey: 'agent:main:main',
    agentId: 'main',
    ts: 1_754_000_000_000,
  }), {
    operationId: 'operation-1',
    operation: 'compact',
    phase: 'start',
    sessionKey: 'agent:main:main',
    agentId: 'main',
    ts: 1_754_000_000_000,
  });
});

test('parses the official compact session.operation end payload', () => {
  assert.deepEqual(parseSessionOperationEvent({
    operationId: 'operation-1',
    operation: 'compact',
    phase: 'end',
    sessionKey: 'agent:main:main',
    ts: 1_754_000_000_123,
    completed: true,
    reason: 'manual',
  }), {
    operationId: 'operation-1',
    operation: 'compact',
    phase: 'end',
    sessionKey: 'agent:main:main',
    ts: 1_754_000_000_123,
    completed: true,
    reason: 'manual',
  });
});

test('rejects incomplete or non-compact session operations', () => {
  assert.equal(parseSessionOperationEvent({
    operationId: 'operation-1', operation: 'compact', phase: 'end',
    sessionKey: 'agent:main:main', ts: 1_754_000_000_123,
  }), null);
  assert.equal(parseSessionOperationEvent({
    operationId: 'operation-1', operation: 'reset', phase: 'start',
    sessionKey: 'agent:main:main', ts: 1_754_000_000_123,
  }), null);
});
