import assert from 'node:assert/strict';
import test from 'node:test';
import { computePartialClosure } from '../../../packages/junqi-collab/src/domain';
import {
  CollaborationWireError,
  createCollaborationReadBoundary,
  decodeCollaborationReadResponse,
  decodeEventsPage,
  decodeRunGetResponse,
  decodeRunListResponse,
  decodeSessionMutationRunReference,
  decodeWriteResponse,
} from './wire-codec';

const DELETE_DIGEST = 'd'.repeat(64);

const ORIGIN = {
  runtimeId: 'runtime-1',
  agentId: 'main',
  sessionKey: 'agent:main:desktop',
  sessionId: 'session-1',
  nativeMessageId: 'message-1',
};

function runSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'run-1',
    status: 'RUNNING',
    dispatchState: 'OPEN',
    archiveState: 'ACTIVE',
    reconcileState: 'IDLE',
    completionOutcome: null,
    revision: 3,
    lastEventSequence: 7,
    goal: 'Investigate the incident',
    origin: { ...ORIGIN },
    currentPlanRevisionId: null,
    allowedActions: ['RUN_CANCEL'],
    createdAt: 10,
    updatedAt: 20,
    ...overrides,
  };
}

interface MutableRunGetResponse {
  collaborationInstanceId: string;
  snapshotRevision: number;
  snapshot: {
    collaborationInstanceId: string;
    run: Record<string, unknown>;
    lastEventSequence: number;
    planRevisions: unknown[];
    workItems: unknown[];
    attempts: unknown[];
    evidence: unknown[];
    interventions: unknown[];
    deliveries: unknown[];
    decisions: unknown[];
    finalArtifact: unknown;
  };
}

function runGetResponse(): MutableRunGetResponse {
  const run = runSummary();
  delete run.lastEventSequence;
  return {
    collaborationInstanceId: 'instance-1',
    snapshotRevision: 3,
    snapshot: {
      collaborationInstanceId: 'instance-1',
      run,
      lastEventSequence: 7,
      planRevisions: [],
      workItems: [],
      attempts: [],
      evidence: [],
      interventions: [],
      deliveries: [],
      decisions: [],
      finalArtifact: null,
    },
  };
}

function expectWireError(action: () => unknown, path: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof CollaborationWireError);
    assert.equal(error.path, path);
    return true;
  });
}

test('run decoder rejects unknown states, invalid revisions, and missing identity fields', () => {
  const cases: Array<{ path: string; mutate(value: ReturnType<typeof runGetResponse>): void }> = [
    {
      path: 'response.snapshot.run.status',
      mutate: (value) => { value.snapshot.run.status = 'MAGIC'; },
    },
    {
      path: 'response.snapshot.run.revision',
      mutate: (value) => { value.snapshot.run.revision = 1.5; },
    },
    {
      path: 'response.snapshot.run.origin.sessionId',
      mutate: (value) => { delete (value.snapshot.run.origin as Record<string, unknown>).sessionId; },
    },
    {
      path: 'response.snapshot.run.id',
      mutate: (value) => { value.snapshot.run.id = 'another-run'; },
    },
  ];
  for (const item of cases) {
    const response = runGetResponse();
    item.mutate(response);
    expectWireError(() => decodeRunGetResponse(response, 'run-1'), item.path);
  }
});

test('attempt abandon eligibility is backward-compatible and strictly typed when present', () => {
  const response = runGetResponse();
  const attempt: Record<string, unknown> = {
    id: 'attempt-unknown-1',
    runId: 'run-1',
    workItemId: null,
    kind: 'PLANNER',
    attemptNo: 1,
    status: 'UNKNOWN',
    workerAgentId: 'coordinator',
    executionTaskId: null,
    agentRunId: null,
    idempotencyKey: 'collab:run-1:planner:1',
    workerOwnerSessionKey: 'agent:coordinator:main',
    workerSessionKey: 'agent:coordinator:subagent:attempt-unknown-1',
    revision: 1,
    startedAt: null,
    endedAt: null,
    lastError: null,
    createdAt: 10,
    updatedAt: 10,
  };
  response.snapshot.attempts = [attempt];

  const legacyDecoded = decodeRunGetResponse(response, 'run-1').snapshot.attempts[0];
  assert.equal(legacyDecoded?.canAbandonWithResidualRisk, false);
  assert.equal(legacyDecoded?.executionRuntime, 'native');

  attempt.executionRuntime = 'acp';
  assert.equal(
    decodeRunGetResponse(response, 'run-1').snapshot.attempts[0]?.executionRuntime,
    'acp',
  );
  attempt.executionRuntime = 'remote';
  expectWireError(
    () => decodeRunGetResponse(response, 'run-1'),
    'snapshot.attempts[0].executionRuntime',
  );
  attempt.executionRuntime = 'acp';

  attempt.canAbandonWithResidualRisk = true;
  assert.equal(
    decodeRunGetResponse(response, 'run-1').snapshot.attempts[0]?.canAbandonWithResidualRisk,
    true,
  );

  attempt.canAbandonWithResidualRisk = 'true';
  expectWireError(
    () => decodeRunGetResponse(response, 'run-1'),
    'snapshot.attempts[0].canAbandonWithResidualRisk',
  );
});

