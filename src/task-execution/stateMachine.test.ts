import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginTaskRun,
  emptyTaskExecutionSnapshot,
  mergeTaskExecutionSnapshots,
  prepareTaskRunSend,
  prepareTaskRunSteer,
  requestTaskRunStop,
  recordTaskToolEvent,
  reconcileTaskHistory,
  settleTaskRun,
} from './stateMachine';

const binding = {
  targetFingerprint: 'gateway-target',
  runtimeId: 'runtime-1',
  sessionKey: 'agent:main:task-test',
  sessionId: 'session-1',
};

test('Stop checkpoints a cancel request before the Run reaches its terminal state', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-1',
    source: 'chat',
    now: 10,
  });
  const stopping = requestTaskRunStop(started, binding, 20);
  assert.equal(stopping.tasks[0]?.runs[0]?.status, 'cancel_requested');
  assert.equal(stopping.tasks[0]?.nodes.find((node) => node.kind === 'model_turn')?.status, 'cancel_requested');

  const settled = settleTaskRun(stopping, binding, 'run-1', 'aborted', 30);
  assert.equal(settled.tasks[0]?.runs[0]?.status, 'cancelled');
  assert.equal(settled.tasks[0]?.nodes.find((node) => node.kind === 'model_turn')?.status, 'cancelled');
});

test('task graph records only observed/local relationships and leaves tools independent', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-graph',
    source: 'chat',
    now: 10,
  });
  const withTool = recordTaskToolEvent(started, binding, {
    runId: 'run-graph', toolCallId: 'tool-graph', toolName: 'Read', phase: 'start', now: 20,
  });
  const edges = withTool.tasks[0]?.edges ?? [];
  assert.deepEqual(edges.map((edge) => edge.kind), ['observed_after', 'observed_after']);
  assert.equal(edges[1]?.evidence, 'openclaw_event');
  assert.equal(edges.some((edge) => edge.fromNodeId.includes('tool-graph') && edge.toNodeId.includes('tool-graph')), false);
});

test('a Task session refuses a second active Run', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-1',
    source: 'chat',
    now: 10,
  });
  assert.throws(() => beginTaskRun(started, {
    binding,
    runId: 'run-2',
    source: 'chat',
    now: 20,
  }), /already has an active Run/);
});

test('normal send joins an active Task Run instead of creating a second Run', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-active',
    source: 'chat',
    now: 10,
  });
  const prepared = prepareTaskRunSend(started, {
    binding,
    runId: 'run-queued-message',
    source: 'chat',
    now: 20,
  });

  assert.equal(prepared.created, false);
  assert.equal(prepared.taskRunId, 'run-active');
  assert.strictEqual(prepared.snapshot, started);
  assert.deepEqual(prepared.snapshot.tasks[0]?.runs.map((run) => run.runId), ['run-active']);
});

test('normal send can wait for Gateway authority without creating a local Run', () => {
  const prepared = prepareTaskRunSend(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-unknown-queue',
    source: 'chat',
    allowCreate: false,
    now: 10,
  });

  assert.equal(prepared.created, false);
  assert.equal(prepared.taskRunId, null);
  assert.deepEqual(prepared.snapshot, emptyTaskExecutionSnapshot());
});

test('a rotated OpenClaw session identity starts a new Task checkpoint', () => {
  const first = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-session-one',
    source: 'chat',
    now: 10,
  });
  const second = beginTaskRun(first, {
    binding: { ...binding, sessionId: 'session-2' },
    runId: 'run-session-two',
    source: 'chat',
    now: 20,
  });
  assert.equal(second.tasks.length, 2);
  assert.notEqual(second.tasks[0]?.taskId, second.tasks[1]?.taskId);
});

test('steer checkpoints the old Run cancellation and the replacement Run intent together', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-old',
    source: 'quick_chat',
    now: 10,
  });
  const prepared = prepareTaskRunSteer(started, {
    binding,
    runId: 'run-new',
    source: 'quick_chat',
    now: 20,
  });

  assert.equal(prepared.supersededRunId, 'run-old');
  const runs = prepared.snapshot.tasks[0]?.runs ?? [];
  assert.equal(runs.find((run) => run.runId === 'run-old')?.status, 'cancel_requested');
  assert.equal(runs.find((run) => run.runId === 'run-new')?.status, 'running');
  assert.equal(
    prepared.snapshot.tasks[0]?.edges.some((edge) => edge.kind === 'supersedes'),
    true,
  );
});

test('an interrupted tool without a result requires verification instead of retry', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-1',
    source: 'chat',
    now: 10,
  });
  const toolStarted = recordTaskToolEvent(started, binding, {
    runId: 'run-1',
    toolCallId: 'tool-1',
    toolName: 'Write',
    phase: 'start',
    now: 20,
  });
  const aborted = settleTaskRun(toolStarted, binding, 'run-1', 'aborted', 30);
  assert.equal(aborted.tasks[0]?.runs[0]?.status, 'verification_required');
  assert.equal(aborted.tasks[0]?.nodes.find((node) => node.toolCallId === 'tool-1')?.status, 'verification_required');
  assert.equal(aborted.tasks[0]?.nodes.find((node) => node.kind === 'tool_reconciliation')?.status, 'verification_required');
});

