import assert from 'node:assert/strict';
import test from 'node:test';
import { beginTaskRun, emptyTaskExecutionSnapshot } from './stateMachine';
import {
  isTaskExecutionSnapshot,
  migrateLegacyTaskExecutionSnapshot,
  normalizeTaskExecutionSnapshot,
} from './storage';

const binding = {
  targetFingerprint: 'gateway-target',
  runtimeId: 'runtime-1',
  sessionKey: 'agent:main:storage-test',
  sessionId: 'session-1',
};

test('accepts checkpoints whose non-tool nodes omit optional tool metadata', () => {
  const snapshot = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-1',
    source: 'chat',
    now: 10,
  });

  assert.equal(isTaskExecutionSnapshot(snapshot), true);
});

test('normalizes legacy checkpoints without optional history and recovery fields', () => {
  const legacy = {
    version: 1,
    tasks: [{
      version: 1,
      taskId: 'gateway-target\u0000agent:main:storage-test',
      binding: { targetFingerprint: 'gateway-target', sessionKey: 'agent:main:storage-test' },
      revision: 1,
      updatedAt: 10,
      runs: [{
        runId: 'run-1',
        source: 'chat',
        status: 'running',
        startedAt: 10,
        updatedAt: 10,
        stopRequestedAt: null,
        terminalReason: null,
      }],
      nodes: [{
        id: 'run-1\u0000user_turn',
        kind: 'user_turn',
        status: 'succeeded',
        runId: 'run-1',
        sideEffect: 'read_only',
        createdAt: 10,
        updatedAt: 10,
      }],
    }],
  } as never;

  assert.equal(isTaskExecutionSnapshot(legacy), true);
  const normalized = normalizeTaskExecutionSnapshot(legacy);
  assert.equal(normalized.tasks[0]?.binding.runtimeId, null);
  assert.equal(normalized.tasks[0]?.runs[0]?.supersedesRunId, null);
  assert.equal(normalized.tasks[0]?.runs[0]?.historyActive, null);
  assert.equal(normalized.tasks[0]?.nodes[0]?.recoveryMode, 'manual');
  assert.deepEqual(normalized.tasks[0]?.edges, []);
});

test('migrates the retired Jarvis source without accepting it as a current task source', () => {
  const snapshot = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-legacy-voice',
    source: 'chat',
    now: 10,
  });
  const legacy = {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => ({
      ...task,
      runs: task.runs.map((run) => ({ ...run, source: 'jarvis' })),
    })),
  };

  assert.equal(isTaskExecutionSnapshot(legacy), false);
  const migrated = migrateLegacyTaskExecutionSnapshot(legacy);
  assert.equal(isTaskExecutionSnapshot(migrated), true);
  if (!isTaskExecutionSnapshot(migrated)) assert.fail('旧来源迁移后必须满足当前任务快照契约');
  assert.equal(migrated.tasks[0]?.runs[0]?.source, 'chat');
});

test('rejects task checkpoints with an invented terminal reason', () => {
  const snapshot = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-invalid-terminal-reason',
    source: 'chat',
    now: 10,
  });
  const invalid = structuredClone(snapshot) as any;
  invalid.tasks[0].runs[0].terminalReason = 'completed_by_ui';
  assert.equal(isTaskExecutionSnapshot(invalid), false);
});
