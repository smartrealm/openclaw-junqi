import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  CollaborationRunSummary,
  CollaborationTombstone,
  CollaborationWorkflowTemplate,
} from '@/services/collaboration/types';
import { CollaborationHistoryDrawer } from './CollaborationHistoryDrawer';

function run(overrides: Partial<CollaborationRunSummary> = {}): CollaborationRunSummary {
  return {
    runId: 'run-1',
    status: 'RUNNING',
    dispatchState: 'OPEN',
    archiveState: 'ACTIVE',
    reconcileState: 'IDLE',
    completionOutcome: null,
    revision: 1,
    lastEventSequence: 1,
    goal: 'Default workflow',
    origin: {
      runtimeId: 'runtime-1',
      agentId: 'main',
      sessionKey: 'agent:main:main',
      sessionId: 'session-1',
      nativeMessageId: 'message-1',
    },
    currentPlanRevisionId: 'plan-1',
    allowedActions: ['CANCEL'],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function tombstone(overrides: Partial<CollaborationTombstone> = {}): CollaborationTombstone {
  return {
    id: 'tombstone-1',
    runId: 'deleted-run',
    actor: 'operator',
    contentDigest: 'a'.repeat(64),
    deletedAt: 30,
    cleanupStatus: 'COMPLETED',
    cleanupError: null,
    cleanupUpdatedAt: 30,
    deletionJobId: null,
    deletionJobStatus: null,
    flowReconciliationCommandId: null,
    openclawFlowId: null,
    openclawFlowRevision: null,
    flowReconciliationDiagnostic: null,
    flowReconciliationAbandonedAt: null,
    flowReconciliationAbandonReason: null,
    ...overrides,
  };
}

function template(overrides: Partial<CollaborationWorkflowTemplate> = {}): CollaborationWorkflowTemplate {
  return {
    id: 'template-1',
    name: 'Launch assessment',
    status: 'PUBLISHED',
    sourceRunId: 'run-1',
    createdBy: 'operator',
    createdAt: 10,
    updatedAt: 20,
    currentVersion: {
      id: 'template-version-1',
      templateId: 'template-1',
      versionNo: 1,
      digest: 'a'.repeat(64),
      sourceRunId: 'run-1',
      sourcePlanRevisionId: 'plan-1',
      createdBy: 'operator',
      createdAt: 10,
      definition: {
        schemaVersion: 1,
        goal: 'Assess the launch',
        workItems: [
          { id: 'research', title: 'Research', dependencies: [] },
          { id: 'review', title: 'Review', dependencies: ['research'] },
        ],
        synthesis: { requiredEvidence: ['research'], finalAnswerContract: 'Recommendation' },
      },
    },
    ...overrides,
  };
}

test('closed drawer does not leave an interactive surface in the document', () => {
  const html = renderToStaticMarkup(createElement(CollaborationHistoryDrawer, {
    open: false,
    runs: [],
    onClose: () => undefined,
  }));
  assert.equal(html, '');
});

test('lists newest runs first and marks archived and selected records', () => {
  const html = renderToStaticMarkup(createElement(CollaborationHistoryDrawer, {
    open: true,
    runs: [
      run({ runId: 'old-run', goal: 'Older workflow', updatedAt: 10 }),
      run({ runId: 'new-run', goal: 'Newer workflow', updatedAt: 20, status: 'COMPLETED', archiveState: 'ARCHIVED' }),
    ],
    selectedRunId: 'new-run',
    onClose: () => undefined,
    onSelectRun: () => undefined,
  }));

  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /tabindex="-1"/);
  assert.ok(html.indexOf('Newer workflow') < html.indexOf('Older workflow'));
  assert.match(html, /aria-current="true"/);
  assert.match(html, />Archived</);
  assert.match(html, /2 runs/);
});

test('renders loading, empty, and recoverable error states', () => {
  const loading = renderToStaticMarkup(createElement(CollaborationHistoryDrawer, {
    open: true,
    runs: [],
    loading: true,
    onClose: () => undefined,
  }));
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Loading collaboration history/);

  const empty = renderToStaticMarkup(createElement(CollaborationHistoryDrawer, {
    open: true,
    runs: [],
    onClose: () => undefined,
  }));
  assert.match(empty, /No collaboration runs yet/);

  const error = renderToStaticMarkup(createElement(CollaborationHistoryDrawer, {
    open: true,
    runs: [],
    error: 'Gateway unavailable',
    onClose: () => undefined,
    onRetry: () => undefined,
  }));
  assert.match(error, /role="alert"/);
  assert.match(error, /Gateway unavailable/);
  assert.match(error, />Retry</);
});

