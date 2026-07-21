import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  CollaborationRunActionError,
  buildRunAction as buildRunActionWithIdentity,
  completeCollaborationDeletion,
  completeCollaborationExport,
  deleteConfirmationReady,
  executeRunAction,
  previewRunAction,
  resolutionsForUnknownAttempt,
  type CollaborationDeletePreview,
  type CollaborationPartialPreview,
  type CollaborationRunActionSubmission,
} from './runActions';
import type {
  CollaborationRunSnapshot,
  CollaborationWriteMethod,
} from './types';

const TEST_INSTANCE_ID = 'instance-1';
const DELETE_DIGEST = 'd'.repeat(64);

function buildRunAction(
  run: CollaborationRunSnapshot,
  submission: CollaborationRunActionSubmission,
  commandId?: string,
) {
  return buildRunActionWithIdentity(run, submission, TEST_INSTANCE_ID, commandId);
}

function snapshot(allowedActions: string[]): CollaborationRunSnapshot {
  return {
    runId: 'run-1',
    status: 'AWAITING_INTERVENTION',
    dispatchState: 'STOPPED',
    archiveState: 'ACTIVE',
    reconcileState: 'IDLE',
    completionOutcome: null,
    revision: 7,
    lastEventSequence: 20,
    snapshotRevision: 7,
    goal: 'Review the proposal',
    origin: {
      runtimeId: TEST_INSTANCE_ID,
      agentId: 'main',
      sessionKey: 'agent:main:desktop',
      sessionId: 'session-1',
      nativeMessageId: 'message-1',
    },
    currentPlanRevisionId: 'plan-3',
    allowedActions,
    createdAt: 1,
    updatedAt: 2,
    workItems: [
      {
        id: 'work-db-1',
        logicalId: 'research',
        planRevisionId: 'plan-3',
        title: 'Research',
        status: 'NEEDS_INTERVENTION',
        assignedAgentId: 'worker-a',
        inputScope: ['origin'],
        dependencies: [],
        requiredCapabilities: ['analysis'],
        candidateAgentIds: ['worker-a', 'worker-b'],
        acceptanceCriteria: ['Evidence is explicit'],
        revision: 4,
        riskLevel: 'LOW',
        sideEffectClass: 'READ_ONLY',
      },
      {
        id: 'work-db-2',
        logicalId: 'report',
        planRevisionId: 'plan-3',
        title: 'Report',
        status: 'BLOCKED',
        assignedAgentId: null,
        inputScope: ['research'],
        dependencies: ['research'],
        requiredCapabilities: ['writing'],
        candidateAgentIds: ['worker-b'],
        acceptanceCriteria: ['Report is complete'],
        revision: 2,
        riskLevel: 'MEDIUM',
        sideEffectClass: 'LOCAL_WRITE',
      },
    ],
    attempts: [{
      id: 'attempt-unknown-1',
      workItemId: 'work-db-1',
      kind: 'WORKER',
      attemptNo: 2,
      status: 'UNKNOWN',
      workerAgentId: 'worker-a',
      revision: 3,
      startedAt: 1,
      endedAt: null,
      lastError: 'The worker outcome could not be confirmed',
    }],
    interventions: [],
    deliveries: [
      {
        id: 'delivery-1',
        targetRevision: 1,
        status: 'UNKNOWN',
        transcriptStatus: 'UNKNOWN',
        channelStatus: 'NOT_REQUIRED',
        requirement: 'TRANSCRIPT',
        revision: 5,
        target: {
          runtimeId: 'runtime-1',
          agentId: 'main',
          sessionKey: 'agent:main:desktop',
          sessionId: 'session-1',
          nativeMessageId: 'message-1',
        },
      },
    ],
    planRevisions: [{
      id: 'plan-3',
      plan: {
        workItems: [
          { id: 'research', candidateAgentIds: ['worker-a', 'worker-b'] },
          { id: 'report', candidateAgentIds: ['worker-b'] },
        ],
      },
    }],
  };
}

test('direct run action includes the authoritative run revision and stable write envelope', async () => {
  const built = await buildRunAction(snapshot(['CANCEL']), { action: 'CANCEL' }, 'command-cancel');
  assert.equal(built.method, 'junqi.collab.run.cancel');
  assert.equal(built.request.runId, 'run-1');
  assert.equal(built.request.expectedCollaborationInstanceId, TEST_INSTANCE_ID);
  assert.equal(built.request.expectedRunRevision, 7);
  assert.equal(built.request.commandId, 'command-cancel');
  assert.match(built.request.payloadHash, /^[a-f0-9]{64}$/);
});

