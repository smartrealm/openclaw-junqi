import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  CollaborationClient,
  CollaborationClientError,
  createCollaborationWriteRequest,
  isCollaborationMethodUnavailable,
} from './client';
import {
  COLLABORATION_PLUGIN_BUNDLE,
  type CollaborationPluginBundleMetadata,
} from './bundledPlugin';

const DELETE_DIGEST = 'd'.repeat(64);

test('normalizes OpenClaw INVALID_REQUEST unknown-method responses to a typed absence code', async () => {
  const client = new CollaborationClient(async () => {
    throw {
      code: 'INVALID_REQUEST',
      type: 'gateway_request_error',
      message: 'unknown method: junqi.collab.capabilities',
    };
  });
  await assert.rejects(
    client.capabilities(),
    (error: unknown) => error instanceof CollaborationClientError
      && error.code === 'METHOD_NOT_FOUND'
      && error.method === 'junqi.collab.capabilities',
  );
  assert.equal(isCollaborationMethodUnavailable({
    code: 'INVALID_REQUEST',
    message: 'unknown method: sessions.reset',
  }), false);
});

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

function validCapabilities(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    collaborationInstanceId: 'instance-1',
    pluginId: 'junqi-collab',
    pluginVersion: COLLABORATION_PLUGIN_BUNDLE.pluginVersion,
    schemaVersion: COLLABORATION_PLUGIN_BUNDLE.schemaVersion,
    runtimeVersion: '2026.7.1',
    databaseIntegrity: 'ok',
    configured: true,
    durableState: true,
    durableRuntime: { supported: true, required: true, reason: null },
    trustTier: 'portable-core',
    workboard: { supported: false, reason: 'not available' },
    sessionCapabilities: { deleteExpectedSessionId: true, resetExpectedSessionId: false },
    features: [
      'SQLITE_AUTHORITY', 'COMMAND_OUTBOX', 'TASK_RECONCILE',
      'EXACT_TRANSCRIPT_DELIVERY', 'EXACT_TRANSCRIPT_IDENTITY',
      'PLUGIN_SUBAGENT_TASK_LOOKUP', 'PLUGIN_SUBAGENT_TASK_CANCEL',
      'EVENT_CURSOR', 'SESSION_DELETE_CAS', 'WRITE_INSTANCE_FENCE', 'WORKFLOW_TEMPLATES',
    ],
    featureFlags: {
      sqliteAuthority: true,
      commandOutbox: true,
      taskReconcile: true,
      exactTranscriptDelivery: true,
      eventCursor: true,
      sessionDeleteCas: true,
      writeInstanceFence: true,
      workflowTemplates: true,
      sessionResetCas: false,
      workboardMirror: false,
    },
    featureEvidence: {
      kind: 'DECLARED_PLUGIN_CONTRACT',
      behaviorVerified: false,
      structuralChecks: { pluginServiceStarted: true, databaseIntegrity: 'ok', configured: true },
      requiredBehaviorGate: 'ISOLATED_REAL_GATEWAY',
    },
    configuredAgents: [
      { id: 'coordinator', runtimeType: 'native', allowed: true, coordinator: true },
      { id: 'worker', runtimeType: 'native', allowed: true, coordinator: false },
    ],
    coordinatorAgentId: 'coordinator',
    allowedAgentIds: ['coordinator', 'worker'],
    repairs: [],
    maintenance: {
      active: false,
      lease: null,
      activeRuns: [],
      activeRunCount: 0,
      activeRunsTruncated: false,
    },
    ...overrides,
  };
}

