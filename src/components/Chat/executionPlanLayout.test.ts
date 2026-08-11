import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { AgentExecutionPlan } from '@/agent-execution-plan/domain';
import { executionPlanOutcome } from './executionPlanPlacement';

const source = (path: string) => readFileSync(path, 'utf8');

function planAtStep(state: AgentExecutionPlan['state']): AgentExecutionPlan {
  return {
    id: 'plan-layout',
    sessionKey: 'agent:main:main',
    runId: 'run-layout',
    revision: 1,
    state,
    currentStepIndex: 0,
    createdAt: '2026-07-31T10:00:00.000Z',
    updatedAt: '2026-07-31T10:00:00.000Z',
    steps: [{ id: 'step-1', title: 'Inspect protocol', state: state === 'completed' ? 'completed' : 'running', order: 0 }],
  };
}

test('active execution plan is projected above the composer instead of the assistant column', () => {
  const view = source('src/pages/ChatView.tsx');
  const placement = view.indexOf('data-execution-plan-placement="composer-above"');
  const input = view.indexOf('<MessageInput />');
  assert.ok(placement >= 0);
  assert.ok(input > placement);
});

// The transcript guard used to hard-code `plan.state !== 'completed'`, which
// dropped interrupted plans from history while pinning them above the composer.
// Assert the routing contract itself so the guard cannot regress to plan-state.
test('only running plans are withheld from the transcript column', () => {
  assert.equal(executionPlanOutcome(planAtStep('running'), 'streaming'), 'running');
  assert.equal(executionPlanOutcome(planAtStep('running'), 'aborted'), 'interrupted');
  assert.equal(executionPlanOutcome(planAtStep('running'), 'error'), 'interrupted');
  assert.equal(executionPlanOutcome(planAtStep('completed'), 'final'), 'completed');

  const view = source('src/pages/ChatView.tsx');
  assert.match(view, /executionPlanOutcome\(block\.plan/);
  assert.match(view, /if \(outcome === 'running'\) return null/);
  assert.doesNotMatch(view, /block\.plan\.state !== 'completed'/);
});

test('execution plan, session handoff, and send composer share the centered send column', () => {
  const view = source('src/pages/ChatView.tsx');
  const input = source('src/components/Chat/MessageInput.tsx');
  const handoff = source('src/components/Chat/message-input/SessionMutationHandoffPanel.tsx');
  const composer = source('src/components/Chat/message-input/ComposerInputSurface.tsx');
  assert.match(view, /data-execution-plan-placement="composer-above"[\s\S]*?mx-auto w-full max-w-\[760px\]/);
  assert.match(input, /<SessionMutationHandoffPanel[\s\S]*?<ComposerInputSurface/);
  assert.match(handoff, /data-session-mutation-handoff-placement="composer-above"[\s\S]*?mx-auto w-full max-w-\[760px\]/);
  assert.match(handoff, /sessionMutationHandoffDescription/);
  assert.doesNotMatch(handoff, /chat\.queueTitle/);
  assert.match(composer, /mx-auto flex w-full max-w-\[784px\]/);
});