test('run decoder rejects duplicate entity ids and delivery target revisions', () => {
  const duplicateWork = runGetResponse();
  duplicateWork.snapshot.run.currentPlanRevisionId = 'plan-1';
  duplicateWork.snapshot.planRevisions = [{ id: 'plan-1', runId: 'run-1', revisionNo: 1 }];
  const workItem = {
    id: 'work-1',
    runId: 'run-1',
    logicalId: 'scope',
    planRevisionId: 'plan-1',
    title: 'Find scope',
    status: 'READY',
    assignedAgentId: null,
    inputScope: ['origin'],
    dependencies: [],
    requiredCapabilities: ['analysis'],
    candidateAgentIds: ['worker'],
    acceptanceCriteria: ['Scope is explicit'],
    revision: 1,
    riskLevel: 'LOW',
    sideEffectClass: 'READ_ONLY',
    createdAt: 10,
    updatedAt: 10,
  };
  duplicateWork.snapshot.workItems = [workItem, { ...workItem }];
  expectWireError(
    () => decodeRunGetResponse(duplicateWork, 'run-1'),
    'response.snapshot.workItems',
  );

  const duplicateTargetRevision = runGetResponse();
  const delivery = {
    id: 'delivery-1',
    runId: 'run-1',
    finalArtifactId: 'artifact-1',
    targetRevision: 1,
    status: 'PREPARED',
    transcriptStatus: 'PENDING',
    channelStatus: 'NOT_REQUIRED',
    requirement: 'TRANSCRIPT',
    revision: 1,
    target: ORIGIN,
    messageId: null,
    createdAt: 20,
    updatedAt: 20,
  };
  duplicateTargetRevision.snapshot.deliveries = [delivery, { ...delivery, id: 'delivery-2' }];
  expectWireError(
    () => decodeRunGetResponse(duplicateTargetRevision, 'run-1'),
    'response.snapshot.deliveries.targetRevision',
  );
});

test('run list decoder validates per-run watermarks and session identity', () => {
  const response = {
    collaborationInstanceId: 'instance-1',
    sessionKey: ORIGIN.sessionKey,
    sessionId: ORIGIN.sessionId,
    runs: [runSummary()],
    snapshotRevision: 3,
    lastSequence: 7,
  };
  const decoded = decodeRunListResponse(response, {
    paginated: false,
    expectedSession: { sessionKey: ORIGIN.sessionKey, sessionId: ORIGIN.sessionId },
  });
  assert.equal(decoded.runs[0]?.lastEventSequence, 7);

  const staleWatermark = structuredClone(response);
  staleWatermark.lastSequence = 6;
  expectWireError(
    () => decodeRunListResponse(staleWatermark, {
      paginated: false,
      expectedSession: { sessionKey: ORIGIN.sessionKey, sessionId: ORIGIN.sessionId },
    }),
    'response.lastSequence',
  );
});

test('event decoder rejects cross-run and non-monotonic event streams', () => {
  const response = {
    collaborationInstanceId: 'instance-1',
    runId: 'run-1',
    events: [
      { sequence: 5, runId: 'run-1', eventType: 'A', runRevision: 2, payload: {}, createdAt: 10 },
      { sequence: 6, runId: 'run-1', eventType: 'B', runRevision: 3, payload: {}, createdAt: 11 },
    ],
    nextSequence: 6,
    lastSequence: 7,
    hasMore: true,
    snapshotRevision: 3,
    cursorInvalid: false,
  };
  assert.equal(decodeEventsPage(response, { runId: 'run-1', afterSequence: 4 }).events.length, 2);

  const crossRun = structuredClone(response);
  crossRun.events[1]!.runId = 'run-2';
  expectWireError(
    () => decodeEventsPage(crossRun, { runId: 'run-1', afterSequence: 4 }),
    'response.events[1].runId',
  );

  const outOfOrder = structuredClone(response);
  outOfOrder.events[1]!.sequence = 5;
  expectWireError(
    () => decodeEventsPage(outOfOrder, { runId: 'run-1', afterSequence: 4 }),
    'response.events[1].sequence',
  );
});

