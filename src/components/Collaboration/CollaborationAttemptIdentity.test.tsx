import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CollaborationAttemptSnapshot } from '@/services/collaboration/types';
import {
  CollaborationAttemptIdentity,
  collaborationAttemptIdentityFields,
} from './CollaborationAttemptIdentity';

function attempt(overrides: Partial<CollaborationAttemptSnapshot> = {}): CollaborationAttemptSnapshot {
  return {
    id: 'attempt-identity',
    workItemId: 'work-1',
    kind: 'WORKER',
    attemptNo: 1,
    status: 'UNKNOWN',
    workerAgentId: 'worker-a',
    executionTaskId: 'task-1',
    agentRunId: 'run-1',
    workerSessionKey: 'agent:worker-a:subagent:task-1',
    revision: 3,
    ...overrides,
  };
}

test('renders the exact available OpenClaw Task, Run, and session identity', () => {
  const html = renderToStaticMarkup(createElement(CollaborationAttemptIdentity, {
    attempt: attempt(),
  }));

  assert.match(html, /data-attempt-identity-field="executionTaskId"/);
  assert.match(html, /task-1/);
  assert.match(html, /data-attempt-identity-field="agentRunId"/);
  assert.match(html, /run-1/);
  assert.match(html, /data-attempt-identity-field="workerSessionKey"/);
  assert.match(html, /agent:worker-a:subagent:task-1/);
});

test('bounds rendered identity text without changing the authoritative value', () => {
  const exactTaskId = `task-${'x'.repeat(500)}-tail`;
  const fields = collaborationAttemptIdentityFields(attempt({ executionTaskId: exactTaskId }));
  const task = fields.find((field) => field.key === 'executionTaskId');
  assert.equal(task?.value, exactTaskId);
  assert.ok((task?.visibleValue.length ?? 0) <= 192);
  assert.match(task?.visibleValue ?? '', /^task-.*\.\.\..*-tail$/);

  const html = renderToStaticMarkup(createElement(CollaborationAttemptIdentity, {
    attempt: attempt({ executionTaskId: exactTaskId }),
  }));
  assert.doesNotMatch(html, new RegExp(exactTaskId));
  assert.match(html, /\.\.\./);
});