test('a locally known action is rejected unless the server allowed it', async () => {
  await assert.rejects(
    buildRunAction(snapshot(['CANCEL']), { action: 'RECONCILE' }),
    (error: unknown) => error instanceof CollaborationRunActionError && error.code === 'ACTION_NOT_ALLOWED',
  );
});

test('plan approval binds the current plan and requires explicit approved assignments', async () => {
  const built = await buildRunAction(snapshot(['PLAN_APPROVE']), {
    action: 'PLAN_APPROVE',
    assignments: { research: 'worker-b', report: 'worker-b' },
  }, 'command-approve');

  assert.equal(built.method, 'junqi.collab.plan.approve');
  assert.equal(built.request.planRevisionId, 'plan-3');
  assert.equal(built.request.currentPlanRevisionId, 'plan-3');
  assert.deepEqual(built.request.assignments, { research: 'worker-b', report: 'worker-b' });

  await assert.rejects(
    buildRunAction(snapshot(['PLAN_APPROVE']), {
      action: 'PLAN_APPROVE',
      assignments: { research: 'not-approved', report: 'worker-b' },
    }),
    (error: unknown) => error instanceof CollaborationRunActionError && error.code === 'INVALID_ACTION_INPUT',
  );
});

test('work-item actions carry the selected entity revision', async () => {
  const built = await buildRunAction(snapshot(['WORK_ITEM_REASSIGN']), {
    action: 'WORK_ITEM_REASSIGN',
    workItemId: 'work-db-1',
    agentId: 'worker-b',
  });

  assert.equal(built.method, 'junqi.collab.workItem.reassign');
  assert.equal(built.request.workItemId, 'work-db-1');
  assert.equal(built.request.agentId, 'worker-b');
  assert.equal(built.request.expectedEntityRevision, 4);
  assert.equal(built.request.expectedRunRevision, 7);

  const input = await buildRunAction(snapshot(['WORK_ITEM_INPUT_APPEND']), {
    action: 'WORK_ITEM_INPUT_APPEND',
    workItemId: 'work-db-2',
    content: '  Use the signed amendment  ',
  });
  assert.equal(input.method, 'junqi.collab.workItem.input.append');
  assert.equal(input.request.workItemId, 'work-db-2');
  assert.equal(input.request.content, 'Use the signed amendment');
  assert.equal(input.request.expectedEntityRevision, 2);

  const cancel = await buildRunAction(snapshot(['WORK_ITEM_CANCEL']), {
    action: 'WORK_ITEM_CANCEL',
    workItemId: 'work-db-2',
    confirmed: true,
  });
  assert.equal(cancel.method, 'junqi.collab.workItem.cancel');
  assert.equal(cancel.request.workItemId, 'work-db-2');
  assert.equal(cancel.request.expectedEntityRevision, 2);
  assert.equal('confirmed' in cancel.request, false);
});

test('work-item input and cancellation fail closed for active, empty, terminal, or unconfirmed selections', async () => {
  await assert.rejects(
    buildRunAction(snapshot(['WORK_ITEM_INPUT_APPEND']), {
      action: 'WORK_ITEM_INPUT_APPEND',
      workItemId: 'work-db-1',
      content: 'Do not mutate the active UNKNOWN attempt',
    }),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'INVALID_ACTION_INPUT',
  );
  await assert.rejects(
    buildRunAction(snapshot(['WORK_ITEM_INPUT_APPEND']), {
      action: 'WORK_ITEM_INPUT_APPEND',
      workItemId: 'work-db-2',
      content: '   ',
    }),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'INVALID_ACTION_INPUT',
  );
  await assert.rejects(
    buildRunAction(snapshot(['WORK_ITEM_CANCEL']), {
      action: 'WORK_ITEM_CANCEL',
      workItemId: 'work-db-2',
      confirmed: false,
    }),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'CONFIRMATION_REQUIRED',
  );

  const terminal = snapshot(['WORK_ITEM_CANCEL']);
  terminal.workItems[1]!.status = 'SUCCEEDED';
  await assert.rejects(
    buildRunAction(terminal, {
      action: 'WORK_ITEM_CANCEL',
      workItemId: 'work-db-2',
      confirmed: true,
    }),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'INVALID_ACTION_INPUT',
  );
});

