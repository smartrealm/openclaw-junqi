import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import en from '@/locales/en.json';
import zh from '@/locales/zh.json';
import type { CollaborationRunSnapshot } from '@/services/collaboration/types';
import { CollaborationActionDialog } from './CollaborationActionDialog';

function snapshot(allowedActions: string[]): CollaborationRunSnapshot {
  return {
    runId: 'run-dialog',
    status: 'AWAITING_INTERVENTION',
    dispatchState: 'STOPPED',
    archiveState: 'ACTIVE',
    reconcileState: 'IDLE',
    completionOutcome: null,
    revision: 12,
    snapshotRevision: 12,
    lastEventSequence: 30,
    goal: 'Prepare a diligence report',
    origin: {
      runtimeId: 'runtime-1', agentId: 'main', sessionKey: 'agent:main:desktop',
      sessionId: 'session-1', nativeMessageId: 'message-1',
    },
    currentPlanRevisionId: 'plan-4',
    allowedActions,
    createdAt: 1,
    updatedAt: 2,
    workItems: [{
      id: 'work-1', logicalId: 'research', planRevisionId: 'plan-4', title: 'Research risks',
      status: 'NEEDS_INTERVENTION', assignedAgentId: 'worker-a', inputScope: ['origin'], dependencies: [],
      requiredCapabilities: ['research'], candidateAgentIds: ['worker-a', 'worker-b'],
      acceptanceCriteria: ['Risks are sourced'], revision: 6,
      riskLevel: 'MEDIUM', sideEffectClass: 'READ_ONLY',
    }],
    attempts: [{
      id: 'attempt-unknown-1', workItemId: 'work-1', kind: 'WORKER', attemptNo: 2,
      status: 'UNKNOWN', workerAgentId: 'worker-a', revision: 9,
      executionTaskId: 'openclaw-task-1',
      workerSessionKey: 'agent:worker-a:subagent:openclaw-task-1',
      startedAt: 1, endedAt: null, lastError: 'Worker outcome could not be verified',
    }],
    interventions: [],
    deliveries: [{
      id: 'delivery-1', targetRevision: 2, status: 'UNKNOWN', transcriptStatus: 'UNKNOWN',
      channelStatus: 'NOT_REQUIRED', requirement: 'TRANSCRIPT', revision: 8,
      target: {
        runtimeId: 'runtime-1', agentId: 'main', sessionKey: 'agent:main:desktop',
        sessionId: 'session-1', nativeMessageId: 'message-1',
      },
    }],
    planRevisions: [{ plan: { workItems: [{ id: 'research', candidateAgentIds: ['worker-a', 'worker-b'] }] } }],
  };
}

const noop = () => undefined;

test('does not render a client-invented action that the server did not allow', () => {
  const html = renderToStaticMarkup(createElement(CollaborationActionDialog, {
    open: true,
    action: 'DELETE',
    snapshot: snapshot(['CANCEL']),
    onClose: noop,
    onSubmit: noop,
  }));
  assert.equal(html, '');
});

test('plan revision dialog displays the authoritative run and plan revisions', () => {
  const html = renderToStaticMarkup(createElement(CollaborationActionDialog, {
    open: true,
    action: 'PLAN_REVISE',
    snapshot: snapshot(['PLAN_REVISE']),
    onClose: noop,
    onSubmit: noop,
  }));
  assert.match(html, /Revision 12/);
  assert.match(html, /plan-4/);
  assert.match(html, /Revision instruction/);
  assert.match(html, /textarea/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /data-modal-initial-focus="true"/);
});

test('work-item selection exposes entity revisions and only plan-approved agents', () => {
  const value = snapshot(['WORK_ITEM_REASSIGN']);
  value.attempts = [];
  const html = renderToStaticMarkup(createElement(CollaborationActionDialog, {
    open: true,
    action: 'WORK_ITEM_REASSIGN',
    snapshot: value,
    initialEntityId: 'work-1',
    onClose: noop,
    onSubmit: noop,
  }));
  assert.match(html, /Research risks \(rev 6\)/);
  assert.match(html, /Entity revision/);
  assert.match(html, />6</);
  assert.match(html, /worker-a/);
  assert.match(html, /worker-b/);
});

test('additional input is explicitly next-attempt-only and never promises stored-content recall', () => {
  const value = snapshot(['WORK_ITEM_INPUT_APPEND']);
  value.workItems.push({
    ...value.workItems[0]!,
    id: 'work-2',
    logicalId: 'report',
    title: 'Prepare report',
    status: 'BLOCKED',
    revision: 3,
  });
  const html = renderToStaticMarkup(createElement(CollaborationActionDialog, {
    open: true,
    action: 'WORK_ITEM_INPUT_APPEND',
    snapshot: value,
    initialEntityId: 'work-2',
    onClose: noop,
    onSubmit: noop,
  }));

  assert.match(html, /Input for the next attempt/);
  assert.match(html, /bound to exactly the next attempt/i);
  assert.match(html, /cannot change an active attempt/i);
  assert.match(html, /will not be shown here again/i);
  assert.match(html, /Prepare report \(rev 3\)/);
  assert.match(html, /textarea/);
  assert.match(html, /type="submit" disabled=""/);
  assert.doesNotMatch(html, /WORK_ITEM_INPUT_MUST_NOT_BE_EXPORTED/);
});

