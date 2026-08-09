import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CollaborationRunSnapshot,
  CollaborationRunSummary,
} from '@/types/collaboration';
import { collaborationNeedsYouItems } from './collaborationNeedsYou';

function run(overrides: Partial<CollaborationRunSummary> = {}): CollaborationRunSummary {
  return {
    runId: 'run-1',
    status: 'RUNNING',
    dispatchState: 'OPEN',
    archiveState: 'ACTIVE',
    reconcileState: 'IDLE',
    completionOutcome: null,
    revision: 2,
    lastEventSequence: 3,
    goal: 'Review release impact',
    origin: {
      runtimeId: 'instance-1',
      agentId: 'main',
      sessionKey: 'agent:main:main',
      sessionId: 'session-1',
      nativeMessageId: 'message-1',
    },
    currentPlanRevisionId: 'plan-1',
    allowedActions: [],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function snapshot(overrides: Partial<CollaborationRunSnapshot> = {}): CollaborationRunSnapshot {
  return {
    ...run(),
    snapshotRevision: 2,
    workItems: [],
    attempts: [],
    interventions: [],
    deliveries: [],
    ...overrides,
  };
}

const text = (_key: string, fallback: string) => fallback;

test('projects only the three authoritative Needs You statuses', () => {
  const items = collaborationNeedsYouItems([
    run({ runId: 'approval', status: 'AWAITING_APPROVAL' }),
    run({ runId: 'intervention', status: 'AWAITING_INTERVENTION' }),
    run({ runId: 'delivery', status: 'DELIVERY_PENDING' }),
    run({ runId: 'running', status: 'RUNNING' }),
    run({ runId: 'done', status: 'COMPLETED' }),
  ], {}, text);

  assert.deepEqual(items.map((item) => item.run.runId), ['approval', 'intervention', 'delivery']);
  assert.equal(items[0]?.title, 'Plan approval required');
  assert.equal(items[1]?.title, 'Intervention required');
  assert.equal(items[2]?.title, 'Delivery requires attention');
});

test('uses an unresolved intervention only from a current-enough snapshot', () => {
  const current = snapshot({
    runId: 'current',
    status: 'AWAITING_INTERVENTION',
    interventions: [{
      id: 'intervention-1',
      code: 'WORKER_FAILED',
      requiredAction: 'Choose a recovery action.',
      resumeStatus: 'RUNNING',
      createdAt: 5,
    }],
  });
  const stale = snapshot({
    runId: 'stale',
    revision: 1,
    snapshotRevision: 1,
    status: 'AWAITING_INTERVENTION',
    interventions: [{
      id: 'stale-intervention',
      code: 'STALE',
      requiredAction: 'Do not use stale details.',
      resumeStatus: 'RUNNING',
      createdAt: 5,
    }],
  });

  const items = collaborationNeedsYouItems([
    run({ runId: 'current', status: 'AWAITING_INTERVENTION', revision: 2 }),
    run({ runId: 'stale', status: 'AWAITING_INTERVENTION', revision: 2 }),
  ], { current, stale }, text);

  assert.equal(items[0]?.title, 'WORKER_FAILED');
  assert.equal(items[0]?.detail, 'Choose a recovery action.');
  assert.equal(items[1]?.title, 'Intervention required');
  assert.equal(items[1]?.detail, 'Review the current run and choose a recovery action.');
});
