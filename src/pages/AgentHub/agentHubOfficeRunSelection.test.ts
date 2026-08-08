import assert from 'node:assert/strict';
import test from 'node:test';
import type { CollaborationRunSummary } from '@/services/collaboration/types';
import {
  DEFAULT_AGENT_HUB_VIEW,
  selectableAgentHubOfficeRuns,
  selectAgentHubOfficeRun,
} from './agentHubOfficeRunSelection';

function run(overrides: Partial<CollaborationRunSummary>): CollaborationRunSummary {
  return {
    runId: 'run-default',
    status: 'RUNNING',
    dispatchState: 'OPEN',
    archiveState: 'ACTIVE',
    reconcileState: 'IDLE',
    completionOutcome: null,
    revision: 1,
    lastEventSequence: 1,
    goal: 'Review current work',
    origin: {
      runtimeId: 'runtime-1',
      agentId: 'main',
      sessionKey: 'agent:main:main',
      sessionId: 'session-1',
      nativeMessageId: 'message-1',
    },
    currentPlanRevisionId: null,
    allowedActions: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test('智能体中心办公室只提供未归档运行，并按最近更新时间排序', () => {
  const runs = selectableAgentHubOfficeRuns([
    run({ runId: 'old', updatedAt: 10 }),
    run({ runId: 'archived', updatedAt: 30, archiveState: 'ARCHIVED' }),
    run({ runId: 'newer', updatedAt: 20 }),
    run({ runId: 'newest', updatedAt: 20 }),
  ]);

  assert.deepEqual(runs.map((item) => item.runId), ['newer', 'newest', 'old']);
});

test('智能体中心默认打开办公室视图', () => {
  assert.equal(DEFAULT_AGENT_HUB_VIEW, 'office');
});

test('智能体中心办公室保留仍可选择的运行，否则选择最近运行', () => {
  const runs = [
    run({ runId: 'older', updatedAt: 10 }),
    run({ runId: 'latest', updatedAt: 20 }),
  ];

  assert.equal(selectAgentHubOfficeRun(runs, 'older')?.runId, 'older');
  assert.equal(selectAgentHubOfficeRun(runs, 'missing')?.runId, 'latest');
  assert.equal(selectAgentHubOfficeRun([], 'older'), null);
});