test('a final event cannot close a tool node that has no authoritative result', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-final-without-tool-result',
    source: 'chat',
    now: 10,
  });
  const toolStarted = recordTaskToolEvent(started, binding, {
    runId: 'run-final-without-tool-result',
    toolCallId: 'tool-1',
    toolName: 'Write',
    phase: 'start',
    now: 20,
  });
  const settled = settleTaskRun(toolStarted, binding, 'run-final-without-tool-result', 'final', 30);
  assert.equal(settled.tasks[0]?.runs[0]?.status, 'verification_required');
  assert.equal(settled.tasks[0]?.nodes.find((node) => node.toolCallId === 'tool-1')?.status, 'verification_required');
});

test('a late authoritative tool result closes verification without replaying the tool', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-late-tool-result',
    source: 'chat',
    now: 10,
  });
  const toolStarted = recordTaskToolEvent(started, binding, {
    runId: 'run-late-tool-result', toolCallId: 'tool-1', toolName: 'Write', phase: 'start', now: 20,
  });
  const stopped = settleTaskRun(toolStarted, binding, 'run-late-tool-result', 'aborted', 30);
  const completed = recordTaskToolEvent(stopped, binding, {
    runId: 'run-late-tool-result', toolCallId: 'tool-1', toolName: 'Write', phase: 'result', resultStatus: 'done', now: 40,
  });
  assert.equal(completed.tasks[0]?.runs[0]?.status, 'cancelled');
  assert.equal(completed.tasks[0]?.nodes.find((node) => node.toolCallId === 'tool-1')?.status, 'succeeded');
  assert.match(completed.tasks[0]?.nodes.find((node) => node.toolCallId === 'tool-1')?.effectKey ?? '', /junqi-tool/);
  assert.equal(completed.tasks[0]?.nodes.find((node) => node.kind === 'tool_reconciliation')?.status, 'cancelled');
});

test('an authoritative cancelled tool result stays cancelled in the graph', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-cancelled-tool',
    source: 'chat',
    now: 10,
  });
  const toolStarted = recordTaskToolEvent(started, binding, {
    runId: 'run-cancelled-tool', toolCallId: 'tool-1', toolName: 'Write', phase: 'start', now: 20,
  });
  const toolCancelled = recordTaskToolEvent(toolStarted, binding, {
    runId: 'run-cancelled-tool', toolCallId: 'tool-1', toolName: 'Write', phase: 'result', resultStatus: 'cancelled', now: 30,
  });
  assert.equal(toolCancelled.tasks[0]?.nodes.find((node) => node.toolCallId === 'tool-1')?.status, 'cancelled');
});

test('a newer Task checkpoint wins a cross-window persistence conflict', () => {
  const original = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-1',
    source: 'chat',
    now: 10,
  });
  const newer = requestTaskRunStop(original, binding, 20);
  const merged = mergeTaskExecutionSnapshots(original, newer);
  assert.equal(merged.tasks[0]?.runs[0]?.status, 'cancel_requested');
  assert.ok((merged.tasks[0]?.revision ?? 0) > newer.tasks[0]!.revision);
});

test('cross-window checkpoint merge preserves independent tool nodes', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-1',
    source: 'chat',
    now: 10,
  });
  const firstTool = recordTaskToolEvent(started, binding, {
    runId: 'run-1', toolCallId: 'tool-1', toolName: 'Read', phase: 'start', now: 20,
  });
  const secondTool = recordTaskToolEvent(started, binding, {
    runId: 'run-1', toolCallId: 'tool-2', toolName: 'Write', phase: 'start', now: 20,
  });
  const merged = mergeTaskExecutionSnapshots(firstTool, secondTool);
  assert.deepEqual(
    merged.tasks[0]?.nodes.filter((node) => node.kind === 'tool_invocation').map((node) => node.toolCallId).sort(),
    ['tool-1', 'tool-2'],
  );
});

test('cross-window merge cannot reopen terminal run or node from a delayed active snapshot', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-terminal-merge',
    source: 'quick_chat',
    now: 10,
  });
  const terminal = settleTaskRun(started, binding, 'run-terminal-merge', 'final', 30);
  const delayedActive = {
    ...started,
    tasks: started.tasks.map((task) => ({
      ...task,
      updatedAt: 40,
      runs: task.runs.map((run) => ({ ...run, updatedAt: 40 })),
      nodes: task.nodes.map((node) => ({ ...node, updatedAt: 40 })),
    })),
  };

  const merged = mergeTaskExecutionSnapshots(terminal, delayedActive);
  assert.equal(merged.tasks[0]?.runs[0]?.status, 'succeeded');
  assert.equal(merged.tasks[0]?.nodes.find((node) => node.kind === 'model_turn')?.status, 'succeeded');
});

