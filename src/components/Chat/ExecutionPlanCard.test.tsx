import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentExecutionPlan } from '@/agent-execution-plan/domain';
import { ExecutionPlanCard } from './ExecutionPlanCard';

function createPlan(state: AgentExecutionPlan['state']): AgentExecutionPlan {
  return {
    id: 'plan-test',
    sessionKey: 'agent:main:main',
    runId: 'run-test',
    revision: 2,
    state,
    currentStepIndex: state === 'completed' ? 1 : 0,
    previousStepCount: 1,
    explanation: 'Plan adjusted after protocol review',
    createdAt: '2026-07-30T10:00:00.000Z',
    updatedAt: '2026-07-30T10:01:00.000Z',
    steps: [
      { id: 'step-1', title: 'Inspect protocol', state: state === 'completed' ? 'completed' : 'running', order: 0 },
      { id: 'step-2', title: 'Run tests', state: state === 'completed' ? 'completed' : 'pending', order: 1 },
    ],
  };
}

test('running plan renders expanded progress with accessible controls', () => {
  const html = renderToStaticMarkup(<ExecutionPlanCard plan={createPlan('running')} />);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-controls=/);
  assert.match(html, /data-execution-plan-card="true"/);
  assert.match(html, /w-full/);
  assert.doesNotMatch(html, /ml-\[46px\]/);
  assert.match(html, /Inspect protocol/);
  assert.match(html, /Run tests/);
});

test('completed plan defaults to a compact summary', () => {
  const html = renderToStaticMarkup(<ExecutionPlanCard plan={createPlan('completed')} />);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Plan adjusted after protocol review/);
});