test('every non-preview action maps to its exact plugin RPC contract', async () => {
  const cases: Array<{
    submission: CollaborationRunActionSubmission;
    method: CollaborationWriteMethod;
  }> = [
    { submission: { action: 'PLAN_REVISE', instruction: 'Split the research task' }, method: 'junqi.collab.plan.revise' },
    { submission: { action: 'CANCEL' }, method: 'junqi.collab.run.cancel' },
    { submission: { action: 'DISPATCH_STOP' }, method: 'junqi.collab.run.dispatch.stop' },
    { submission: { action: 'DISPATCH_RESUME' }, method: 'junqi.collab.run.dispatch.resume' },
    {
      submission: { action: 'WORK_ITEM_INPUT_APPEND', workItemId: 'work-db-2', content: 'New constraint' },
      method: 'junqi.collab.workItem.input.append',
    },
    {
      submission: { action: 'WORK_ITEM_CANCEL', workItemId: 'work-db-2', confirmed: true },
      method: 'junqi.collab.workItem.cancel',
    },
    { submission: { action: 'WORK_ITEM_RETRY', workItemId: 'work-db-1' }, method: 'junqi.collab.workItem.retry' },
    {
      submission: { action: 'ATTEMPT_RESOLVE_UNKNOWN', attemptId: 'attempt-unknown-1', resolution: 'FAILED' },
      method: 'junqi.collab.attempt.resolveUnknown',
    },
    { submission: { action: 'RECONCILE' }, method: 'junqi.collab.run.reconcile' },
    {
      submission: {
        action: 'DELIVERY_RETARGET',
        deliveryId: 'delivery-1',
        target: {
          runtimeId: 'runtime-2', agentId: 'main', sessionKey: 'agent:main:new',
          sessionId: 'session-2', nativeMessageId: 'message-2',
        },
      },
      method: 'junqi.collab.delivery.retarget',
    },
    {
      submission: { action: 'DELIVERY_ABANDON', deliveryId: 'delivery-1', confirmed: true },
      method: 'junqi.collab.delivery.abandon',
    },
    { submission: { action: 'EXPORT' }, method: 'junqi.collab.export.create' },
    { submission: { action: 'CLONE' }, method: 'junqi.collab.run.clone' },
    { submission: { action: 'ARCHIVE' }, method: 'junqi.collab.run.archive' },
    { submission: { action: 'UNARCHIVE' }, method: 'junqi.collab.run.unarchive' },
  ];

  for (const { submission, method } of cases) {
    const built = await buildRunAction(snapshot([submission.action]), submission);
    assert.equal(built.method, method, submission.action);
    assert.equal(built.request.expectedRunRevision, 7, submission.action);
  }
});

test('unknown attempt resolution binds the exact UNKNOWN attempt and run revision', async () => {
  const built = await buildRunAction(snapshot(['ATTEMPT_RESOLVE_UNKNOWN']), {
    action: 'ATTEMPT_RESOLVE_UNKNOWN',
    attemptId: 'attempt-unknown-1',
    resolution: 'FAILED',
  }, 'command-resolve-unknown');

  assert.equal(built.method, 'junqi.collab.attempt.resolveUnknown');
  assert.equal(built.request.attemptId, 'attempt-unknown-1');
  assert.equal(built.request.resolution, 'FAILED');
  assert.equal(built.request.acceptResidualRisk, false);
  assert.equal(built.request.expectedRunRevision, 7);
  assert.equal(built.request.expectedEntityRevision, 3);

  const nonUnknown = snapshot(['ATTEMPT_RESOLVE_UNKNOWN']);
  nonUnknown.attempts[0] = { ...nonUnknown.attempts[0]!, status: 'FAILED' };
  await assert.rejects(
    buildRunAction(nonUnknown, {
      action: 'ATTEMPT_RESOLVE_UNKNOWN',
      attemptId: 'attempt-unknown-1',
      resolution: 'FAILED',
    }),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'INVALID_ACTION_INPUT',
  );

  await assert.rejects(
    buildRunAction(
      snapshot(['ATTEMPT_RESOLVE_UNKNOWN']),
      {
        action: 'ATTEMPT_RESOLVE_UNKNOWN',
        attemptId: 'attempt-unknown-1',
        resolution: 'SUCCEEDED',
      } as unknown as CollaborationRunActionSubmission,
    ),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'INVALID_ACTION_INPUT',
  );
});