test('work-item cancellation requires an explicit real-cancellation acknowledgement', () => {
  const html = renderToStaticMarkup(createElement(CollaborationActionDialog, {
    open: true,
    action: 'WORK_ITEM_CANCEL',
    snapshot: snapshot(['WORK_ITEM_CANCEL']),
    initialEntityId: 'work-1',
    onClose: noop,
    onSubmit: noop,
  }));

  assert.match(html, /Cancel work item/);
  assert.match(html, /new dispatch will stop/i);
  assert.match(html, /active OpenClaw attempt/i);
  assert.match(html, /real cancellation request/i);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /type="submit" disabled=""/);
});

test('UNKNOWN delivery retry explains same-delivery reconciliation without a risk checkbox', () => {
  const html = renderToStaticMarkup(createElement(CollaborationActionDialog, {
    open: true,
    action: 'DELIVERY_RETRY',
    snapshot: snapshot(['DELIVERY_RETRY']),
    initialEntityId: 'delivery-1',
    onClose: noop,
    onSubmit: noop,
  }));
  assert.match(html, /UNKNOWN \/ target 2 \(rev 8\)/);
  assert.match(html, /previous delivery outcome is unknown/i);
  assert.match(html, /reconcile the original delivery/i);
  assert.doesNotMatch(html, /duplicate message/i);
  assert.doesNotMatch(html, /type="checkbox"/);
  assert.doesNotMatch(html, /type="submit" disabled=""/);
});

