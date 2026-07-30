import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseOpenClawUpdatePlan,
  reconcileExecutionPlanSnapshots,
} from './domain';

const context = {
  sourceId: 'tool-call-1',
  sessionKey: 'agent:main:main',
  runId: 'run-1',
  sourceSequence: 4,
  timestamp: '2026-07-30T10:00:00.000Z',
};

test('parses the installed OpenClaw update_plan snapshot contract', () => {
  const snapshot = parseOpenClawUpdatePlan('update_plan', {
    explanation: 'Start implementation',
    plan: [
      { step: 'Read contracts', status: 'completed' },
      { step: 'Implement plan card', status: 'in_progress' },
      { step: 'Run tests', status: 'pending' },
    ],
  }, context);

  assert.ok(snapshot);
  assert.equal(snapshot.steps.length, 3);
  assert.equal(snapshot.steps[1].status, 'in_progress');
  assert.equal(snapshot.sourceSequence, 4);
});

test('rejects invalid plan snapshots instead of partially projecting them', () => {
  assert.equal(parseOpenClawUpdatePlan('other_tool', { plan: [] }, context), null);
  assert.equal(parseOpenClawUpdatePlan('update_plan', { plan: [] }, context), null);
  assert.equal(parseOpenClawUpdatePlan('update_plan', {
    plan: [
      { step: 'One', status: 'in_progress' },
      { step: 'Two', status: 'in_progress' },
    ],
  }, context), null);
  assert.equal(parseOpenClawUpdatePlan('update_plan', {
    plan: [{ step: 'One', status: 'failed' }],
  }, context), null);
});

test('reconciles revisions and preserves step identity across reordering', () => {
  const first = parseOpenClawUpdatePlan('update_plan', {
    plan: [
      { step: 'Read contracts', status: 'in_progress' },
      { step: 'Run tests', status: 'pending' },
    ],
  }, context);
  const second = parseOpenClawUpdatePlan('update_plan', {
    explanation: 'Validation moved earlier',
    plan: [
      { step: 'Run tests', status: 'in_progress' },
      { step: 'Read contracts', status: 'completed' },
      { step: 'Build app', status: 'pending' },
    ],
  }, { ...context, sourceId: 'tool-call-2', sourceSequence: 9 });
  assert.ok(first && second);

  const plan = reconcileExecutionPlanSnapshots([first, second]);
  assert.ok(plan);
  assert.equal(plan.revision, 2);
  assert.equal(plan.currentStepIndex, 0);
  assert.equal(plan.previousStepCount, 2);
  assert.equal(plan.steps[0].id, reconcileExecutionPlanSnapshots([first])?.steps[1].id);
  assert.equal(plan.steps[1].id, reconcileExecutionPlanSnapshots([first])?.steps[0].id);
});

test('deduplicates identical consecutive snapshots', () => {
  const first = parseOpenClawUpdatePlan('update_plan', {
    plan: [{ step: 'Run tests', status: 'completed' }],
  }, context);
  const duplicate = parseOpenClawUpdatePlan('update_plan', {
    plan: [{ step: 'Run tests', status: 'completed' }],
  }, { ...context, sourceId: 'tool-call-2', sourceSequence: 8 });
  assert.ok(first && duplicate);

  const plan = reconcileExecutionPlanSnapshots([first, duplicate]);
  assert.ok(plan);
  assert.equal(plan.revision, 1);
  assert.equal(plan.state, 'completed');
});

test('keeps a stable plan id across history revisions without a run id', () => {
  const first = parseOpenClawUpdatePlan('update_plan', {
    plan: [{ step: 'Inspect protocol', status: 'in_progress' }],
  }, { ...context, runId: null });
  const second = parseOpenClawUpdatePlan('update_plan', {
    plan: [
      { step: 'Inspect protocol', status: 'completed' },
      { step: 'Run tests', status: 'in_progress' },
    ],
  }, { ...context, sourceId: 'tool-call-2', runId: null });
  assert.ok(first && second);

  const initialPlan = reconcileExecutionPlanSnapshots([first]);
  const revisedPlan = reconcileExecutionPlanSnapshots([first, second]);
  assert.equal(initialPlan?.id, revisedPlan?.id);
});