test('unknown-attempt resolution projection remains subordinate to server actions and run state', () => {
  const awaitingIntervention = snapshot(['ATTEMPT_RESOLVE_UNKNOWN']);
  assert.deepEqual(
    resolutionsForUnknownAttempt(awaitingIntervention, awaitingIntervention.attempts[0]),
    ['FAILED', 'TIMED_OUT', 'CANCELLED'],
  );

  const cancelling = snapshot(['ATTEMPT_RESOLVE_UNKNOWN']);
  cancelling.status = 'CANCELLING';
  assert.deepEqual(
    resolutionsForUnknownAttempt(cancelling, cancelling.attempts[0]),
    ['FAILED', 'TIMED_OUT', 'CANCELLED'],
  );

  cancelling.attempts[0] = {
    ...cancelling.attempts[0]!,
    canAbandonWithResidualRisk: true,
  };
  assert.deepEqual(
    resolutionsForUnknownAttempt(cancelling, cancelling.attempts[0]),
    ['FAILED', 'TIMED_OUT', 'CANCELLED', 'ABANDONED'],
  );

  const exactRun = snapshot(['ATTEMPT_RESOLVE_UNKNOWN']);
  exactRun.status = 'CANCELLING';
  exactRun.attempts[0] = {
    ...exactRun.attempts[0]!,
    agentRunId: 'openclaw-run-1',
    canAbandonWithResidualRisk: true,
  };
  assert.deepEqual(
    resolutionsForUnknownAttempt(exactRun, exactRun.attempts[0]),
    ['RUNNING', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'ABANDONED'],
  );

  const serverDenied = snapshot([]);
  serverDenied.status = 'CANCELLING';
  assert.deepEqual(resolutionsForUnknownAttempt(serverDenied, serverDenied.attempts[0]), []);

  const settled = snapshot(['ATTEMPT_RESOLVE_UNKNOWN']);
  settled.status = 'CANCELLING';
  settled.attempts[0] = { ...settled.attempts[0]!, status: 'FAILED' };
  assert.deepEqual(resolutionsForUnknownAttempt(settled, settled.attempts[0]), []);
});

test('abandoning an unknown attempt requires explicit residual-risk acceptance', async () => {
  await assert.rejects(
    buildRunAction(snapshot(['ATTEMPT_RESOLVE_UNKNOWN']), {
      action: 'ATTEMPT_RESOLVE_UNKNOWN',
      attemptId: 'attempt-unknown-1',
      resolution: 'ABANDONED',
      acceptResidualRisk: true,
    }),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'INVALID_ACTION_INPUT',
  );

  const cancelling = snapshot(['ATTEMPT_RESOLVE_UNKNOWN']);
  cancelling.status = 'CANCELLING';
  await assert.rejects(
    buildRunAction(cancelling, {
      action: 'ATTEMPT_RESOLVE_UNKNOWN',
      attemptId: 'attempt-unknown-1',
      resolution: 'ABANDONED',
      acceptResidualRisk: true,
    }),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'INVALID_ACTION_INPUT',
  );

  cancelling.attempts[0] = {
    ...cancelling.attempts[0]!,
    canAbandonWithResidualRisk: true,
  };
  await assert.rejects(
    buildRunAction(cancelling, {
      action: 'ATTEMPT_RESOLVE_UNKNOWN',
      attemptId: 'attempt-unknown-1',
      resolution: 'ABANDONED',
    }),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'CONFIRMATION_REQUIRED',
  );

  const built = await buildRunAction(cancelling, {
    action: 'ATTEMPT_RESOLVE_UNKNOWN',
    attemptId: 'attempt-unknown-1',
    resolution: 'ABANDONED',
    acceptResidualRisk: true,
  });
  assert.equal(built.request.acceptResidualRisk, true);
});

test('partial completion uses the server closure token and rejects a changed selection', async () => {
  const expiresAt = Date.now() + 60_000;
  const preview = await previewRunAction(
    snapshot(['PARTIAL']),
    { action: 'PARTIAL', workItemIds: ['research'] },
    async (method, params) => {
      assert.equal(method, 'junqi.collab.run.partial.preview');
      assert.deepEqual(params, { runId: 'run-1', workItemIds: ['research'] });
      return {
        runId: 'run-1',
        runRevision: 7,
        closure: { waiveIds: ['research'], blockedDescendantIds: ['report'], activeIds: [] },
        expiresAt,
        confirmationToken: 'partial-token',
      };
    },
  ) as CollaborationPartialPreview;
  const built = await buildRunAction(snapshot(['PARTIAL']), {
    action: 'PARTIAL',
    workItemIds: ['research'],
    preview,
  });

  assert.equal(built.method, 'junqi.collab.run.partial.accept');
  assert.equal(built.request.expectedRunRevision, 7);
  assert.equal(built.request.confirmationToken, 'partial-token');
  assert.equal(built.request.expiresAt, expiresAt);

  await assert.rejects(
    buildRunAction(snapshot(['PARTIAL']), {
      action: 'PARTIAL',
      workItemIds: ['report'],
      preview,
    }),
    (error: unknown) => error instanceof CollaborationRunActionError && error.code === 'PREVIEW_STALE',
  );
});

