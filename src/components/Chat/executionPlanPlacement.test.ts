import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResponseGroup } from '@/types/ResponseGroup';
import { selectActiveExecutionPlan } from './executionPlanPlacement';

function groupWithPlan(id: string, status: 'pending' | 'in_progress' | 'completed'): ResponseGroup {
  return {
    id: `group-${id}`,
    sessionKey: 'agent:main:main',
    runId: `run-${id}`,
    role: 'assistant',
    status: status === 'completed' ? 'final' : 'streaming',
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
