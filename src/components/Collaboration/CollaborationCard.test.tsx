import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ar from '@/locales/ar.json';
import en from '@/locales/en.json';
import zh from '@/locales/zh.json';
import type { CollaborationRunSnapshot } from '@/services/collaboration/types';
import { CollaborationCard } from './CollaborationCard';

function snapshot(): CollaborationRunSnapshot {
  return {
    runId: 'run-42',
    status: 'RUNNING',
    dispatchState: 'OPEN',
    archiveState: 'ACTIVE',
    reconcileState: 'IDLE',
    completionOutcome: null,
    revision: 4,
    lastEventSequence: 12,
    snapshotRevision: 4,
    goal: 'Audit the supplier proposal',
    origin: {
      runtimeId: 'runtime-1',
      agentId: 'coordinator',
      sessionKey: 'agent:coordinator:main',
      sessionId: 'session-1',
      nativeMessageId: 'message-1',
    },
    currentPlanRevisionId: 'plan-2',
    allowedActions: ['DISPATCH_STOP', 'CANCEL'],
    createdAt: 1,
    updatedAt: 2,
    workItems: [
      {
        id: 'item-1',
        logicalId: 'research',
        planRevisionId: 'plan-2',
        title: 'Check commercial terms',
        status: 'SUCCEEDED',
        assignedAgentId: 'legal-reviewer',
        inputScope: ['proposal'],
        dependencies: [],
        requiredCapabilities: ['legal'],
        candidateAgentIds: ['legal-reviewer'],
        acceptanceCriteria: ['Terms are classified'],
        revision: 2,
        riskLevel: 'MEDIUM',
        sideEffectClass: 'READ_ONLY',
      },
      {
        id: 'item-2',
        logicalId: 'summary',
        planRevisionId: 'plan-2',
        title: 'Prepare decision memo',
        status: 'RUNNING',
        assignedAgentId: 'analyst',
        inputScope: ['research'],
        dependencies: ['research'],
        requiredCapabilities: ['analysis'],
        candidateAgentIds: ['analyst'],
        acceptanceCriteria: ['Memo is actionable'],
        revision: 1,
        riskLevel: 'LOW',
        sideEffectClass: 'LOCAL_WRITE',
      },
    ],
    attempts: [],
    interventions: [],
    deliveries: [],
  };
}

test('renders server status, work progress, agents, and only allowed actions', () => {
  const value = snapshot();
  const html = renderToStaticMarkup(createElement(CollaborationCard, {
    run: value,
    snapshot: value,
    onAction: () => undefined,
    onOpenDetails: () => undefined,
  }));

  assert.match(html, /Audit the supplier proposal/);
  assert.match(html, /1 \/ 2/);
  assert.match(html, /legal-reviewer/);
  assert.match(html, /analyst/);
  assert.match(html, /data-collaboration-action="DISPATCH_STOP"/);
  assert.match(html, /data-collaboration-action="CANCEL"/);
  assert.doesNotMatch(html, /data-collaboration-action="PLAN_APPROVE"/);
  assert.match(html, />Details</);
});

test('renders server-authorized work-item input and cancellation commands', () => {
  const value = snapshot();
  value.allowedActions = ['WORK_ITEM_INPUT_APPEND', 'WORK_ITEM_CANCEL'];
  const html = renderToStaticMarkup(createElement(CollaborationCard, {
    run: value,
    snapshot: value,
    onAction: () => undefined,
  }));

  assert.match(html, /data-collaboration-action="WORK_ITEM_INPUT_APPEND"/);
  assert.match(html, />Add input</);
  assert.match(html, /data-collaboration-action="WORK_ITEM_CANCEL"/);
  assert.match(html, />Cancel work item</);
});

test('renders a bounded loading projection when the snapshot has not arrived', () => {
  const value = snapshot();
  const html = renderToStaticMarkup(createElement(CollaborationCard, {
    run: value,
    loading: true,
  }));

  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Loading run details/);
});

test('renders an inline recoverable error without inventing an action', () => {
  const value = snapshot();
  const html = renderToStaticMarkup(createElement(CollaborationCard, {
    run: value,
    error: 'Snapshot revision changed',
    onRetry: () => undefined,
  }));

  assert.match(html, /role="alert"/);
  assert.match(html, /Snapshot revision changed/);
  assert.match(html, />Retry</);
  assert.match(html, /data-collaboration-action="DISPATCH_STOP"/);
  assert.match(html, /disabled=""/);
});

test('keeps residual OpenClaw execution risk visible on a locally cancelled card', () => {
  const value = snapshot();
  value.status = 'CANCELLED';
  value.dispatchState = 'CLOSED';
  value.allowedActions = ['EXPORT'];
  value.interventions = [{
    id: 'residual-risk-1',
    code: 'ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK',
    entityRef: { type: 'attempt', id: 'attempt-1' },
    requiredAction: 'Verify OpenClaw Task termination.',
    diagnostics: { taskId: 'task-1' },
    resumeStatus: 'CANCELLING',
    createdAt: 3,
    resolvedAt: null,
  }];
  const html = renderToStaticMarkup(createElement(CollaborationCard, {
    run: value,
    snapshot: value,
    onAction: () => undefined,
    translate: (_key, fallback) => fallback,
  }));

  assert.match(html, /data-collaboration-residual-execution-risk="true"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Cancelled locally; OpenClaw Task termination unconfirmed/);
  assert.match(html, /OpenClaw Task may still finish or cause side effects/);
  assert.match(html, /data-collaboration-action="EXPORT"/);
  assert.doesNotMatch(html, /data-collaboration-action="CANCEL"/);
});

test('removes the card risk notice after resolution or for a nonmatching intervention', () => {
  const value = snapshot();
  value.status = 'CANCELLED';
  value.interventions = [{
    id: 'residual-risk-1',
    code: 'ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK',
    requiredAction: 'Verify OpenClaw Task termination.',
    resumeStatus: 'CANCELLING',
    createdAt: 3,
    resolvedAt: 4,
  }];
  const render = () => renderToStaticMarkup(createElement(CollaborationCard, {
    run: value,
    snapshot: value,
    translate: (_key, fallback) => fallback,
  }));

  assert.doesNotMatch(render(), /data-collaboration-residual-execution-risk/);
  value.interventions = [{ ...value.interventions[0], code: 'ATTEMPT_CANCELLED', resolvedAt: null }];
  assert.doesNotMatch(render(), /data-collaboration-residual-execution-risk/);
});

test('ships bounded residual-risk copy in every collaboration locale', () => {
  for (const [locale, catalog] of Object.entries({ en, zh, ar })) {
    const copy = catalog.collaboration.residualExecutionRisk;
    for (const [field, value] of Object.entries(copy)) {
      assert.ok(value.trim().length > 0, `${locale}.${field} must not be empty`);
      assert.ok(Buffer.byteLength(value, 'utf8') <= 512, `${locale}.${field} must remain bounded`);
      assert.match(value, /OpenClaw/, `${locale}.${field} must identify the unconfirmed runtime`);
    }
  }
});