test('preview responses fail closed when the run revision or closure shape changed', async () => {
  await assert.rejects(
    previewRunAction(
      snapshot(['PARTIAL']),
      { action: 'PARTIAL', workItemIds: ['research'] },
      async () => ({
        runId: 'run-1',
        runRevision: 8,
        closure: { waiveIds: ['research'], blockedDescendantIds: [], activeIds: [] },
        expiresAt: Date.now() + 60_000,
        confirmationToken: 'newer-revision-token',
      }),
    ),
    (error: unknown) => error instanceof CollaborationRunActionError && error.code === 'PREVIEW_STALE',
  );

  await assert.rejects(
    previewRunAction(
      snapshot(['PARTIAL']),
      { action: 'PARTIAL', workItemIds: ['research'] },
      async () => ({
        runId: 'run-1',
        runRevision: 7,
        closure: { waiveIds: 'research', blockedDescendantIds: [], activeIds: [] },
        expiresAt: Date.now() + 60_000,
        confirmationToken: 'malformed-token',
      }),
    ),
    (error: unknown) => error instanceof CollaborationRunActionError && error.code === 'INVALID_ACTION_RESPONSE',
  );
});

test('UNKNOWN delivery retry reconciles the original delivery identity', async () => {
  const built = await buildRunAction(snapshot(['DELIVERY_RETRY']), {
    action: 'DELIVERY_RETRY',
    deliveryId: 'delivery-1',
  });
  assert.equal('possibleDuplicate' in built.request, false);
  assert.equal(built.request.deliveryId, 'delivery-1');
  assert.equal(built.request.expectedEntityRevision, 5);
});

test('delivery retarget requires the complete durable origin identity', async () => {
  await assert.rejects(
    buildRunAction(snapshot(['DELIVERY_RETARGET']), {
      action: 'DELIVERY_RETARGET',
      deliveryId: 'delivery-1',
      target: {
        runtimeId: 'runtime-2', agentId: 'main', sessionKey: '', sessionId: 'session-2', nativeMessageId: 'message-2',
      },
    }),
    (error: unknown) => error instanceof CollaborationRunActionError && error.code === 'INVALID_ACTION_INPUT',
  );
});

test('delete is a server-previewed two-phase command', async () => {
  const expiresAt = Date.now() + 60_000;
  const preview = await previewRunAction(
    snapshot(['DELETE']),
    { action: 'DELETE', confirmed: false },
    async (method, params) => {
      assert.equal(method, 'junqi.collab.run.delete.preview');
      assert.deepEqual(params, { runId: 'run-1' });
      return {
        runId: 'run-1', runRevision: 7, digest: DELETE_DIGEST, expiresAt, confirmationToken: 'delete-token',
      };
    },
  ) as CollaborationDeletePreview;
  const built = await buildRunAction(snapshot(['DELETE']), {
    action: 'DELETE', preview, confirmed: true,
  });

  assert.equal(built.method, 'junqi.collab.run.delete');
  assert.equal(built.request.confirmationToken, 'delete-token');
  assert.equal(built.request.expectedRunRevision, 7);
  assert.equal('digest' in built.request, false);
  assert.equal('abandonFlowReconciliation' in built.request, false);
  assert.equal('abandonmentReason' in built.request, false);
});

