import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CollaborationEvent, CollaborationRunSnapshot } from '@/types/collaboration';
import { CollaborationDetails } from './CollaborationDetails';

const NOW = Date.parse('2026-07-16T09:00:00Z');

function snapshot(): CollaborationRunSnapshot {
  return {
    runId: 'run-details',
    status: 'AWAITING_INTERVENTION',
    dispatchState: 'STOPPED',
    archiveState: 'ACTIVE',
    reconcileState: 'ATTENTION_REQUIRED',
    completionOutcome: null,
    revision: 8,
    lastEventSequence: 30,
    snapshotRevision: 8,
    goal: 'Prepare a traceable launch decision',
    origin: {
      runtimeId: 'runtime-1',
      agentId: 'main',
      sessionKey: 'agent:main:main',
      sessionId: 'session-a',
      nativeMessageId: 'message-a',
    },
    currentPlanRevisionId: 'plan-2',
    allowedActions: ['WORK_ITEM_RETRY', 'WORK_ITEM_REASSIGN', 'PARTIAL', 'CANCEL'],
    createdAt: NOW - 60_000,
    updatedAt: NOW,
    workItems: [
      {
        id: 'work-research',
        logicalId: 'research',
        planRevisionId: 'plan-2',
        title: 'Collect launch evidence',
        status: 'SUCCEEDED',
        assignedAgentId: 'researcher',
        inputScope: ['launch brief'],
        dependencies: [],
        requiredCapabilities: ['research'],
        candidateAgentIds: ['researcher'],
        acceptanceCriteria: ['Evidence is traceable'],
        revision: 2,
        riskLevel: 'LOW',
        sideEffectClass: 'READ_ONLY',
      },
      {
        id: 'work-review',
        logicalId: 'review',
        planRevisionId: 'plan-2',
        title: 'Review release risk',
        status: 'NEEDS_INTERVENTION',
        assignedAgentId: 'risk-reviewer',
        inputScope: ['research evidence'],
        dependencies: ['research'],
        requiredCapabilities: ['risk-review'],
        candidateAgentIds: ['risk-reviewer'],
        acceptanceCriteria: ['Release risks are classified'],
        revision: 3,
        riskLevel: 'HIGH',
        sideEffectClass: 'LOCAL_WRITE',
      },
    ],
    attempts: [
      {
        id: 'attempt-1',
        workItemId: 'work-review',
        kind: 'WORKER',
        attemptNo: 2,
        status: 'FAILED',
        workerAgentId: 'risk-reviewer',
        executionTaskId: 'task-1',
        agentRunId: 'agent-run-1',
        workerSessionKey: 'agent:risk-reviewer:subagent:task-1',
        workerSessionId: 'worker-session-1',
        revision: 2,
        startedAt: NOW - 20_000,
        endedAt: NOW - 10_000,
        lastError: 'Source permission denied',
      },
    ],
    evidence: [
      {
        id: 'evidence-1',
        type: 'source',
        title: 'Release checklist',
        reference: 'docs/release-checklist.md',
        verification: 'Read at revision 18',
        warning: 'One owner is missing',
      },
    ],
    interventions: [
      {
        id: 'intervention-1',
        code: 'WORKER_FAILED',
        entityRef: { type: 'work_item', id: 'work-review' },
        requiredAction: 'Choose a replacement reviewer or accept the partial result.',
        diagnostics: { taskId: 'task-1', retryable: true },
        resumeStatus: 'RUNNING',
        createdAt: NOW - 9_000,
      },
    ],
    deliveries: [
      {
        id: 'delivery-1',
        targetRevision: 8,
        status: 'PREPARED',
        transcriptStatus: 'PENDING',
        channelStatus: 'NOT_REQUIRED',
        requirement: 'TRANSCRIPT',
        revision: 1,
        target: {
          runtimeId: 'runtime-1',
          agentId: 'main',
          sessionKey: 'agent:main:main',
          sessionId: 'session-a',
          nativeMessageId: 'message-a',
        },
      },
    ],
    planRevisions: [
      { id: 'plan-1', revisionNo: 1, createdBy: 'planner', createdAt: NOW - 50_000 },
      { id: 'plan-2', revisionNo: 2, approvedBy: 'user', approvedAt: NOW - 40_000 },
    ],
    decisions: [
      {
        id: 'decision-1',
        runId: 'run-details',
        decisionType: 'PLAN_APPROVED',
        actor: 'operator',
        payload: { assignments: { research: 'researcher', review: 'risk-reviewer' } },
        createdAt: NOW - 35_000,
      },
    ],
    workflowTemplate: {
      templateId: 'template-launch',
      templateVersionId: 'template-version-launch-1',
      templateName: 'Launch assessment',
      templateVersionNo: 1,
      templateDigest: 'a'.repeat(64),
      parameterDigest: 'b'.repeat(64),
      instantiatedAt: NOW - 45_000,
    },
    finalArtifact: {
      id: 'artifact-1',
      runId: 'run-details',
      sourceAttemptId: 'attempt-synthesis',
      content: `Partial decision memo: ${'evidence remains traceable. '.repeat(12)}`,
      digest: 'sha256:artifact-digest',
      createdAt: NOW - 5_000,
    },
  };
}

