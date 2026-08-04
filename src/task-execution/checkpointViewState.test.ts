import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectTaskExecutionCheckpointState,
  taskExecutionCheckpointTarget,
} from './checkpointViewState';
import type { TaskExecutionCheckpoint } from './types';

const checkpoint: TaskExecutionCheckpoint = {
  version: 1,
  taskId: 'task-a',
  binding: {
    targetFingerprint: 'runtime-a',
    runtimeId: 'runtime-a',
    sessionKey: 'agent:main:one',
    sessionId: 'session-one',
  },
  revision: 1,
  updatedAt: 0,
  lastHistoryVerifiedAt: null,
  lastHistorySessionId: null,
  runs: [],
  nodes: [],
  edges: [],
};

test('hides a checkpoint while the requested session changes', () => {
  const previousTarget = taskExecutionCheckpointTarget('agent:main:one', 'session-one');
  const nextTarget = taskExecutionCheckpointTarget('agent:main:two', 'session-two');

  const view = projectTaskExecutionCheckpointState({
    target: previousTarget,
    loading: false,
    checkpoint,
  }, nextTarget);

  assert.deepEqual(view, { loading: true, checkpoint: null });
});

test('keeps a checkpoint visible only for its exact normalized session target', () => {
  const target = taskExecutionCheckpointTarget(' agent:main:one ', ' session-one ');

  const view = projectTaskExecutionCheckpointState({
    target,
    loading: false,
    checkpoint,
  }, taskExecutionCheckpointTarget('agent:main:one', 'session-one'));

  assert.deepEqual(view, { loading: false, checkpoint });
});