test('delete preview parses a Flow reconciliation blocker and requires audited abandonment', async () => {
  const expiresAt = Date.now() + 60_000;
  const preview = await previewRunAction(
    snapshot(['DELETE']),
    { action: 'DELETE', confirmed: false },
    async () => ({
      runId: 'run-1',
      runRevision: 7,
      digest: DELETE_DIGEST,
      expiresAt,
      confirmationToken: 'blocked-delete-token',
      flowReconciliationBlocker: {
        commandId: 'flow-sync-command-1',
        commandStatus: 'FAILED',
        flowId: 'managed-flow-1',
        flowRevision: 19,
        diagnostic: 'The final Flow status could not be confirmed.',
      },
    }),
  ) as CollaborationDeletePreview;

  assert.deepEqual(preview.flowReconciliationBlocker, {
    commandId: 'flow-sync-command-1',
    commandStatus: 'FAILED',
    flowId: 'managed-flow-1',
    flowRevision: 19,
    diagnostic: 'The final Flow status could not be confirmed.',
  });
  assert.equal(deleteConfirmationReady(preview, { confirmed: true }), false);
  assert.equal(deleteConfirmationReady(preview, {
    confirmed: true,
    abandonFlowReconciliation: true,
    abandonmentReason: '   ',
  }), false);
  assert.equal(deleteConfirmationReady(preview, {
    confirmed: true,
    abandonFlowReconciliation: true,
    abandonmentReason: '  Flow was removed by an operator.  ',
  }), true);

  await assert.rejects(
    buildRunAction(snapshot(['DELETE']), { action: 'DELETE', preview, confirmed: true }),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'CONFIRMATION_REQUIRED',
  );
  await assert.rejects(
    buildRunAction(snapshot(['DELETE']), {
      action: 'DELETE',
      preview,
      confirmed: true,
      abandonFlowReconciliation: true,
      abandonmentReason: '   ',
    }),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'INVALID_ACTION_INPUT',
  );

  const abandonmentReason = '  Flow was removed by an operator.  ';
  const built = await buildRunAction(snapshot(['DELETE']), {
    action: 'DELETE',
    preview,
    confirmed: true,
    abandonFlowReconciliation: true,
    abandonmentReason,
  }, 'delete-with-abandonment');
  assert.equal(built.request.abandonFlowReconciliation, true);
  assert.equal(built.request.abandonmentReason, abandonmentReason);
});

test('delete preview rejects malformed Flow reconciliation blockers', async () => {
  const invalidBlockers: unknown[] = [
    {
      commandId: '', commandStatus: 'FAILED', flowId: null, flowRevision: null, diagnostic: null,
    },
    {
      commandId: 'command-1', commandStatus: 'FAILED', flowId: '', flowRevision: null, diagnostic: null,
    },
    {
      commandId: 'command-1', commandStatus: 'FAILED', flowId: null, flowRevision: 1.5, diagnostic: null,
    },
    {
      commandId: 'command-1', commandStatus: 'FAILED', flowId: null, flowRevision: null,
    },
  ];

  for (const flowReconciliationBlocker of invalidBlockers) {
    await assert.rejects(
      previewRunAction(
        snapshot(['DELETE']),
        { action: 'DELETE', confirmed: false },
        async () => ({
          runId: 'run-1',
          runRevision: 7,
          digest: DELETE_DIGEST,
          expiresAt: Date.now() + 60_000,
          confirmationToken: 'invalid-blocker-token',
          flowReconciliationBlocker,
        }),
      ),
      (error: unknown) => error instanceof CollaborationRunActionError
        && error.code === 'INVALID_ACTION_RESPONSE',
    );
  }
});

test('delete preview preserves explicitly unavailable Flow reconciliation evidence', async () => {
  const preview = await previewRunAction(
    snapshot(['DELETE']),
    { action: 'DELETE', confirmed: false },
    async () => ({
      runId: 'run-1',
      runRevision: 7,
      digest: DELETE_DIGEST,
      expiresAt: Date.now() + 60_000,
      confirmationToken: 'unavailable-flow-evidence-token',
      flowReconciliationBlocker: {
        commandId: 'flow-sync-command-2',
        commandStatus: 'PENDING',
        flowId: null,
        flowRevision: null,
        diagnostic: null,
      },
    }),
  ) as CollaborationDeletePreview;

  assert.deepEqual(preview.flowReconciliationBlocker, {
    commandId: 'flow-sync-command-2',
    commandStatus: 'PENDING',
    flowId: null,
    flowRevision: null,
    diagnostic: null,
  });
});

test('delete rejects Flow abandonment fields when the server reported no blocker', async () => {
  const preview: CollaborationDeletePreview = {
    runId: 'run-1',
    runRevision: 7,
    digest: DELETE_DIGEST,
    expiresAt: Date.now() + 60_000,
    confirmationToken: 'no-blocker-token',
  };
  await assert.rejects(
    buildRunAction(snapshot(['DELETE']), {
      action: 'DELETE',
      preview,
      confirmed: true,
      abandonFlowReconciliation: true,
      abandonmentReason: 'Not authorized by the preview',
    }),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'INVALID_ACTION_INPUT',
  );
});

