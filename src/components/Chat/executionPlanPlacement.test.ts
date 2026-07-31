import assert from 'node:assert/strict';
import test from 'node:test';
import { projectResponseGroupToRenderBlocks } from '@/processing/projectResponseGroup';
import type { ResponseGroup } from '@/types/ResponseGroup';
import { executionPlanOutcome, selectActiveExecutionPlan } from './executionPlanPlacement';

function groupWithPlan(
  id: string,
  status: 'pending' | 'in_progress' | 'completed',
  responseStatus?: ResponseGroup['status'],
): ResponseGroup {
  return {
    id: `group-${id}`,
    sessionKey: 'agent:main:main',
    runId: `run-${id}`,
    role: 'assistant',
    status: responseStatus ?? (status === 'completed' ? 'final' : 'streaming'),
    timestamp: '2026-07-30T10:00:00.000Z',
    startedAt: Date.parse('2026-07-30T10:00:00.000Z'),
    sourceMessageIds: [`message-${id}`],
    blocks: [{
      type: 'execution-plan',
      id: `block-${id}`,
      sessionKey: 'agent:main:main',
      runId: `run-${id}`,
      sourceMessageId: `message-${id}`,
      timestamp: '2026-07-30T10:00:00.000Z',
      isStreaming: status !== 'completed',
      responseState: status === 'completed' ? 'final' : 'streaming',
      snapshot: {
        sourceId: `source-${id}`,
        sessionKey: 'agent:main:main',
        runId: `run-${id}`,
        timestamp: '2026-07-30T10:00:00.000Z',
        steps: [{ title: `Plan ${id}`, status }],
      },
    }],
  };
}

test('composer plan placement selects the latest unfinished plan', () => {
  const selected = selectActiveExecutionPlan([
    groupWithPlan('old', 'completed'),
    groupWithPlan('current', 'in_progress'),
  ]);
  assert.equal(selected?.steps[0].title, 'Plan current');
});

test('composer plan placement leaves completed plans in transcript history only', () => {
  assert.equal(selectActiveExecutionPlan([groupWithPlan('done', 'completed')]), null);
  assert.equal(selectActiveExecutionPlan([
    groupWithPlan('old-running', 'in_progress'),
    groupWithPlan('latest-done', 'completed'),
  ]), null);
});

test('composer plan placement is absent without structured plan blocks', () => {
  assert.equal(selectActiveExecutionPlan([]), null);
});

// OpenClaw reports per-step status only, so an aborted run still leaves an
// `in_progress` step behind. Without the response status the card stayed pinned
// above the composer forever, claiming work that had already stopped.
for (const terminal of ['aborted', 'error'] as const) {
  test(`composer plan placement releases a plan whose run ${terminal}`, () => {
    assert.equal(
      selectActiveExecutionPlan([groupWithPlan('stopped', 'in_progress', terminal)]),
      null,
    );
  });

  test(`a plan whose run ${terminal} is settled, not running`, () => {
    const group = groupWithPlan('stopped', 'in_progress', terminal);
    const block = projectResponseGroupToRenderBlocks(group)
      .find((candidate) => candidate.type === 'execution-plan');
    assert.ok(block && block.type === 'execution-plan');
    assert.equal(executionPlanOutcome(block.plan, group.status), 'interrupted');
  });
}

test('a still-streaming plan keeps the composer placement', () => {
  const group = groupWithPlan('live', 'in_progress', 'streaming');
  const block = projectResponseGroupToRenderBlocks(group)
    .find((candidate) => candidate.type === 'execution-plan');
  assert.ok(block && block.type === 'execution-plan');
  assert.equal(executionPlanOutcome(block.plan, group.status), 'running');
  assert.equal(selectActiveExecutionPlan([group])?.steps[0].title, 'Plan live');
});

test('a finished plan stays completed even when its run reports failure', () => {
  const group = groupWithPlan('done', 'completed', 'error');
  const block = projectResponseGroupToRenderBlocks(group)
    .find((candidate) => candidate.type === 'execution-plan');
  assert.ok(block && block.type === 'execution-plan');
  assert.equal(executionPlanOutcome(block.plan, group.status), 'completed');
});
