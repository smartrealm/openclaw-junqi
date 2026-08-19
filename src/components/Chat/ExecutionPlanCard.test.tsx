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
  const html = renderToStaticMarkup(
    <ExecutionPlanCard plan={createPlan('running')} outcome="running" />,
  );
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-controls=/);
  assert.match(html, /data-execution-plan-card="true"/);
  assert.match(html, /w-full/);
  assert.doesNotMatch(html, /ml-\[46px\]/);
  assert.match(html, /Inspect protocol/);
  assert.match(html, /Run tests/);
  assert.match(html, /data-execution-plan-step-state="running"/);
  assert.match(html, /data-execution-plan-step-state="pending"/);
});

test('completed plan defaults to a compact summary', () => {
  const html = renderToStaticMarkup(
    <ExecutionPlanCard plan={createPlan('completed')} outcome="completed" />,
  );
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Plan adjusted after protocol review/);
});

// 完成计划摘要最后完成的步骤，避免在标题中重复两组相同计数。
test('completed plan summarises the finishing step instead of repeating the count', () => {
  const html = renderToStaticMarkup(
    <ExecutionPlanCard plan={createPlan('completed')} outcome="completed" />,
  );
  assert.match(html, /Run tests/);
  assert.doesNotMatch(html, /executionPlan\.progress/);
});

test('interrupted plan is marked and keeps the step it stopped at', () => {
  const html = renderToStaticMarkup(
    <ExecutionPlanCard plan={createPlan('running')} outcome="interrupted" />,
  );
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /interruptedBadge|已中断|Interrupted/);
  assert.match(html, /Inspect protocol/);
});

test('trace entry is a sibling control, never nested inside the collapse button', () => {
  const withTrace = renderToStaticMarkup(
    <ExecutionPlanCard plan={createPlan('completed')} outcome="completed" onOpenTrace={() => {}} />,
  );
  const openButtons = withTrace.match(/<button/g) ?? [];
  assert.equal(openButtons.length, 2);
  assert.doesNotMatch(withTrace, /<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/);

  const withoutTrace = renderToStaticMarkup(
    <ExecutionPlanCard plan={createPlan('completed')} outcome="completed" />,
  );
  assert.equal((withoutTrace.match(/<button/g) ?? []).length, 1);
});

test('composer plan uses a centered compact trigger with an expandable bounded panel', () => {
  const html = renderToStaticMarkup(
    <ExecutionPlanCard plan={createPlan('running')} outcome="running" presentation="composer" />,
  );
  assert.match(html, /data-execution-plan-presentation="composer"/);
  assert.match(html, /data-execution-plan-compact-trigger="true"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /max-w-\[640px\]/);
  assert.match(html, /max-h-\[min\(42vh,360px\)\]/);
  assert.match(html, /Inspect protocol/);
  assert.match(html, /Run tests/);
});

test('collapsed composer plan leaves only the compact progress trigger', () => {
  localStorage.setItem('junqi:chat-plan-collapsed:plan-test', 'true');
  try {
    const html = renderToStaticMarkup(
      <ExecutionPlanCard plan={createPlan('running')} outcome="running" presentation="composer" />,
    );
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /data-execution-plan-compact-trigger="true"/);
    assert.doesNotMatch(html, /Plan adjusted after protocol review/);
    assert.doesNotMatch(html, /max-w-\[640px\]/);
  } finally {
    localStorage.removeItem('junqi:chat-plan-collapsed:plan-test');
  }
});