test('delete completion polls the durable job until it reaches COMPLETED', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let reads = 0;
  const result = await completeCollaborationDeletion(
    {
      collaborationInstanceId: TEST_INSTANCE_ID,
      accepted: true,
      replayed: false,
      commandId: 'delete-command',
      runId: 'run-1',
      deletionJobId: 'delete-job-1',
    },
    'run-1',
    {
      callRpc: async (method, params) => {
        calls.push({ method, params });
        reads += 1;
        return {
          id: 'delete-job-1',
          run_id: 'run-1',
          status: reads === 1 ? 'PENDING' : 'COMPLETED',
          confirmation_digest: DELETE_DIGEST,
          last_error: null,
          created_at: 1,
          updated_at: 2,
        };
      },
      sleep: async () => undefined,
      now: () => 1_000,
    },
  );

  assert.deepEqual(calls, [
    {
      method: 'junqi.collab.run.delete.get',
      params: { jobId: 'delete-job-1', expectedRunId: 'run-1' },
    },
    {
      method: 'junqi.collab.run.delete.get',
      params: { jobId: 'delete-job-1', expectedRunId: 'run-1' },
    },
  ]);
  assert.deepEqual(result, { jobId: 'delete-job-1', status: 'COMPLETED', lastError: null });
});

test('delete completion is bounded and preserves the job identity in timeout errors', async () => {
  let clock = 0;
  await assert.rejects(
    completeCollaborationDeletion(
      {
        collaborationInstanceId: TEST_INSTANCE_ID,
        accepted: true,
        replayed: false,
        commandId: 'delete-command',
        runId: 'run-1',
        deletionJobId: 'delete-job-timeout',
      },
      'run-1',
      {
        callRpc: async () => ({
          id: 'delete-job-timeout',
          run_id: 'run-1',
          status: 'PENDING',
          confirmation_digest: DELETE_DIGEST,
          last_error: null,
          created_at: 1,
          updated_at: 2,
        }),
        sleep: async () => undefined,
        now: () => {
          const current = clock;
          clock += 1_000;
          return current;
        },
        timeoutMs: 1_000,
      },
    ),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'INVALID_ACTION_INPUT'
      && /delete-job-timeout/.test(error.message)
      && /timed out/.test(error.message),
  );
});

test('delete completion rejects receipt and job identities from another run', async () => {
  const baseReceipt = {
    collaborationInstanceId: TEST_INSTANCE_ID,
    accepted: true,
    replayed: false,
    commandId: 'delete-command',
    deletionJobId: 'delete-job-1',
  };
  await assert.rejects(
    completeCollaborationDeletion({ ...baseReceipt, runId: 'run-other' }, 'run-1'),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'INVALID_ACTION_RESPONSE'
      && /receipt/.test(error.message),
  );

  await assert.rejects(
    completeCollaborationDeletion(
      { ...baseReceipt, runId: 'run-1' },
      'run-1',
      {
        callRpc: async () => ({
          id: 'delete-job-1',
          run_id: 'run-other',
          status: 'COMPLETED',
          confirmation_digest: DELETE_DIGEST,
          last_error: null,
          created_at: 1,
          updated_at: 2,
        }),
      },
    ),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'INVALID_ACTION_RESPONSE'
      && /response.runId/.test(error.message),
  );
});

test('delete completion prevents an injected transport from rewriting decoder identity expectations', async () => {
  await assert.rejects(
    completeCollaborationDeletion(
      {
        collaborationInstanceId: TEST_INSTANCE_ID,
        accepted: true,
        replayed: false,
        commandId: 'delete-command',
        runId: 'run-1',
        deletionJobId: 'delete-job-1',
      },
      'run-1',
      {
        callRpc: async (_method, params) => {
          assert.equal(Object.isFrozen(params), true);
          assert.throws(() => {
            params.jobId = 'delete-job-other';
          }, TypeError);
          assert.throws(() => {
            params.expectedRunId = 'run-other';
          }, TypeError);
          return {
            id: 'delete-job-other',
            run_id: 'run-other',
            status: 'COMPLETED',
            confirmation_digest: DELETE_DIGEST,
            last_error: null,
            created_at: 1,
            updated_at: 2,
          };
        },
      },
    ),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'INVALID_ACTION_RESPONSE'
      && /response.id/.test(error.message),
  );
});

test('executeRunAction writes the built method and request without rebuilding in the caller', async () => {
  const writes: Array<{ method: string; request: Record<string, unknown> }> = [];
  const result = await executeRunAction(snapshot(['EXPORT']), { action: 'EXPORT' }, {
    expectedCollaborationInstanceId: TEST_INSTANCE_ID,
    commandId: 'command-export',
    client: {
      async write(method, request) {
        writes.push({ method, request });
        return {
          collaborationInstanceId: TEST_INSTANCE_ID,
          accepted: true,
          replayed: false,
          commandId: request.commandId,
        };
      },
    },
  });

  assert.equal(result.commandId, 'command-export');
  assert.equal(writes[0]?.method, 'junqi.collab.export.create');
  assert.equal(writes[0]?.request.format, 'json');
});

