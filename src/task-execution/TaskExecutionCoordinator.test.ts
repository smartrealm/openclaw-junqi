import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';
import { beginTaskRun, emptyTaskExecutionSnapshot } from './stateMachine';
import { resolveTaskExecutionBinding } from './TaskExecutionCoordinator';

const identity = {
  verified: true,
  targetFingerprint: 'gateway-target',
  runtimeId: 'runtime-1',
} as RuntimeIdentity;

const baseBinding = {
  targetFingerprint: 'gateway-target',
  runtimeId: 'runtime-1',
  sessionKey: 'agent:main:voice',
  sessionId: 'session-1',
};

test('resolves a session-id-bound checkpoint when an event only carries sessionKey', () => {
  const snapshot = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding: baseBinding,
    runId: 'run-1',
    source: 'jarvis',
    now: 10,
  });

  assert.deepEqual(
    resolveTaskExecutionBinding(snapshot.tasks, baseBinding.sessionKey, undefined, identity, true),
    baseBinding,
  );
});

test('does not guess between rotated session identities for a key-only event', () => {
  const first = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding: baseBinding,
    runId: 'run-1',
    source: 'chat',
    now: 10,
  });
  const rotated = beginTaskRun(first, {
    binding: { ...baseBinding, sessionId: 'session-2' },
    runId: 'run-2',
    source: 'chat',
    now: 20,
  });

  assert.equal(
    resolveTaskExecutionBinding(rotated.tasks, baseBinding.sessionKey, undefined, identity, true),
    null,
  );
});

test('uses the caller session identity instead of a stored checkpoint for a rotated key', () => {
  const first = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding: baseBinding,
    runId: 'run-1',
    source: 'chat',
    now: 10,
  });
  const rotated = beginTaskRun(first, {
    binding: { ...baseBinding, sessionId: 'session-2' },
    runId: 'run-2',
    source: 'chat',
    now: 20,
  });

  assert.deepEqual(
    resolveTaskExecutionBinding(rotated.tasks, baseBinding.sessionKey, 'session-2', identity, true),
    { ...baseBinding, sessionId: 'session-2' },
  );
});
