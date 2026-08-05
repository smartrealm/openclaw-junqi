import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';
import {
  beginTaskRun,
  emptyTaskExecutionSnapshot,
  recordTaskToolEvent,
  requestTaskRunStop,
} from './stateMachine';
import {
  isTaskRunStopRequested,
  resolveTaskExecutionBinding,
  resolveTaskExecutionToolEventBinding,
} from './TaskExecutionCoordinator';

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

test('recognizes a Stop only for the exact checkpoint Run', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding: baseBinding,
    runId: 'run-to-stop',
    source: 'chat',
    now: 10,
  });
  const stopped = requestTaskRunStop(started, baseBinding, 20);

  assert.equal(isTaskRunStopRequested(stopped.tasks, baseBinding, 'run-to-stop'), true);
  assert.equal(isTaskRunStopRequested(stopped.tasks, baseBinding, 'another-run'), false);
  assert.equal(isTaskRunStopRequested(stopped.tasks, { ...baseBinding, sessionId: 'session-2' }, 'run-to-stop'), false);
});

test('resolves a session-id-bound checkpoint when an event only carries sessionKey', () => {
  const snapshot = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding: baseBinding,
    runId: 'run-1',
    source: 'quick_chat',
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

test('binds a tool event to its exact Run after a session identity rotation', () => {
  const first = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding: baseBinding,
    runId: 'run-before-reset',
    source: 'chat',
    now: 10,
  });
  const rotatedBinding = { ...baseBinding, sessionId: 'session-2' };
  const rotated = beginTaskRun(first, {
    binding: rotatedBinding,
    runId: 'run-after-reset',
    source: 'chat',
    now: 20,
  });

  const toolBinding = resolveTaskExecutionToolEventBinding(
    rotated.tasks,
    baseBinding.sessionKey,
    'run-after-reset',
    identity,
  );
  assert.deepEqual(toolBinding, rotatedBinding);
  assert.ok(toolBinding);
  const recorded = recordTaskToolEvent(rotated, toolBinding, {
    runId: 'run-after-reset',
    toolCallId: 'tool-after-reset',
    toolName: 'write',
    phase: 'start',
    now: 30,
  });
  const previousTask = recorded.tasks.find((task) => task.binding.sessionId === baseBinding.sessionId);
  const currentTask = recorded.tasks.find((task) => task.binding.sessionId === rotatedBinding.sessionId);
  assert.equal(previousTask?.nodes.some((node) => node.toolCallId === 'tool-after-reset'), false);
  assert.equal(currentTask?.nodes.some((node) => node.toolCallId === 'tool-after-reset'), true);
  assert.deepEqual(
    resolveTaskExecutionToolEventBinding(
      rotated.tasks,
      baseBinding.sessionKey,
      'run-before-reset',
      identity,
    ),
    baseBinding,
  );
  assert.equal(
    resolveTaskExecutionToolEventBinding(rotated.tasks, baseBinding.sessionKey, 'unknown-run', identity),
    null,
  );
});

test('refuses a tool event Run that is present in more than one stored Task', () => {
  const first = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding: baseBinding,
    runId: 'duplicated-run',
    source: 'chat',
    now: 10,
  });
  const rotated = beginTaskRun(first, {
    binding: { ...baseBinding, sessionId: 'session-2' },
    runId: 'duplicated-run',
    source: 'chat',
    now: 20,
  });

  assert.equal(
    resolveTaskExecutionToolEventBinding(rotated.tasks, baseBinding.sessionKey, 'duplicated-run', identity),
    null,
  );
});