test('read methods use the exact collaboration RPC namespace and session identity', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new CollaborationClient(async (method, params = {}) => {
    calls.push({ method, params });
    if (method === 'junqi.collab.capabilities') {
      return validCapabilities();
    }
    if (method === 'junqi.collab.run.listBySession') {
      return {
        collaborationInstanceId: 'instance-1',
        sessionKey: 'agent:main:desktop',
        sessionId: 'native-session-1',
        runs: [],
        snapshotRevision: 0,
        lastSequence: 0,
      };
    }
    if (method === 'junqi.collab.run.get') {
      return {
        collaborationInstanceId: 'instance-1',
        snapshotRevision: 1,
        snapshot: {
          collaborationInstanceId: 'instance-1',
          run: {
            id: 'run-1', status: 'RUNNING', dispatchState: 'OPEN', archiveState: 'ACTIVE',
            reconcileState: 'IDLE', completionOutcome: null, revision: 1,
            goal: 'test', currentPlanRevisionId: null, allowedActions: [],
            origin: {
              runtimeId: 'runtime-1', agentId: 'main', sessionKey: 'agent:main:desktop',
              sessionId: 'native-session-1', nativeMessageId: 'message-1',
            },
            createdAt: 1, updatedAt: 1,
          },
          lastEventSequence: 0,
          planRevisions: [], workItems: [], attempts: [], evidence: [],
          interventions: [], deliveries: [], decisions: [], finalArtifact: null,
        },
      };
    }
    return {
      collaborationInstanceId: 'instance-1',
      runId: 'run-1',
      events: [],
      nextSequence: 4,
      lastSequence: 7,
      hasMore: false,
      snapshotRevision: 3,
    };
  });

  await client.capabilities();
  await client.listRunsBySession({ sessionKey: 'agent:main:desktop', sessionId: 'native-session-1' });
  await client.getRun('run-1');
  await client.listEvents({ runId: 'run-1', afterSequence: 4, limit: 50 });

  assert.deepEqual(calls, [
    { method: 'junqi.collab.capabilities', params: {} },
    {
      method: 'junqi.collab.run.listBySession',
      params: { sessionKey: 'agent:main:desktop', sessionId: 'native-session-1' },
    },
    { method: 'junqi.collab.run.get', params: { runId: 'run-1' } },
    { method: 'junqi.collab.events.list', params: { runId: 'run-1', afterSequence: 4, limit: 50 } },
  ]);
});

test('operational read facade dispatches exact methods and applies the shared contract decoder', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new CollaborationClient(async (method, params = {}) => {
    calls.push({ method, params });
    switch (method) {
      case 'junqi.collab.workflow.template.list':
        return {
          collaborationInstanceId: 'instance-1',
          templates: [{
            id: 'template-1', name: 'Launch assessment', status: 'PUBLISHED', sourceRunId: 'run-source',
            createdBy: 'operator', createdAt: 1, updatedAt: 2,
            currentVersion: {
              id: 'template-version-1', templateId: 'template-1', versionNo: 1,
              digest: 'a'.repeat(64), sourceRunId: 'run-source', sourcePlanRevisionId: 'plan-source',
              createdBy: 'operator', createdAt: 1,
              definition: {
                schemaVersion: 1, goal: 'Assess the launch',
                workItems: [{ id: 'research', title: 'Research', dependencies: [] }],
                synthesis: { requiredEvidence: [], finalAnswerContract: 'Recommendation' },
              },
            },
          }],
        };
      case 'junqi.collab.run.partial.preview':
        return {
          runId: 'run-1', runRevision: 7,
          closure: { waiveIds: ['research'], blockedDescendantIds: [], activeIds: [] },
          expiresAt: 100, confirmationToken: 'partial-token',
        };
      case 'junqi.collab.run.delete.preview':
        return {
          runId: 'run-1', runRevision: 7, digest: DELETE_DIGEST,
          expiresAt: 100, confirmationToken: 'delete-token',
        };
      case 'junqi.collab.run.delete.get':
        return {
          id: 'delete-job-1', run_id: 'run-1', status: 'COMPLETED',
          confirmation_digest: DELETE_DIGEST, last_error: null, created_at: 1, updated_at: 2,
        };
      case 'junqi.collab.export.get':
        return {
          id: 'export-job-1', run_id: 'run-1', status: 'COMPLETED', format: 'json',
          artifact_path: 'exports/export-job-1.json', digest: 'a'.repeat(64), last_error: null,
          created_at: 1, updated_at: 2,
        };
      case 'junqi.collab.export.download':
        return {
          jobId: 'export-job-1', format: 'json', digest: 'a'.repeat(64), content: '{"runId":"run-1"}',
        };
      case 'junqi.collab.session.mutationImpact':
        return {
          runtimeId: 'runtime-1', sessionKey: 'agent:main:desktop', sessionId: 'session-1',
          action: 'delete', activeRuns: [], blocked: false, runtimeMatches: true,
          activeMutation: null, mutationFenceActive: false, recoveryRequired: false,
          coreRpcAllowed: false, resetCasSupported: false, strategies: ['PROCEED'],
        };
      default:
        throw new Error(`Unexpected method ${method}`);
    }
  });

  assert.equal((await client.listWorkflowTemplates()).templates[0]?.id, 'template-1');
  await client.previewPartialRun({ runId: 'run-1', workItemIds: ['research'] });
  await client.previewRunDeletion({ runId: 'run-1' });
  assert.equal((await client.getRunDeletionJob({
    jobId: 'delete-job-1',
    expectedRunId: 'run-1',
  })).runId, 'run-1');
  assert.equal((await client.getExportJob({
    jobId: 'export-job-1',
    expectedRunId: 'run-1',
  })).artifactPath, 'exports/export-job-1.json');
  await client.downloadExport({ jobId: 'export-job-1', expectedDigest: 'a'.repeat(64) });
  await client.getSessionMutationImpact({
    runtimeId: 'runtime-1', sessionKey: 'agent:main:desktop', sessionId: 'session-1', action: 'delete',
  });

  assert.deepEqual(calls.map(({ method }) => method), [
    'junqi.collab.workflow.template.list',
    'junqi.collab.run.partial.preview',
    'junqi.collab.run.delete.preview',
    'junqi.collab.run.delete.get',
    'junqi.collab.export.get',
    'junqi.collab.export.download',
    'junqi.collab.session.mutationImpact',
  ]);

  const invalid = new CollaborationClient(async () => ({
    id: 'delete-job-other', run_id: 'run-1', status: 'COMPLETED',
    confirmation_digest: DELETE_DIGEST, last_error: null, created_at: 1, updated_at: 2,
  }));
  await assert.rejects(
    invalid.getRunDeletionJob({ jobId: 'delete-job-1', expectedRunId: 'run-1' }),
    (error: unknown) => error instanceof CollaborationClientError
      && error.code === 'INVALID_RESPONSE'
      && error.details?.path === 'response.id',
  );
});