test('places reusable workflow templates in durable history with an explicit run control', () => {
  const html = renderToStaticMarkup(createElement(CollaborationHistoryDrawer, {
    open: true,
    runs: [],
    templates: [template()],
    onClose: () => undefined,
    onInstantiateTemplate: () => undefined,
  }));

  assert.match(html, />Workflow templates</);
  assert.match(html, /Launch assessment/);
  assert.match(html, />v1</);
  assert.match(html, /2 work items/);
  assert.match(html, /aria-label="Run template"/);
});

test('shows deleted audit records without rendering deleted run content and warns about unfinished cleanup', () => {
  const html = renderToStaticMarkup(createElement(CollaborationHistoryDrawer, {
    open: true,
    runs: [
      run({ runId: 'deleted-run', goal: 'DELETED_PRIVATE_RESULT', updatedAt: 30 }),
      run({ runId: 'visible-run', goal: 'Visible workflow', updatedAt: 20 }),
    ],
    tombstones: [
      tombstone({
        cleanupStatus: 'PARTIAL',
        cleanupError: 'permission denied',
        deletionJobId: 'delete-job-1',
        deletionJobStatus: 'PARTIAL',
      }),
      tombstone({
        id: 'tombstone-2',
        runId: 'pending-run',
        actor: 'retention-policy',
        deletedAt: 40,
        cleanupStatus: 'PENDING',
        cleanupUpdatedAt: 41,
      }),
    ],
    onClose: () => undefined,
    onSelectRun: () => undefined,
    onRetryCleanup: () => undefined,
  }));

  assert.match(html, />Deleted records</);
  assert.match(html, /Deleted collaboration records/);
  assert.match(html, /Deleted by operator/);
  assert.match(html, /Some managed files still need cleanup/);
  assert.match(html, /Managed file cleanup is pending/);
  assert.match(html, /Cleanup detail: permission denied/);
  assert.match(html, />Retry cleanup</);
  assert.match(html, /data-deletion-job-id="delete-job-1"/);
  assert.match(html, /2 deleted/);
  assert.match(html, /Visible workflow/);
  assert.doesNotMatch(html, /DELETED_PRIVATE_RESULT/);
  assert.doesNotMatch(html, /data-flow-reconciliation-abandonment/);
});

test('renders explicit Flow reconciliation abandonment as durable audit evidence', () => {
  const html = renderToStaticMarkup(createElement(CollaborationHistoryDrawer, {
    open: true,
    runs: [],
    tombstones: [tombstone({
      flowReconciliationCommandId: 'command-flow-sync-1',
      openclawFlowId: 'managed-flow-1',
      openclawFlowRevision: 7,
      flowReconciliationDiagnostic: 'OpenClaw Flow state no longer matches the terminal run',
      flowReconciliationAbandonedAt: Date.UTC(2026, 6, 17, 8, 30),
      flowReconciliationAbandonReason: 'The Flow was removed by an operator and cannot be reconciled.',
    })],
    locale: 'en-US',
    onClose: () => undefined,
  }));

  assert.match(html, /role="note"/);
  assert.match(html, /data-flow-reconciliation-abandonment="true"/);
  assert.match(html, /Flow reconciliation explicitly abandoned/);
  assert.match(html, /Abandoned Jul 17, 2026/);
  assert.match(html, /Reason:\s*<\/span><span data-flow-abandonment-reason="true">The Flow was removed by an operator and cannot be reconciled\./);
  assert.match(html, /data-flow-command-id="true">command-flow-sync-1/);
  assert.match(html, /data-managed-flow-id="true">managed-flow-1/);
  assert.match(html, /data-managed-flow-revision="true">7/);
  assert.match(html, /data-flow-diagnostic="true">OpenClaw Flow state no longer matches the terminal run/);
});