test('cross-window steer intents keep one running replacement and quarantine the competing intent', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-base',
    source: 'chat',
    now: 10,
  });
  const left = prepareTaskRunSteer(started, {
    binding,
    runId: 'run-left',
    source: 'quick_chat',
    now: 20,
  }).snapshot;
  const right = prepareTaskRunSteer(started, {
    binding,
    runId: 'run-right',
    source: 'quick_chat',
    now: 30,
  }).snapshot;
  const merged = mergeTaskExecutionSnapshots(left, right);
  const runs = merged.tasks[0]?.runs ?? [];
  assert.equal(runs.find((run) => run.runId === 'run-right')?.status, 'running');
  assert.equal(runs.find((run) => run.runId === 'run-left')?.status, 'verification_required');
});

test('history reconciliation records authority without inventing a tool result', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-1',
    source: 'chat',
    now: 10,
  });
  const toolStarted = recordTaskToolEvent(started, binding, {
    runId: 'run-1', toolCallId: 'tool-1', toolName: 'Write', phase: 'start', now: 20,
  });
  const reconciled = reconcileTaskHistory(toolStarted, binding, {
    sessionId: 'session-1', hasActiveRun: false, activeRunIds: [], now: 30,
  });
  assert.equal(reconciled.tasks[0]?.runs[0]?.historyVerifiedAt, 30);
  assert.equal(reconciled.tasks[0]?.runs[0]?.historyActive, false);
  assert.equal(reconciled.tasks[0]?.runs[0]?.status, 'verification_required');
  assert.equal(reconciled.tasks[0]?.nodes.find((node) => node.toolCallId === 'tool-1')?.status, 'verification_required');
});

test('history reopens only a cancel-requested Run that OpenClaw still reports as active', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-steer-old',
    source: 'quick_chat',
    now: 10,
  });
  const toolStarted = recordTaskToolEvent(started, binding, {
    runId: 'run-steer-old', toolCallId: 'tool-steer-old', toolName: 'Write', phase: 'start', now: 15,
  });
  const stopping = requestTaskRunStop(toolStarted, binding, 20);
  const reconciled = reconcileTaskHistory(stopping, binding, {
    sessionId: 'session-1', hasActiveRun: true, activeRunIds: ['run-steer-old'], now: 30,
  });

  assert.equal(reconciled.tasks[0]?.runs[0]?.status, 'running');
  assert.equal(reconciled.tasks[0]?.runs[0]?.historyActive, true);
  assert.equal(reconciled.tasks[0]?.nodes.find((node) => node.kind === 'model_turn')?.status, 'running');
  assert.equal(reconciled.tasks[0]?.nodes.find((node) => node.toolCallId === 'tool-steer-old')?.status, 'cancel_requested');
});

test('history does not reopen a cancel-requested Run for another active Run', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-steer-old',
    source: 'quick_chat',
    now: 10,
  });
  const stopping = requestTaskRunStop(started, binding, 20);
  const reconciled = reconcileTaskHistory(stopping, binding, {
    sessionId: 'session-1', hasActiveRun: true, activeRunIds: ['run-other'], now: 30,
  });

  assert.equal(reconciled.tasks[0]?.runs[0]?.status, 'cancel_requested');
  assert.equal(reconciled.tasks[0]?.runs[0]?.historyActive, false);
});

test('history-only verification does not become cancelled when a late tool result arrives', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-history-verification',
    source: 'chat',
    now: 10,
  });
  const toolStarted = recordTaskToolEvent(started, binding, {
    runId: 'run-history-verification', toolCallId: 'tool-1', toolName: 'Write', phase: 'start', now: 20,
  });
  const reconciled = reconcileTaskHistory(toolStarted, binding, {
    sessionId: 'session-1', hasActiveRun: false, activeRunIds: [], now: 30,
  });
  const lateResult = recordTaskToolEvent(reconciled, binding, {
    runId: 'run-history-verification', toolCallId: 'tool-1', toolName: 'Write', phase: 'result', resultStatus: 'done', now: 40,
  });
  assert.equal(lateResult.tasks[0]?.runs[0]?.status, 'verification_required');
});

test('an authoritative final event can close a history-only verification without unresolved tools', () => {
  const started = beginTaskRun(emptyTaskExecutionSnapshot(), {
    binding,
    runId: 'run-history-final',
    source: 'chat',
    now: 10,
  });
  const reconciled = reconcileTaskHistory(started, binding, {
    sessionId: 'session-1', hasActiveRun: false, activeRunIds: [], now: 20,
  });
  const finalized = settleTaskRun(reconciled, binding, 'run-history-final', 'final', 30);
  assert.equal(finalized.tasks[0]?.runs[0]?.status, 'succeeded');
});