test('export action waits for durable completion and downloads the exact server artifact', async () => {
  const calls: string[] = [];
  const downloads: Array<{ content: string; filename: string }> = [];
  let statusReads = 0;
  const content = '{"run":"run:1"}';
  const digest = createHash('sha256').update(content).digest('hex');
  const result = await completeCollaborationExport(
    {
      collaborationInstanceId: TEST_INSTANCE_ID,
      accepted: true,
      replayed: false,
      commandId: 'export-command',
      runId: 'run:1',
      exportJobId: 'export-1',
    },
    'run:1',
    {
      callRpc: async (method, params) => {
        calls.push(method);
        if (method === 'junqi.collab.export.get') {
          assert.deepEqual(params, { jobId: 'export-1', expectedRunId: 'run:1' });
          statusReads += 1;
          const completed = statusReads > 1;
          return {
            id: 'export-1',
            run_id: 'run:1',
            status: completed ? 'COMPLETED' : 'PENDING',
            format: 'json',
            artifact_path: completed ? 'exports/export-1.json' : null,
            digest: completed ? digest : null,
            last_error: null,
            created_at: 1,
            updated_at: 2,
          };
        }
        assert.deepEqual(params, { jobId: 'export-1', expectedDigest: digest });
        return {
          jobId: 'export-1',
          format: 'json',
          digest,
          content,
        };
      },
      sleep: async () => undefined,
      now: () => 1_000,
      download: (content, filename) => downloads.push({ content, filename }),
    },
  );

  assert.deepEqual(calls, [
    'junqi.collab.export.get',
    'junqi.collab.export.get',
    'junqi.collab.export.download',
  ]);
  assert.deepEqual(downloads, [{
    content: '{"run":"run:1"}',
    filename: 'junqi-collaboration-run_1.json',
  }]);
  assert.equal(result.digest, digest);
});

test('export action surfaces a failed durable job without downloading', async () => {
  await assert.rejects(
    completeCollaborationExport(
      {
        collaborationInstanceId: TEST_INSTANCE_ID,
        accepted: true,
        replayed: false,
        commandId: 'export-command',
        runId: 'run-1',
        exportJobId: 'export-1',
      },
      'run-1',
      {
        callRpc: async () => ({
          id: 'export-1',
          run_id: 'run-1',
          status: 'FAILED',
          format: 'json',
          artifact_path: null,
          digest: null,
          last_error: 'disk full',
          created_at: 1,
          updated_at: 2,
        }),
        download: () => assert.fail('failed export must not download'),
      },
    ),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'INVALID_ACTION_INPUT'
      && /disk full/.test(error.message),
  );
});

test('export action rejects cross-run jobs and content that does not match the completed digest', async () => {
  const receipt = {
    collaborationInstanceId: TEST_INSTANCE_ID,
    accepted: true,
    replayed: false,
    commandId: 'export-command',
    runId: 'run-1',
    exportJobId: 'export-1',
  };
  const expectedContent = '{"run":"run-1"}';
  const expectedDigest = createHash('sha256').update(expectedContent).digest('hex');

  await assert.rejects(
    completeCollaborationExport(receipt, 'run-1', {
      callRpc: async () => ({
        id: 'export-1',
        run_id: 'run-other',
        status: 'COMPLETED',
        format: 'json',
        artifact_path: 'exports/export-1.json',
        digest: expectedDigest,
        last_error: null,
        created_at: 1,
        updated_at: 2,
      }),
      download: () => assert.fail('cross-run export must not download'),
    }),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'INVALID_ACTION_RESPONSE'
      && /response.runId/.test(error.message),
  );

  await assert.rejects(
    completeCollaborationExport(receipt, 'run-1', {
      callRpc: async (method) => method === 'junqi.collab.export.get'
        ? {
            id: 'export-1',
            run_id: 'run-1',
            status: 'COMPLETED',
            format: 'json',
            artifact_path: 'exports/export-1.json',
            digest: expectedDigest,
            last_error: null,
            created_at: 1,
            updated_at: 2,
          }
        : {
            jobId: 'export-1',
            format: 'json',
            digest: expectedDigest,
            content: '{"run":"run-other"}',
          },
      download: () => assert.fail('tampered export must not download'),
    }),
    (error: unknown) => error instanceof CollaborationRunActionError
      && error.code === 'INVALID_ACTION_RESPONSE'
      && /content/.test(error.message),
  );
});