test('write decoder binds success to the exact command and validated revisions', () => {
  assert.deepEqual(
    decodeWriteResponse({
      collaborationInstanceId: 'instance-1',
      accepted: true,
      replayed: false,
      commandId: 'command-1',
      newRunRevision: 4,
      newEntityRevision: 2,
    }, 'command-1', 'instance-1'),
    {
      collaborationInstanceId: 'instance-1',
      accepted: true,
      replayed: false,
      commandId: 'command-1',
      newRunRevision: 4,
      newEntityRevision: 2,
    },
  );

  expectWireError(
    () => decodeWriteResponse(
      { accepted: false, replayed: false, commandId: 'command-1' },
      'command-1',
      'instance-1',
    ),
    'response.accepted',
  );
  expectWireError(
    () => decodeWriteResponse(
      { accepted: true, replayed: false, commandId: 'command-2' },
      'command-1',
      'instance-1',
    ),
    'response.commandId',
  );
  expectWireError(
    () => decodeWriteResponse({
      collaborationInstanceId: 'instance-1',
      accepted: true,
      replayed: false,
      commandId: 'command-1',
      newEntityRevision: -1,
    }, 'command-1', 'instance-1'),
    'response.newEntityRevision',
  );
  expectWireError(
    () => decodeWriteResponse({
      collaborationInstanceId: 'instance-2',
      accepted: true,
      replayed: false,
      commandId: 'command-1',
    }, 'command-1', 'instance-1'),
    'response.collaborationInstanceId',
  );
});

test('operational read decoder normalizes job aliases and rejects conflicts, drift, and wrong identity', () => {
  const deletionJob = {
    id: 'delete-job-1',
    run_id: 'run-1',
    status: 'PARTIAL',
    confirmation_digest: DELETE_DIGEST,
    last_error: 'cleanup pending',
    created_at: 10,
    updated_at: 20,
  };
  assert.deepEqual(
    decodeCollaborationReadResponse(
      'junqi.collab.run.delete.get',
      deletionJob,
      { jobId: 'delete-job-1', expectedRunId: 'run-1' },
    ),
    {
      id: 'delete-job-1',
      runId: 'run-1',
      status: 'PARTIAL',
      confirmationDigest: DELETE_DIGEST,
      lastError: 'cleanup pending',
      createdAt: 10,
      updatedAt: 20,
    },
  );

  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.run.delete.get',
      { ...deletionJob, runId: 'run-other' },
      { jobId: 'delete-job-1', expectedRunId: 'run-1' },
    ),
    'response.runId',
  );
  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.run.delete.get',
      { ...deletionJob, id: 'delete-job-other' },
      { jobId: 'delete-job-1', expectedRunId: 'run-1' },
    ),
    'response.id',
  );
  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.run.delete.get',
      { ...deletionJob, updated_at: 9 },
      { jobId: 'delete-job-1', expectedRunId: 'run-1' },
    ),
    'response.updatedAt',
  );
});

test('operational read boundary creates independent deeply frozen transport and expectation snapshots', () => {
  const input = { runId: 'run-1', workItemIds: ['research'] };
  const boundary = createCollaborationReadBoundary<'junqi.collab.run.partial.preview'>(input);

  assert.notEqual(boundary.transportParams, input);
  assert.notEqual(boundary.expectation, input);
  assert.notEqual(boundary.transportParams, boundary.expectation);
  assert.notEqual(boundary.transportParams.workItemIds, boundary.expectation.workItemIds);
  assert.equal(Object.isFrozen(boundary.transportParams), true);
  assert.equal(Object.isFrozen(boundary.transportParams.workItemIds), true);
  assert.equal(Object.isFrozen(boundary.expectation), true);
  assert.equal(Object.isFrozen(boundary.expectation.workItemIds), true);

  input.runId = 'run-other';
  input.workItemIds[0] = 'different';
  assert.deepEqual(boundary.transportParams, { runId: 'run-1', workItemIds: ['research'] });
  assert.deepEqual(boundary.expectation, { runId: 'run-1', workItemIds: ['research'] });
  assert.throws(() => {
    boundary.transportParams.workItemIds[0] = 'mutated';
  }, TypeError);
});