const EVENTS: CollaborationEvent[] = [
  {
    sequence: 29,
    runId: 'run-details',
    eventType: 'ATTEMPT_FAILED',
    entityType: 'attempt',
    entityId: 'attempt-1',
    runRevision: 7,
    payload: { reason: 'permission' },
    createdAt: NOW - 10_000,
  },
  {
    sequence: 30,
    runId: 'run-details',
    eventType: 'INTERVENTION_CREATED',
    entityType: 'intervention',
    entityId: 'intervention-1',
    runRevision: 8,
    payload: { code: 'WORKER_FAILED' },
    createdAt: NOW - 9_000,
  },
];

test('renders the graph and every traceability section from the canonical snapshot', () => {
  const html = renderToStaticMarkup(createElement(CollaborationDetails, {
    snapshot: snapshot(),
    events: EVENTS,
    locale: 'en-US',
    onAction: () => undefined,
  }));

  assert.match(html, /data-work-item-view="graph"/);
  assert.match(html, /data-work-item-graph/);
  assert.match(html, /data-work-item-edge="research-/);
  assert.match(html, /Collect launch evidence/);
  assert.match(html, /Source permission denied/);
  assert.match(html, /OpenClaw Task/);
  assert.match(html, /task-1/);
  assert.match(html, /OpenClaw Run/);
  assert.match(html, /agent-run-1/);
  assert.match(html, /agent:risk-reviewer:subagent:task-1/);
  assert.match(html, /worker-session-1/);
  assert.match(html, /Release checklist/);
  assert.match(html, /WORKER_FAILED/);
  assert.match(html, /Target revision 8/);
  assert.match(html, /Plan revision 2/);
  assert.match(html, /Template source/);
  assert.match(html, /Launch assessment/);
  assert.match(html, /Approval history/);
  assert.match(html, /Plan approved/);
  assert.match(html, /Partial decision memo/);
  assert.match(html, /evidence remains traceable\. evidence remains traceable\./);
  assert.doesNotMatch(html, /evidence remains traceable\.\.\./);
  assert.match(html, /data-collaboration-final-artifact-content/);
  assert.match(html, /attempt-synthesis/);
  assert.match(html, /sha256:artifact-digest/);
  assert.match(html, /INTERVENTION_CREATED/);
  assert.match(html, /data-collaboration-action="WORK_ITEM_RETRY"/);
});

test('supports a list projection without changing the workflow data', () => {
  const html = renderToStaticMarkup(createElement(CollaborationDetails, {
    snapshot: snapshot(),
    workItemView: 'list',
  }));

  assert.match(html, /data-work-item-view="list"/);
  assert.match(html, /Work item/);
  assert.match(html, /risk-reviewer/);
  assert.doesNotMatch(html, /data-work-item-view="graph"/);
});

test('renders an Agent Office projection from the same authoritative snapshot', () => {
  const html = renderToStaticMarkup(createElement(CollaborationDetails, {
    snapshot: snapshot(),
    workItemView: 'office',
    configuredAgents: [
      {
        id: 'researcher',
        name: 'Research Agent',
        runtimeType: 'native',
        allowed: true,
        coordinator: false,
      },
      {
        id: 'risk-reviewer',
        name: 'Risk Review Agent',
        runtimeType: 'acp',
        allowed: true,
        coordinator: false,
      },
      {
        id: 'new-agent',
        name: 'New Agent',
        runtimeType: 'native',
        allowed: true,
        coordinator: false,
      },
    ],
    coordinatorAgentId: 'planner',
  }));

  assert.match(html, /data-work-item-view="office"/);
  assert.match(html, /data-agent-office="run-details"/);
  assert.match(html, /data-office-layout="spatial"/);
  assert.match(html, /data-office-agent-id="researcher"/);
  assert.match(html, /data-office-agent-id="risk-reviewer"/);
  assert.match(html, /data-office-agent-state="ATTENTION"/);
  assert.match(html, /data-office-zone="active"/);
  assert.match(html, /data-office-zone="waiting"/);
  assert.match(html, /data-office-configured-agent-id="new-agent"/);
  assert.match(html, /data-office-seat="configured"/);
  assert.match(html, /Configured seat only\. It does not claim current run participation, live presence, or execution state/);
  assert.match(html, /Read-only projection from the authoritative collaboration snapshot/);
  assert.doesNotMatch(html, /online/i);
  assert.doesNotMatch(html, /data-work-item-view="graph"/);
});

test('renders the Office empty state when the run has no authoritative participants', () => {
  const value = snapshot();
  value.workItems = [];
  value.attempts = [];
  const html = renderToStaticMarkup(createElement(CollaborationDetails, {
    snapshot: value,
    workItemView: 'office',
  }));

  assert.match(html, /data-work-item-view="office"/);
  assert.match(html, /No authoritative Agent assignment is available/);
});

test('renders loading and recoverable error states', () => {
  const loadingHtml = renderToStaticMarkup(createElement(CollaborationDetails, { loading: true }));
  assert.match(loadingHtml, /aria-busy="true"/);

  const errorHtml = renderToStaticMarkup(createElement(CollaborationDetails, {
    error: 'Instance changed',
    onRetry: () => undefined,
  }));
  assert.match(errorHtml, /role="alert"/);
  assert.match(errorHtml, /Instance changed/);
  assert.match(errorHtml, />Retry</);
});

test('keeps an authoritative snapshot visible while showing a recoverable sync error', () => {
  const html = renderToStaticMarkup(createElement(CollaborationDetails, {
    snapshot: snapshot(),
    events: EVENTS,
    error: 'The latest event page could not be decoded',
    onRetry: () => undefined,
  }));

  assert.match(html, /data-collaboration-details="run-details"/);
  assert.match(html, /Prepare a traceable launch decision/);
  assert.match(html, /The latest event page could not be decoded/);
  assert.match(html, /role="alert"/);
  assert.match(html, />Retry</);
});

test('labels a partial audit timeline without hiding the authoritative snapshot', () => {
  const html = renderToStaticMarkup(createElement(CollaborationDetails, {
    snapshot: snapshot(),
    events: EVENTS,
    eventTimelineComplete: false,
    eventTimelineIncompleteReason: 'compacted',
    onRetry: () => undefined,
  }));

  assert.match(html, /data-collaboration-details="run-details"/);
  assert.match(html, /Prepare a traceable launch decision/);
  assert.match(html, /Audit timeline is incomplete/);
  assert.match(html, /compacted/);
  assert.match(html, />Retry</);
  assert.doesNotMatch(html, /complete history/i);
});

test('keeps residual OpenClaw execution risk prominent in cancelled run details', () => {
  const value = snapshot();
  value.status = 'CANCELLED';
  value.dispatchState = 'CLOSED';
  value.allowedActions = ['EXPORT', 'ARCHIVE'];
  value.interventions = [{
    id: 'residual-risk-1',
    code: 'ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK',
    entityRef: { type: 'attempt', id: 'attempt-1' },
    requiredAction: 'Verify OpenClaw Task termination.',
    diagnostics: { taskId: 'task-1' },
    resumeStatus: 'CANCELLING',
    createdAt: NOW,
    resolvedAt: null,
  }];
  const html = renderToStaticMarkup(createElement(CollaborationDetails, {
    snapshot: value,
    translate: (_key, fallback) => fallback,
    onAction: () => undefined,
  }));

  assert.match(html, /data-collaboration-residual-execution-risk="true"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Cancelled locally; OpenClaw Task termination unconfirmed/);
  assert.match(html, /external work or side effects may continue/);
  assert.match(html, /data-collaboration-action="EXPORT"/);
  assert.match(html, /data-collaboration-action="ARCHIVE"/);
  assert.doesNotMatch(html, /data-collaboration-action="CANCEL"/);
});

test('does not render a residual-risk detail notice for a nonmatching intervention', () => {
  const value = snapshot();
  value.status = 'CANCELLED';
  value.interventions[0] = { ...value.interventions[0], code: 'WORKER_FAILED', resolvedAt: null };
  const html = renderToStaticMarkup(createElement(CollaborationDetails, {
    snapshot: value,
    translate: (_key, fallback) => fallback,
  }));

  assert.doesNotMatch(html, /data-collaboration-residual-execution-risk/);
});