test('unknown-attempt resolution is visible only for a server-allowed UNKNOWN attempt', () => {
  const html = renderToStaticMarkup(createElement(CollaborationActionDialog, {
    open: true,
    action: 'ATTEMPT_RESOLVE_UNKNOWN',
    snapshot: snapshot(['ATTEMPT_RESOLVE_UNKNOWN']),
    onClose: noop,
    onSubmit: noop,
  }));
  assert.match(html, /Resolve unknown attempt/);
  assert.match(html, /WORKER #2 \/ worker-a \(rev 9\)/);
  assert.match(html, /Worker outcome could not be verified/);
  assert.match(html, /OpenClaw Task/);
  assert.match(html, /openclaw-task-1/);
  assert.match(html, /Worker session/);
  assert.match(html, /agent:worker-a:subagent:openclaw-task-1/);
  assert.match(html, /Verify the exact OpenClaw Task, Run, and worker session/);
  assert.doesNotMatch(html, /option value="RUNNING">Running/);
  assert.doesNotMatch(html, /option value="SUCCEEDED">Succeeded/);
  assert.match(html, /option value="FAILED">Failed/);
  assert.match(html, /option value="TIMED_OUT">Timed out/);
  assert.match(html, /option value="CANCELLED">Cancelled/);
  assert.doesNotMatch(html, /option value="ABANDONED">Abandoned/);
  assert.match(html, /type="submit" disabled=""/);

  const cancelling = snapshot(['ATTEMPT_RESOLVE_UNKNOWN']);
  cancelling.status = 'CANCELLING';
  const cancellationWithoutEvidence = renderToStaticMarkup(createElement(CollaborationActionDialog, {
    open: true,
    action: 'ATTEMPT_RESOLVE_UNKNOWN',
    snapshot: cancelling,
    onClose: noop,
    onSubmit: noop,
  }));
  assert.doesNotMatch(cancellationWithoutEvidence, /option value="ABANDONED">Abandoned/);

  cancelling.attempts[0] = {
    ...cancelling.attempts[0]!,
    canAbandonWithResidualRisk: true,
  };
  const residualRiskResolution = renderToStaticMarkup(createElement(CollaborationActionDialog, {
    open: true,
    action: 'ATTEMPT_RESOLVE_UNKNOWN',
    snapshot: cancelling,
    onClose: noop,
    onSubmit: noop,
  }));
  assert.match(residualRiskResolution, /option value="ABANDONED">Abandoned/);

  const withExactAgentRun = snapshot(['ATTEMPT_RESOLVE_UNKNOWN']);
  withExactAgentRun.attempts[0] = {
    ...withExactAgentRun.attempts[0]!,
    agentRunId: 'openclaw-run-1',
  };
  const resumable = renderToStaticMarkup(createElement(CollaborationActionDialog, {
    open: true,
    action: 'ATTEMPT_RESOLVE_UNKNOWN',
    snapshot: withExactAgentRun,
    onClose: noop,
    onSubmit: noop,
  }));
  assert.match(resumable, /option value="RUNNING">Running/);
  assert.match(resumable, /OpenClaw Run/);
  assert.match(resumable, /openclaw-run-1/);
  assert.doesNotMatch(resumable, /option value="SUCCEEDED">Succeeded/);

  const withoutUnknown = snapshot(['ATTEMPT_RESOLVE_UNKNOWN']);
  withoutUnknown.attempts = [];
  const hidden = renderToStaticMarkup(createElement(CollaborationActionDialog, {
    open: true,
    action: 'ATTEMPT_RESOLVE_UNKNOWN',
    snapshot: withoutUnknown,
    onClose: noop,
    onSubmit: noop,
  }));
  assert.equal(hidden, '');
});

test('partial and delete confirmations render only server-provided preview impact', () => {
  const partialHtml = renderToStaticMarkup(createElement(CollaborationActionDialog, {
    open: true,
    action: 'PARTIAL',
    snapshot: snapshot(['PARTIAL']),
    initialWorkItemIds: ['research'],
    preview: {
      runId: 'run-dialog', runRevision: 12, expiresAt: Date.now() + 60_000, confirmationToken: 'server-token',
      closure: { waiveIds: ['research'], blockedDescendantIds: ['report'], activeIds: ['research'] },
    },
    onClose: noop,
    onSubmit: noop,
  }));
  assert.match(partialHtml, /Server-confirmed impact/);
  assert.match(partialHtml, /Blocked descendants/);
  assert.match(partialHtml, /report/);

  const deleteHtml = renderToStaticMarkup(createElement(CollaborationActionDialog, {
    open: true,
    action: 'DELETE',
    snapshot: snapshot(['DELETE']),
    preview: {
      runId: 'run-dialog', runRevision: 12, digest: 'digest-from-server',
      expiresAt: Date.now() + 60_000, confirmationToken: 'delete-token',
    },
    onClose: noop,
    onSubmit: noop,
  }));
  assert.match(deleteHtml, /digest-from-server/);
  assert.match(deleteHtml, /permanently delete this run/i);
  assert.doesNotMatch(deleteHtml, /delete-token/);
  assert.doesNotMatch(deleteHtml, /data-flow-reconciliation-blocker/);
  assert.equal(deleteHtml.match(/type="checkbox"/g)?.length, 1);
});

test('blocked Flow reconciliation renders structured risk evidence and gates final deletion', () => {
  const html = renderToStaticMarkup(createElement(CollaborationActionDialog, {
    open: true,
    action: 'DELETE',
    snapshot: snapshot(['DELETE']),
    preview: {
      runId: 'run-dialog',
      runRevision: 12,
      digest: 'digest-with-flow-blocker',
      expiresAt: Date.now() + 60_000,
      confirmationToken: 'blocked-delete-token',
      flowReconciliationBlocker: {
        commandId: 'flow-command-17',
        commandStatus: 'FAILED',
        flowId: 'managed-flow-9',
        flowRevision: 23,
        diagnostic: 'Gateway could not confirm the final Flow status.',
      },
    },
    onClose: noop,
    onSubmit: noop,
  }));

  assert.match(html, /data-flow-reconciliation-blocker/);
  assert.match(html, /Flow reconciliation is unresolved/);
  assert.match(html, /flow-command-17/);
  assert.match(html, /FAILED/);
  assert.match(html, /managed-flow-9/);
  assert.match(html, />23</);
  assert.match(html, /Gateway could not confirm the final Flow status/);
  assert.match(html, /data-flow-abandonment-reason/);
  assert.match(html, /Reason for abandonment/);
  assert.match(html, /cannot be resumed after deletion/);
  assert.equal(html.match(/type="checkbox"/g)?.length, 2);

  const flowAbandonmentConfirmation = html.match(/<input[^>]*data-confirm-flow-abandonment[^>]*>/)?.[0];
  assert.ok(flowAbandonmentConfirmation);
  assert.match(flowAbandonmentConfirmation, /required=""/);

  const finalConfirmation = html.match(/<input[^>]*data-confirm-delete[^>]*>/)?.[0];
  assert.ok(finalConfirmation);
  assert.match(finalConfirmation, /disabled=""/);
  assert.match(html, /type="submit" disabled=""/);
  assert.doesNotMatch(html, /blocked-delete-token/);
});

test('Flow abandonment copy has exact English and Chinese locale parity', () => {
  const english = en.collaboration.actionDialog;
  const chinese = zh.collaboration.actionDialog;
  assert.deepEqual(Object.keys(english).sort(), Object.keys(chinese).sort());

  const requiredKeys = [
    'flowReconciliationBlockerTitle',
    'flowReconciliationBlockerMessage',
    'flowCommandId',
    'flowCommandStatus',
    'managedFlowId',
    'managedFlowRevision',
    'flowReconciliationDiagnostic',
    'notAvailable',
    'flowAbandonmentReason',
    'flowAbandonmentReasonPlaceholder',
    'confirmFlowReconciliationAbandonment',
  ] as const;
  for (const key of requiredKeys) {
    assert.ok(english[key].trim(), `Missing English collaboration.actionDialog.${key}`);
    assert.ok(chinese[key].trim(), `Missing Chinese collaboration.actionDialog.${key}`);
  }
});