test('preview decoder binds run identity and validates closure classification and nullable blocker evidence', () => {
  const partial = {
    runId: 'run-1',
    runRevision: 7,
    closure: {
      waiveIds: ['research'],
      blockedDescendantIds: ['report'],
      activeIds: [],
    },
    expiresAt: 100,
    confirmationToken: 'partial-token',
  };
  assert.deepEqual(
    decodeCollaborationReadResponse(
      'junqi.collab.run.partial.preview',
      partial,
      { runId: 'run-1', workItemIds: ['research'] },
    ).closure.waiveIds,
    ['research'],
  );

  assert.deepEqual(
    decodeCollaborationReadResponse(
      'junqi.collab.run.partial.preview',
      {
        ...partial,
        closure: { ...partial.closure, activeIds: ['research'] },
      },
      { runId: 'run-1', workItemIds: ['research'] },
    ).closure.activeIds,
    ['research'],
  );
  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.run.partial.preview',
      {
        ...partial,
        closure: { ...partial.closure, blockedDescendantIds: ['research'] },
      },
      { runId: 'run-1', workItemIds: ['research'] },
    ),
    'response.closure',
  );
  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.run.partial.preview',
      {
        ...partial,
        closure: { ...partial.closure, activeIds: ['unrelated'] },
      },
      { runId: 'run-1', workItemIds: ['research'] },
    ),
    'response.closure.activeIds[0]',
  );
  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.run.partial.preview',
      {
        ...partial,
        closure: { ...partial.closure, waiveIds: ['different'] },
      },
      { runId: 'run-1', workItemIds: ['research'] },
    ),
    'response.closure.waiveIds',
  );
  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.run.delete.preview',
      {
        runId: 'run-1',
        runRevision: 7,
        digest: DELETE_DIGEST,
        expiresAt: 100,
        confirmationToken: 'delete-token',
        flowReconciliationBlocker: {
          commandId: 'command-1',
          commandStatus: 'FAILED',
          flowId: null,
          flowRevision: null,
        },
      },
      { runId: 'run-1' },
    ),
    'response.flowReconciliationBlocker.diagnostic',
  );
});

test('partial preview decoder accepts the closure produced by the collaboration domain', () => {
  const closure = computePartialClosure(
    [
      { id: 'research', dependencies: [], status: 'NEEDS_INTERVENTION', activeAttempt: true },
      { id: 'report', dependencies: ['research'], status: 'BLOCKED' },
      { id: 'unrelated', dependencies: [], status: 'SUCCEEDED' },
    ],
    ['research'],
  );
  assert.deepEqual(closure, {
    waiveIds: ['research'],
    blockedDescendantIds: ['report'],
    activeIds: ['research'],
  });

  const decoded = decodeCollaborationReadResponse(
    'junqi.collab.run.partial.preview',
    {
      runId: 'run-domain-contract',
      runRevision: 11,
      closure,
      expiresAt: 100,
      confirmationToken: 'partial-domain-token',
    },
    { runId: 'run-domain-contract', workItemIds: ['research'] },
  );
  assert.deepEqual(decoded.closure, closure);
});