test('operational read facade isolates immutable decoder expectations from transport mutation', async () => {
  const input = { jobId: 'delete-job-1', expectedRunId: 'run-1' };
  let observedTransport: Record<string, unknown> | undefined;
  const client = new CollaborationClient(async (_method, params = {}) => {
    observedTransport = params;
    assert.notEqual(params, input);
    assert.equal(Object.isFrozen(params), true);

    input.jobId = 'caller-mutated-job';
    input.expectedRunId = 'caller-mutated-run';
    assert.throws(() => {
      params.jobId = 'transport-mutated-job';
    }, TypeError);
    assert.throws(() => {
      params.expectedRunId = 'transport-mutated-run';
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
  });

  await assert.rejects(
    client.getRunDeletionJob(input),
    (error: unknown) => error instanceof CollaborationClientError
      && error.code === 'INVALID_RESPONSE'
      && error.details?.path === 'response.id',
  );
  assert.deepEqual(observedTransport, { jobId: 'delete-job-1', expectedRunId: 'run-1' });
});

test('run list preserves the opaque next cursor and rejects an invalid cursor response', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new CollaborationClient(async (method, params = {}) => {
    calls.push({ method, params });
    return {
      collaborationInstanceId: 'instance-history',
      runs: [{
        id: 'run-history',
        status: 'COMPLETED',
        dispatchState: 'CLOSED',
        archiveState: 'ACTIVE',
        reconcileState: 'IDLE',
        completionOutcome: 'FULL',
        revision: 2,
        lastEventSequence: 5,
        goal: 'Historical run',
        origin: {
          runtimeId: 'runtime-1', agentId: 'main', sessionKey: 'agent:main:desktop',
          sessionId: 'session-1', nativeMessageId: 'message-1',
        },
        currentPlanRevisionId: 'plan-1',
        allowedActions: [],
        createdAt: 1,
        updatedAt: 2,
      }],
      nextCursor: 'opaque_cursor_2',
      snapshotRevision: 2,
      lastSequence: 5,
    };
  });

  const page = await client.listRuns({ includeArchived: true, limit: 500, cursor: 'opaque_cursor_1' });
  assert.equal(page.nextCursor, 'opaque_cursor_2');
  assert.deepEqual(calls, [{
    method: 'junqi.collab.run.list',
    params: { includeArchived: true, limit: 500, cursor: 'opaque_cursor_1' },
  }]);

  for (const nextCursor of [42, 'not+a-valid-cursor', 'a'.repeat(513)]) {
    const invalid = new CollaborationClient(async () => ({
      collaborationInstanceId: 'instance-history',
      runs: [],
      nextCursor,
      snapshotRevision: 0,
      lastSequence: 0,
    }));
    await assert.rejects(
      invalid.listRuns(),
      (error: unknown) => error instanceof CollaborationClientError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('write request hash matches the plugin canonical payload contract', async () => {
  const request = await createCollaborationWriteRequest(
    { runId: 'run-1', reason: 'user-requested' },
    {
      expectedCollaborationInstanceId: 'instance-1',
      expectedRunRevision: 3,
      currentPlanRevisionId: 'plan-2',
    },
    'command-1',
  );
  const { commandId: _commandId, payloadHash, ...payload } = request;
  const expected = createHash('sha256').update(stableStringify(payload)).digest('hex');

  assert.equal(request.commandId, 'command-1');
  assert.equal(request.expectedCollaborationInstanceId, 'instance-1');
  assert.equal(payloadHash, expected);
});

test('write response must be bound to the submitted collaboration instance', async () => {
  const client = new CollaborationClient(async () => ({
    collaborationInstanceId: 'instance-replacement',
    accepted: true,
    replayed: false,
    commandId: 'command-instance-fence',
  }));
  const request = await createCollaborationWriteRequest(
    { runId: 'run-1' },
    { expectedCollaborationInstanceId: 'instance-original', expectedRunRevision: 1 },
    'command-instance-fence',
  );

  await assert.rejects(
    client.write('junqi.collab.run.cancel', request),
    (error: unknown) => error instanceof CollaborationClientError
      && error.code === 'INVALID_RESPONSE'
      && error.details?.path === 'response.collaborationInstanceId',
  );
});

test('production write contract blocks an incompatible plugin before sending a command', async () => {
  const contract: CollaborationPluginBundleMetadata = {
    ...COLLABORATION_PLUGIN_BUNDLE,
  };
  let writes = 0;
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return validCapabilities({ schemaVersion: contract.schemaVersion - 1 });
    }
    writes += 1;
    return { accepted: true, replayed: false, commandId: 'command-incompatible' };
  }, contract);
  const request = await createCollaborationWriteRequest(
    { runId: 'run-1' },
    { expectedCollaborationInstanceId: 'instance-1', expectedRunRevision: 1 },
    'command-incompatible',
  );

  await assert.rejects(
    client.write('junqi.collab.run.cancel', request),
    (error: unknown) => error instanceof CollaborationClientError
      && error.code === 'VERSION_INCOMPATIBLE'
      && error.details?.contractCode === 'SCHEMA_VERSION',
  );
  assert.equal(writes, 0);
});

test('structured collaboration errors preserve stable server error codes', async () => {
  for (const serverError of [
    { code: 'REVISION_CONFLICT', message: 'stale run', details: { currentRevision: 8 } },
    { code: 'RUNTIME_TIMEOUT', message: 'runtime call exceeded its deadline', details: { operation: 'task.wait' } },
  ]) {
    const client = new CollaborationClient(async () => {
      throw serverError;
    });

    await assert.rejects(
      client.getRun('run-1'),
      (error: unknown) => {
        assert.ok(error instanceof CollaborationClientError);
        assert.equal(error.code, serverError.code);
        assert.deepEqual(error.details, serverError.details);
        return true;
      },
    );
  }
});

test('capabilities reject non-positive and fractional schema versions', async () => {
  for (const schemaVersion of [0, -1, 1.5]) {
    const client = new CollaborationClient(async () => ({
      ...validCapabilities(),
      schemaVersion,
    }));
    await assert.rejects(
      client.capabilities(),
      (error: unknown) => error instanceof CollaborationClientError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('capabilities reject inconsistent agent policy and feature evidence', async () => {
  const malformed = [
    validCapabilities({ allowedAgentIds: ['worker'] }),
    validCapabilities({ configured: false }),
    validCapabilities({
      featureEvidence: {
        kind: 'SELF_REPORTED_TEST',
        behaviorVerified: true,
        structuralChecks: {},
        requiredBehaviorGate: 'NONE',
      },
    }),
  ];
  for (const response of malformed) {
    const client = new CollaborationClient(async () => response);
    await assert.rejects(
      client.capabilities(),
      (error: unknown) => error instanceof CollaborationClientError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('capacity errors are not downgraded to generic RPC failures', async () => {
  const client = new CollaborationClient(async () => {
    throw { code: 'CAPACITY_EXCEEDED', message: 'export exceeds its bounded contract' };
  });

  await assert.rejects(
    client.listTombstones(),
    (error: unknown) => error instanceof CollaborationClientError && error.code === 'CAPACITY_EXCEEDED',
  );
});

test('Flow reconciliation deletion blockers are not downgraded to generic RPC failures', async () => {
  const client = new CollaborationClient(async () => {
    throw {
      code: 'FLOW_RECONCILIATION_REQUIRED',
      message: 'A new delete preview is required',
      details: { commandId: 'flow-sync-1' },
    };
  });

  await assert.rejects(
    client.listTombstones(),
    (error: unknown) => error instanceof CollaborationClientError
      && error.code === 'FLOW_RECONCILIATION_REQUIRED'
      && error.details?.commandId === 'flow-sync-1',
  );
});

test('read responses without instance identity fail closed', async () => {
  const client = new CollaborationClient(async () => ({ runs: [] }));
  await assert.rejects(
    client.listRunsBySession({ sessionKey: 's', sessionId: 'id' }),
    (error: unknown) => error instanceof CollaborationClientError && error.code === 'INVALID_RESPONSE',
  );
});

test('tombstone list uses the audit RPC and validates cleanup metadata', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new CollaborationClient(async (method, params = {}) => {
    calls.push({ method, params });
    return {
      collaborationInstanceId: 'instance-audit',
      tombstones: [{
        id: 'tombstone-1',
        runId: 'run-deleted',
        actor: 'operator',
        contentDigest: 'a'.repeat(64),
        deletedAt: 10,
        cleanupStatus: 'PARTIAL',
        cleanupError: 'permission denied',
        cleanupUpdatedAt: 12,
        deletionJobId: 'delete-job-1',
        deletionJobStatus: 'PARTIAL',
        flowReconciliationCommandId: 'flow-sync-command-1',
        openclawFlowId: 'managed-flow-1',
        openclawFlowRevision: 7,
        flowReconciliationDiagnostic: 'terminal state mismatch',
        flowReconciliationAbandonedAt: 11,
        flowReconciliationAbandonReason: 'The external Flow was removed intentionally.',
      }],
    };
  });

  const response = await client.listTombstones();

  assert.deepEqual(calls, [{ method: 'junqi.collab.tombstone.list', params: {} }]);
  assert.equal(response.collaborationInstanceId, 'instance-audit');
  assert.deepEqual(response.tombstones[0], {
    id: 'tombstone-1',
    runId: 'run-deleted',
    actor: 'operator',
    contentDigest: 'a'.repeat(64),
    deletedAt: 10,
    cleanupStatus: 'PARTIAL',
    cleanupError: 'permission denied',
    cleanupUpdatedAt: 12,
    deletionJobId: 'delete-job-1',
    deletionJobStatus: 'PARTIAL',
    flowReconciliationCommandId: 'flow-sync-command-1',
    openclawFlowId: 'managed-flow-1',
    openclawFlowRevision: 7,
    flowReconciliationDiagnostic: 'terminal state mismatch',
    flowReconciliationAbandonedAt: 11,
    flowReconciliationAbandonReason: 'The external Flow was removed intentionally.',
  });
});

test('legacy tombstones normalize missing Flow reconciliation audit fields to null', async () => {
  const client = new CollaborationClient(async () => ({
    collaborationInstanceId: 'instance-audit',
    tombstones: [{
      id: 'legacy-tombstone',
      runId: 'legacy-run',
      actor: 'retention-policy',
      contentDigest: 'digest',
      deletedAt: 10,
      cleanupStatus: 'COMPLETED',
      cleanupError: null,
      cleanupUpdatedAt: 10,
      deletionJobId: null,
      deletionJobStatus: null,
    }],
  }));

  const response = await client.listTombstones();
  assert.deepEqual(response.tombstones[0], {
    id: 'legacy-tombstone',
    runId: 'legacy-run',
    actor: 'retention-policy',
    contentDigest: 'digest',
    deletedAt: 10,
    cleanupStatus: 'COMPLETED',
    cleanupError: null,
    cleanupUpdatedAt: 10,
    deletionJobId: null,
    deletionJobStatus: null,
    flowReconciliationCommandId: null,
    openclawFlowId: null,
    openclawFlowRevision: null,
    flowReconciliationDiagnostic: null,
    flowReconciliationAbandonedAt: null,
    flowReconciliationAbandonReason: null,
  });
});

test('tombstones accept explicitly null Flow reconciliation audit fields', async () => {
  const client = new CollaborationClient(async () => ({
    collaborationInstanceId: 'instance-audit',
    tombstones: [{
      id: 'tombstone-with-null-audit',
      runId: 'run-without-abandonment',
      actor: 'operator',
      contentDigest: 'digest',
      deletedAt: 10,
      cleanupStatus: 'COMPLETED',
      cleanupError: null,
      cleanupUpdatedAt: 10,
      deletionJobId: null,
      deletionJobStatus: null,
      flowReconciliationCommandId: null,
      openclawFlowId: null,
      openclawFlowRevision: null,
      flowReconciliationDiagnostic: null,
      flowReconciliationAbandonedAt: null,
      flowReconciliationAbandonReason: null,
    }],
  }));

  const response = await client.listTombstones();
  assert.equal(response.tombstones[0]?.flowReconciliationCommandId, null);
  assert.equal(response.tombstones[0]?.flowReconciliationAbandonReason, null);
});

test('malformed Flow reconciliation tombstone audit fields fail closed', async () => {
  const validAudit = {
    flowReconciliationCommandId: 'flow-sync-command-1',
    openclawFlowId: 'managed-flow-1',
    openclawFlowRevision: 7,
    flowReconciliationDiagnostic: 'terminal state mismatch',
    flowReconciliationAbandonedAt: 11,
    flowReconciliationAbandonReason: 'The external Flow was removed intentionally.',
  };
  const malformedAuditFields: Array<Record<string, unknown>> = [
    { flowReconciliationCommandId: 1 },
    { openclawFlowId: false },
    { openclawFlowRevision: '7' },
    { flowReconciliationDiagnostic: [] },
    { flowReconciliationAbandonedAt: '11' },
    { flowReconciliationAbandonReason: {} },
    { flowReconciliationCommandId: null },
    { openclawFlowId: 'managed-flow-1', openclaw_flow_id: 'conflicting-flow' },
  ];

  for (const malformedFields of malformedAuditFields) {
    const client = new CollaborationClient(async () => ({
      collaborationInstanceId: 'instance-audit',
      tombstones: [{
        id: 'tombstone-1',
        runId: 'run-deleted',
        actor: 'operator',
        contentDigest: 'digest',
        deletedAt: 10,
        cleanupStatus: 'COMPLETED',
        cleanupError: null,
        cleanupUpdatedAt: 10,
        deletionJobId: null,
        deletionJobStatus: null,
        ...validAudit,
        ...malformedFields,
      }],
    }));

    await assert.rejects(
      client.listTombstones(),
      (error: unknown) => error instanceof CollaborationClientError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('malformed tombstone cleanup state fails closed', async () => {
  const client = new CollaborationClient(async () => ({
    collaborationInstanceId: 'instance-audit',
    tombstones: [{
      id: 'tombstone-1',
      runId: 'run-deleted',
      actor: 'operator',
      contentDigest: 'digest',
      deletedAt: 10,
      cleanupStatus: 'UNKNOWN',
      cleanupError: null,
      cleanupUpdatedAt: 10,
    }],
  }));

  await assert.rejects(
    client.listTombstones(),
    (error: unknown) => error instanceof CollaborationClientError && error.code === 'INVALID_RESPONSE',
  );
});

test('current plugin wire shape is normalized to the frontend snapshot contract', async () => {
  const run = {
    id: 'run-wire', status: 'RUNNING', dispatchState: 'OPEN', archiveState: 'ACTIVE',
    reconcileState: 'IDLE', completionOutcome: null, revision: 2, goal: 'wire test',
    currentPlanRevisionId: 'plan-1', allowedActions: ['run.cancel'], createdAt: 1, updatedAt: 2,
    origin: {
      runtimeId: 'runtime-1', agentId: 'main', sessionKey: 'agent:main:desktop',
      sessionId: 'native-session-1', nativeMessageId: 'message-1',
    },
  };
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return validCapabilities({ collaborationInstanceId: 'instance-wire' });
    }
    if (method === 'junqi.collab.run.get') {
      return {
        collaborationInstanceId: 'instance-wire',
        snapshotRevision: 2,
        snapshot: {
          collaborationInstanceId: 'instance-wire', run, lastEventSequence: 9,
          workItems: [{
            id: 'work-1', runId: 'run-wire', logicalId: 'research', planRevisionId: 'plan-1', title: 'Research',
            status: 'READY', assignedAgentId: 'worker', inputScope: ['origin'], dependencies: [],
            requiredCapabilities: ['analysis'], candidateAgentIds: ['worker'],
            acceptanceCriteria: ['Evidence is cited'], revision: 1,
            riskLevel: 'LOW', sideEffectClass: 'READ_ONLY', createdAt: 1, updatedAt: 2,
          }],
          attempts: [], interventions: [], deliveries: [], evidence: [], decisions: [],
          finalArtifact: null, plan: null,
          planRevisions: [
            { id: 'plan-1', runId: 'run-wire', revisionNo: 1, plan: { goal: 'Initial plan' } },
            { id: 'plan-2', runId: 'run-wire', revisionNo: 2, plan: { goal: 'Revised plan' } },
          ],
        },
      };
    }
    return {
      collaborationInstanceId: 'instance-wire', runId: 'run-wire',
      events: [{ sequence: 9, runId: 'run-wire', eventType: 'started', runRevision: 2, payload: {}, createdAt: 2 }],
      nextSequence: 9, lastSequence: 9, hasMore: false, snapshotRevision: 2,
    };
  });

  const capabilities = await client.capabilities();
  const response = await client.getRun('run-wire');
  const events = await client.listEvents({ runId: 'run-wire', afterSequence: 0 });

  assert.equal(capabilities.durableRuntime, true);
  assert.equal(capabilities.durableRuntimeDetails?.required, true);
  assert.equal(capabilities.features?.EVENT_CURSOR, true);
  assert.equal(capabilities.features?.sqliteAuthority, true);
  assert.equal(capabilities.featureEvidence?.behaviorVerified, false);
  assert.equal(capabilities.featureEvidence?.structuralChecks?.databaseIntegrity, 'ok');
  assert.equal(capabilities.featureEvidence?.requiredBehaviorGate, 'ISOLATED_REAL_GATEWAY');
  assert.equal(response.snapshot.runId, 'run-wire');
  assert.equal(response.snapshot.lastEventSequence, 9);
  assert.equal(response.snapshot.workItems[0]?.logicalId, 'research');
  assert.deepEqual(response.snapshot.workItems[0]?.candidateAgentIds, ['worker']);
  assert.deepEqual(response.snapshot.workItems[0]?.acceptanceCriteria, ['Evidence is cited']);
  assert.deepEqual(response.snapshot.planRevisions?.map((revision) => revision.id), ['plan-1', 'plan-2']);
  assert.equal(events.nextSequence, 9);
  assert.equal(events.snapshotRevision, 2);
});