test('export decoders require completed job evidence and bind valid JSON artifacts to the job', () => {
  const exportDigest = 'a'.repeat(64);
  const completedJob = {
    id: 'export-job-1',
    run_id: 'run-1',
    status: 'COMPLETED',
    format: 'json',
    artifact_path: 'exports/export-job-1.json',
    digest: exportDigest,
    last_error: null,
    created_at: 10,
    updated_at: 20,
  };
  assert.equal(
    decodeCollaborationReadResponse(
      'junqi.collab.export.get',
      completedJob,
      { jobId: 'export-job-1', expectedRunId: 'run-1' },
    ).artifactPath,
    'exports/export-job-1.json',
  );
  assert.equal(
    decodeCollaborationReadResponse(
      'junqi.collab.export.download',
      { jobId: 'export-job-1', format: 'json', digest: exportDigest, content: '{"runId":"run-1"}' },
      { jobId: 'export-job-1', expectedDigest: exportDigest },
    ).content,
    '{"runId":"run-1"}',
  );

  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.export.get',
      { ...completedJob, digest: null },
      { jobId: 'export-job-1', expectedRunId: 'run-1' },
    ),
    'response.status',
  );
  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.export.download',
      { jobId: 'export-job-1', format: 'json', digest: exportDigest, content: 'not-json' },
      { jobId: 'export-job-1', expectedDigest: exportDigest },
    ),
    'response.content',
  );

  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.export.get',
      {
        ...completedJob,
        status: 'PENDING',
        last_error: 'contradictory pending error',
      },
      { jobId: 'export-job-1', expectedRunId: 'run-1' },
    ),
    'response.status',
  );
  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.export.get',
      {
        ...completedJob,
        status: 'FAILED',
        artifact_path: null,
        digest: null,
        last_error: null,
      },
      { jobId: 'export-job-1', expectedRunId: 'run-1' },
    ),
    'response.lastError',
  );
});

test('deletion job decoder requires SHA-256 evidence and status-consistent diagnostics', () => {
  const completed = {
    id: 'delete-job-1',
    run_id: 'run-1',
    status: 'COMPLETED',
    confirmation_digest: DELETE_DIGEST,
    last_error: null,
    created_at: 1,
    updated_at: 2,
  };

  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.run.delete.get',
      { ...completed, confirmation_digest: 'not-a-digest' },
      { jobId: 'delete-job-1', expectedRunId: 'run-1' },
    ),
    'response.confirmationDigest',
  );
  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.run.delete.get',
      { ...completed, last_error: 'cleanup still failed' },
      { jobId: 'delete-job-1', expectedRunId: 'run-1' },
    ),
    'response.lastError',
  );
  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.run.delete.get',
      { ...completed, status: 'PARTIAL', last_error: null },
      { jobId: 'delete-job-1', expectedRunId: 'run-1' },
    ),
    'response.lastError',
  );
});

test('session mutation decoder validates identity, enums, fences, and authoritative booleans', () => {
  const expected = {
    runtimeId: ORIGIN.runtimeId,
    sessionKey: ORIGIN.sessionKey,
    sessionId: ORIGIN.sessionId,
    action: 'delete' as const,
  };
  const response = {
    ...expected,
    activeRuns: [],
    blocked: false,
    runtimeMatches: true,
    activeMutation: null,
    mutationFenceActive: false,
    recoveryRequired: false,
    coreRpcAllowed: false,
    resetCasSupported: false,
    strategies: ['PROCEED'],
  };
  assert.deepEqual(
    decodeCollaborationReadResponse('junqi.collab.session.mutationImpact', response, expected).strategies,
    ['PROCEED'],
  );

  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.session.mutationImpact',
      { ...response, sessionId: 'session-other' },
      expected,
    ),
    'response.sessionId',
  );
  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.session.mutationImpact',
      { ...response, coreRpcAllowed: true },
      expected,
    ),
    'response.coreRpcAllowed',
  );
  expectWireError(
    () => decodeCollaborationReadResponse(
      'junqi.collab.session.mutationImpact',
      { ...response, strategies: ['MAGIC'] },
      expected,
    ),
    'response.strategies[0]',
  );
});

test('session mutation prepare decoder accepts only the documented slim active-run projection', () => {
  const decoded = decodeSessionMutationRunReference({
    runId: 'run-1',
    status: 'RUNNING',
    dispatchState: 'OPEN',
    archiveState: 'ACTIVE',
    reconcileState: 'IDLE',
    completionOutcome: null,
    revision: 4,
    origin: { ...ORIGIN },
    currentPlanRevisionId: null,
    createdAt: 10,
    updatedAt: 20,
  }, 0);
  assert.equal(decoded.runId, 'run-1');
  assert.equal('goal' in decoded, false);
  assert.equal('allowedActions' in decoded, false);
  assert.equal('lastEventSequence' in decoded, false);

  expectWireError(
    () => decodeSessionMutationRunReference({
      runId: 'run-1', status: 'RUNNING', dispatchState: 'OPEN', archiveState: 'ACTIVE',
      reconcileState: 'IDLE', completionOutcome: null, revision: 4.5,
      origin: { ...ORIGIN }, currentPlanRevisionId: null, createdAt: 10, updatedAt: 20,
    }, 0),
    'response.activeRuns[0].revision',
  );
});
