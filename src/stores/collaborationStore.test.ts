import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CollaborationClient,
  CollaborationClientError,
  createCollaborationWriteRequest,
} from '@/services/collaboration/client';
import { COLLABORATION_PLUGIN_BUNDLE } from '@/services/collaboration/bundledPlugin';
import type {
  CollaborationRunSnapshot,
  CollaborationRunSummary,
  CollaborationTombstone,
} from '@/services/collaboration/types';
import { publishCollaborationChangedEvent } from '@/services/gateway/collaborationEventBridge';
import {
  createCollaborationStore,
  selectCollaborationRunsForSession,
} from './collaborationStore';

const SESSION = { sessionKey: 'agent:main:desktop', sessionId: 'native-session-1' };

function capabilitiesResponse(collaborationInstanceId: string): Record<string, unknown> {
  return {
    collaborationInstanceId,
    pluginId: 'junqi-collab',
    pluginVersion: COLLABORATION_PLUGIN_BUNDLE.pluginVersion,
    schemaVersion: COLLABORATION_PLUGIN_BUNDLE.schemaVersion,
    runtimeVersion: '2026.7.1',
    databaseIntegrity: 'ok',
    configured: true,
    durableState: true,
    durableRuntime: { supported: true, required: true, reason: null },
    trustTier: 'portable-core',
    workboard: { supported: false, reason: 'trusted-official runtime is not available' },
    sessionCapabilities: {
      deleteExpectedSessionId: true,
      resetExpectedSessionId: false,
    },
    features: [
      'SQLITE_AUTHORITY',
      'COMMAND_OUTBOX',
      'TASK_RECONCILE',
      'EXACT_TRANSCRIPT_DELIVERY',
      'EXACT_TRANSCRIPT_IDENTITY',
      'PLUGIN_SUBAGENT_TASK_LOOKUP',
      'PLUGIN_SUBAGENT_TASK_CANCEL',
      'EVENT_CURSOR',
      'SESSION_DELETE_CAS',
      'WRITE_INSTANCE_FENCE',
      'WORKFLOW_TEMPLATES',
    ],
    featureFlags: {
      sqliteAuthority: true,
      commandOutbox: true,
      taskReconcile: true,
      exactTranscriptDelivery: true,
      eventCursor: true,
      sessionDeleteCas: true,
      sessionResetCas: false,
      writeInstanceFence: true,
      workflowTemplates: true,
      workboardMirror: false,
    },
    featureEvidence: {
      kind: 'DECLARED_PLUGIN_CONTRACT',
      behaviorVerified: false,
      structuralChecks: {
        pluginServiceStarted: true,
        databaseIntegrity: 'ok',
        configured: true,
      },
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
  };
}

function summary(revision: number, status: CollaborationRunSummary['status'] = 'RUNNING'): CollaborationRunSummary {
  return {
    runId: 'run-1',
    status,
    dispatchState: status === 'RUNNING' ? 'OPEN' : 'STOPPED',
    archiveState: 'ACTIVE',
    reconcileState: 'IDLE',
    completionOutcome: null,
    revision,
    lastEventSequence: revision,
    goal: 'Review the proposal',
    origin: {
      runtimeId: 'runtime-1',
      agentId: 'main',
      ...SESSION,
      nativeMessageId: 'message-1',
    },
    currentPlanRevisionId: 'plan-1',
    allowedActions: ['run.cancel'],
    createdAt: 1,
    updatedAt: revision,
  };
}

function summaryWithId(
  runId: string,
  revision: number,
  status: CollaborationRunSummary['status'] = 'COMPLETED',
): CollaborationRunSummary {
  const value = summary(revision, status);
  return {
    ...value,
    runId,
    goal: `Goal for ${runId}`,
    origin: {
      ...value.origin,
      sessionKey: `agent:main:${runId}`,
      sessionId: `session-${runId}`,
      nativeMessageId: `message-${runId}`,
    },
  };
}

function snapshot(revision: number): CollaborationRunSnapshot {
  return {
    ...summary(revision),
    snapshotRevision: revision,
    workItems: [],
    attempts: [],
    interventions: [],
    deliveries: [],
  };
}

function wireRunSummary(value: CollaborationRunSummary): Record<string, unknown> {
  const { runId, ...summaryFields } = value;
  return { id: runId, ...summaryFields };
}

function sessionRunListResponse(
  collaborationInstanceId: string,
  runs: CollaborationRunSummary[],
): Record<string, unknown> {
  return {
    collaborationInstanceId,
    ...SESSION,
    runs: runs.map(wireRunSummary),
    snapshotRevision: Math.max(0, ...runs.map((run) => run.revision)),
    lastSequence: Math.max(0, ...runs.map((run) => run.lastEventSequence)),
  };
}

function globalRunListResponse(
  collaborationInstanceId: string,
  runs: CollaborationRunSummary[],
  nextCursor: string | null = null,
): Record<string, unknown> {
  return {
    collaborationInstanceId,
    runs: runs.map(wireRunSummary),
    nextCursor,
    snapshotRevision: Math.max(0, ...runs.map((run) => run.revision)),
    lastSequence: Math.max(0, ...runs.map((run) => run.lastEventSequence)),
  };
}

function runGetResponse(
  collaborationInstanceId: string,
  value: CollaborationRunSnapshot,
): Record<string, unknown> {
  const {
    runId,
    snapshotRevision,
    workItems,
    attempts,
    interventions,
    deliveries,
    ...summaryFields
  } = value;
  return {
    collaborationInstanceId,
    snapshotRevision,
    snapshot: {
      collaborationInstanceId,
      run: { id: runId, ...summaryFields },
      lastEventSequence: value.lastEventSequence,
      planRevisions: value.currentPlanRevisionId === null
        ? []
        : [{ id: value.currentPlanRevisionId, runId, revisionNo: 1 }],
      workItems,
      attempts,
      evidence: [],
      interventions,
      deliveries,
      decisions: [],
      finalArtifact: null,
    },
  };
}

function tombstone(overrides: Partial<CollaborationTombstone> = {}): CollaborationTombstone {
  return {
    id: 'tombstone-1',
    runId: 'run-1',
    actor: 'operator',
    contentDigest: 'a'.repeat(64),
    deletedAt: 20,
    cleanupStatus: 'COMPLETED',
    cleanupError: null,
    cleanupUpdatedAt: 20,
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

test('instance change clears all cached collaboration state', async () => {
  let instanceId = 'instance-a';
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse(instanceId);
    }
    return sessionRunListResponse(instanceId, [summary(1)]);
  });
  const store = createCollaborationStore(client);

  await store.getState().syncSession(SESSION);
  assert.equal(Object.keys(store.getState().runsById).length, 1);

  instanceId = 'instance-b';
  await store.getState().bootstrap(true);
  assert.equal(store.getState().collaborationInstanceId, 'instance-b');
  assert.deepEqual(store.getState().runsById, {});
  assert.deepEqual(store.getState().runIdsBySession, {});
});

test('a slower stale capabilities response cannot restore an old instance', async () => {
  let resolveFirst!: (value: unknown) => void;
  let resolveSecond!: (value: unknown) => void;
  let callNo = 0;
  const client = new CollaborationClient(async () => {
    callNo += 1;
    return new Promise((resolve) => {
      if (callNo === 1) resolveFirst = resolve;
      else resolveSecond = resolve;
    });
  });
  const store = createCollaborationStore(client);

  const first = store.getState().bootstrap();
  const second = store.getState().bootstrap(true);
  resolveSecond(capabilitiesResponse('instance-new'));
  await second;
  resolveFirst(capabilitiesResponse('instance-old'));
  await first;

  assert.equal(store.getState().collaborationInstanceId, 'instance-new');
});

test('tombstone sync removes deleted run projections and instance replacement clears the audit cache', async () => {
  let instanceId = 'instance-a';
  const deleted = tombstone();
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse(instanceId);
    }
    if (method === 'junqi.collab.tombstone.list') {
      return { collaborationInstanceId: instanceId, tombstones: [deleted] };
    }
    throw new Error(`Unexpected RPC ${method}`);
  });
  const store = createCollaborationStore(client);
  await store.getState().bootstrap();
  store.setState({
    runsById: { 'run-1': summary(2) },
    snapshotsByRunId: { 'run-1': snapshot(2) },
    eventsByRunId: {
      'run-1': [{ sequence: 1, runId: 'run-1', eventType: 'created', runRevision: 1, payload: {}, createdAt: 1 }],
    },
    cursorsByRunId: {
      'run-1': { afterSequence: 1, snapshotRevision: 2, complete: true, syncing: false },
    },
    runIdsBySession: { session: ['run-1'] },
    commandsById: {
      command: {
        commandId: 'command',
        method: 'junqi.collab.run.cancel',
        status: 'accepted',
        runId: 'run-1',
      },
    },
  });

  const loaded = await store.getState().syncTombstones();

  assert.deepEqual(loaded, [deleted]);
  assert.deepEqual(store.getState().tombstones, [deleted]);
  assert.deepEqual(store.getState().runsById, {});
  assert.deepEqual(store.getState().snapshotsByRunId, {});
  assert.deepEqual(store.getState().eventsByRunId, {});
  assert.deepEqual(store.getState().cursorsByRunId, {});
  assert.deepEqual(store.getState().runIdsBySession, { session: [] });
  assert.deepEqual(store.getState().commandsById, {});

  instanceId = 'instance-b';
  await store.getState().bootstrap(true);
  assert.equal(store.getState().collaborationInstanceId, 'instance-b');
  assert.deepEqual(store.getState().tombstones, []);
});

test('a slower run-list response cannot restore a run already fenced by a tombstone', async () => {
  let resolveRuns!: (value: unknown) => void;
  let markRunListStarted!: () => void;
  const runListStarted = new Promise<void>((resolve) => { markRunListStarted = resolve; });
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-a');
    }
    if (method === 'junqi.collab.tombstone.list') {
      return { collaborationInstanceId: 'instance-a', tombstones: [tombstone()] };
    }
    if (method === 'junqi.collab.run.list') {
      markRunListStarted();
      return new Promise((resolve) => { resolveRuns = resolve; });
    }
    throw new Error(`Unexpected RPC ${method}`);
  });
  const store = createCollaborationStore(client);

  const runSync = store.getState().syncGlobalRuns({ includeArchived: true });
  await runListStarted;
  await store.getState().syncTombstones();
  resolveRuns(globalRunListResponse('instance-a', [summary(2, 'COMPLETED')]));
  await runSync;

  assert.deepEqual(store.getState().tombstones, [tombstone()]);
  assert.deepEqual(store.getState().runsById, {});
});

test('global history sync loads every cursor page, sorts after aggregation, and keeps tombstones fenced', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = new CollaborationClient(async (method, params = {}) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-history');
    }
    if (method === 'junqi.collab.run.list') {
      calls.push(params);
      if (params.cursor === undefined) {
        return globalRunListResponse(
          'instance-history',
          [summaryWithId('run-page-1', 1)],
          'cursor-page-2',
        );
      }
      return globalRunListResponse('instance-history', [summaryWithId('run-page-2', 2)]);
    }
    throw new Error(`Unexpected RPC ${method}`);
  });
  const store = createCollaborationStore(client);
  await store.getState().bootstrap();
  store.setState({
    tombstones: [tombstone({ runId: 'run-page-1' })],
  });

  const runs = await store.getState().syncGlobalRuns({ includeArchived: true });

  assert.deepEqual(runs.map((run) => run.runId), ['run-page-2', 'run-page-1']);
  assert.deepEqual(calls, [
    { includeArchived: true, limit: 500 },
    { includeArchived: true, limit: 500, cursor: 'cursor-page-2' },
  ]);
  assert.deepEqual(Object.keys(store.getState().runsById), ['run-page-2']);
});

test('global history sync fails closed on a repeated cursor without committing partial pages', async () => {
  let page = 0;
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-history');
    }
    if (method === 'junqi.collab.run.list') {
      page += 1;
      return globalRunListResponse(
        'instance-history',
        [summaryWithId(`partial-${page}`, page)],
        'cursor-loop',
      );
    }
    throw new Error(`Unexpected RPC ${method}`);
  });
  const store = createCollaborationStore(client);
  await store.getState().bootstrap();
  store.setState({ runsById: { existing: summaryWithId('existing', 9) } });

  await assert.rejects(
    store.getState().syncGlobalRuns({ includeArchived: true }),
    (error: unknown) => error instanceof CollaborationClientError && error.code === 'INVALID_RESPONSE',
  );

  assert.deepEqual(Object.keys(store.getState().runsById), ['existing']);
  assert.equal(page, 2);
});

test('global history sync enforces its 10000-run materialization bound before committing', async () => {
  let page = 0;
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-history');
    }
    if (method === 'junqi.collab.run.list') {
      page += 1;
      const pageSize = page <= 20 ? 500 : 1;
      const offset = (page - 1) * 500;
      return globalRunListResponse(
        'instance-history',
        Array.from({ length: pageSize }, (_, index) => summaryWithId(`bounded-${offset + index}`, 1)),
        page <= 20 ? `cursor-${page}` : null,
      );
    }
    throw new Error(`Unexpected RPC ${method}`);
  });
  const store = createCollaborationStore(client);
  await store.getState().bootstrap();
  store.setState({ runsById: { existing: summaryWithId('existing', 9) } });

  await assert.rejects(
    store.getState().syncGlobalRuns({ includeArchived: true }),
    (error: unknown) => error instanceof CollaborationClientError && error.code === 'CAPACITY_EXCEEDED',
  );

  assert.deepEqual(Object.keys(store.getState().runsById), ['existing']);
  assert.equal(page, 21);
});

test('a tombstone fences slower snapshot and event responses from restoring deleted content', async () => {
  let resolveSnapshot!: (value: unknown) => void;
  let resolveEvents!: (value: unknown) => void;
  let markSnapshotStarted!: () => void;
  let markEventsStarted!: () => void;
  const snapshotStarted = new Promise<void>((resolve) => { markSnapshotStarted = resolve; });
  const eventsStarted = new Promise<void>((resolve) => { markEventsStarted = resolve; });
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-a');
    }
    if (method === 'junqi.collab.run.get') {
      markSnapshotStarted();
      return new Promise((resolve) => { resolveSnapshot = resolve; });
    }
    if (method === 'junqi.collab.events.list') {
      markEventsStarted();
      return new Promise((resolve) => { resolveEvents = resolve; });
    }
    if (method === 'junqi.collab.tombstone.list') {
      return { collaborationInstanceId: 'instance-a', tombstones: [tombstone()] };
    }
    throw new Error(`Unexpected RPC ${method}`);
  });
  const store = createCollaborationStore(client);
  await store.getState().bootstrap();

  const snapshotRequest = store.getState().refreshRun('run-1');
  const eventRequest = store.getState().syncRunEvents('run-1');
  await Promise.all([snapshotStarted, eventsStarted]);
  await store.getState().syncTombstones();
  resolveSnapshot(runGetResponse('instance-a', { ...snapshot(3), goal: 'deleted secret' }));
  resolveEvents({
    collaborationInstanceId: 'instance-a',
    runId: 'run-1',
    events: [{
      sequence: 3,
      runId: 'run-1',
      eventType: 'secret',
      runRevision: 3,
      payload: { content: 'deleted secret' },
      createdAt: 3,
    }],
    nextSequence: 3,
    lastSequence: 3,
    hasMore: false,
    snapshotRevision: 3,
  });

  await assert.rejects(
    snapshotRequest,
    (error: unknown) => error instanceof CollaborationClientError && error.code === 'NOT_FOUND',
  );
  await eventRequest;
  assert.deepEqual(store.getState().runsById, {});
  assert.deepEqual(store.getState().snapshotsByRunId, {});
  assert.deepEqual(store.getState().eventsByRunId, {});
  assert.deepEqual(store.getState().cursorsByRunId, {});
});

test('an instance mismatch refreshes capabilities and never commits the crossing response', async () => {
  let capabilityCalls = 0;
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      capabilityCalls += 1;
      return capabilitiesResponse(capabilityCalls === 1 ? 'instance-a' : 'instance-b');
    }
    return sessionRunListResponse('instance-b', [summary(1)]);
  });
  const store = createCollaborationStore(client);

  await assert.rejects(
    store.getState().syncSession(SESSION),
    (error: unknown) => error instanceof CollaborationClientError && error.code === 'INSTANCE_MISMATCH',
  );

  assert.equal(store.getState().collaborationInstanceId, 'instance-b');
  assert.deepEqual(store.getState().runsById, {});
  assert.deepEqual(store.getState().runIdsBySession, {});

  await store.getState().syncSession(SESSION);
  assert.equal(store.getState().runsById['run-1']?.revision, 1);
});

test('reset prevents an in-flight session response from restoring discarded state', async () => {
  let resolveList!: (value: unknown) => void;
  let markListStarted!: () => void;
  const listStarted = new Promise<void>((resolve) => { markListStarted = resolve; });
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-a');
    }
    markListStarted();
    return new Promise((resolve) => { resolveList = resolve; });
  });
  const store = createCollaborationStore(client);

  const sync = store.getState().syncSession(SESSION);
  await listStarted;
  store.getState().reset();
  resolveList(sessionRunListResponse('instance-a', [summary(1)]));

  await assert.rejects(
    sync,
    (error: unknown) => error instanceof CollaborationClientError && error.code === 'INSTANCE_MISMATCH',
  );
  assert.equal(store.getState().collaborationInstanceId, null);
  assert.deepEqual(store.getState().runsById, {});
  assert.deepEqual(store.getState().sessionSync, {});
});

test('reset and rebootstrap to the same instance still reject an old session response', async () => {
  let resolveList!: (value: unknown) => void;
  let markListStarted!: () => void;
  const listStarted = new Promise<void>((resolve) => { markListStarted = resolve; });
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-a');
    }
    if (method === 'junqi.collab.run.listBySession') {
      markListStarted();
      return new Promise((resolve) => { resolveList = resolve; });
    }
    throw new Error(`Unexpected RPC ${method}`);
  });
  const store = createCollaborationStore(client);

  const staleSync = store.getState().syncSession(SESSION);
  await listStarted;
  store.getState().reset();
  await store.getState().bootstrap();
  resolveList(sessionRunListResponse('instance-a', [summary(7)]));

  await assert.rejects(
    staleSync,
    (error: unknown) => error instanceof CollaborationClientError && error.code === 'INSTANCE_MISMATCH',
  );
  assert.equal(store.getState().collaborationInstanceId, 'instance-a');
  assert.deepEqual(store.getState().runsById, {});
  assert.deepEqual(store.getState().runIdsBySession, {});
});

test('clearing a session projection fences an in-flight response for the same runtime', async () => {
  let resolveList!: (value: unknown) => void;
  let markListStarted!: () => void;
  const listStarted = new Promise<void>((resolve) => { markListStarted = resolve; });
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-a');
    }
    if (method === 'junqi.collab.run.listBySession') {
      markListStarted();
      return new Promise((resolve) => { resolveList = resolve; });
    }
    throw new Error(`Unexpected RPC ${method}`);
  });
  const store = createCollaborationStore(client);

  const staleSync = store.getState().syncSession(SESSION);
  await listStarted;
  store.getState().clearSessionProjection(SESSION);
  resolveList(sessionRunListResponse('instance-a', [summary(7)]));

  await staleSync;
  assert.equal(store.getState().collaborationInstanceId, 'instance-a');
  assert.deepEqual(store.getState().runsById, {});
  assert.deepEqual(store.getState().runIdsBySession, {});
  assert.deepEqual(store.getState().sessionSync, {});
});

test('session decoder errors remain visible in the session sync projection', async () => {
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-a');
    }
    if (method === 'junqi.collab.run.listBySession') {
      return {
        collaborationInstanceId: 'instance-a',
        ...SESSION,
        runs: 'not-an-array',
        snapshotRevision: 0,
        lastSequence: 0,
      };
    }
    throw new Error(`Unexpected RPC ${method}`);
  });
  const store = createCollaborationStore(client);

  await assert.rejects(
    store.getState().syncSession(SESSION),
    (error: unknown) => error instanceof CollaborationClientError && error.code === 'INVALID_RESPONSE',
  );

  const syncState = Object.values(store.getState().sessionSync)[0];
  assert.equal(syncState?.loading, false);
  assert.match(syncState?.error ?? '', /invalid/i);
});

test('stopping a poller while session sync is in flight prevents event reads and rescheduling', async () => {
  let resolveList!: (value: unknown) => void;
  let markListStarted!: () => void;
  const listStarted = new Promise<void>((resolve) => { markListStarted = resolve; });
  let eventCalls = 0;
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-a');
    }
    if (method === 'junqi.collab.run.listBySession') {
      markListStarted();
      return new Promise((resolve) => { resolveList = resolve; });
    }
    if (method === 'junqi.collab.events.list') {
      eventCalls += 1;
      return {
        collaborationInstanceId: 'instance-a',
        runId: 'run-1',
        events: [{
          sequence: 2,
          runId: 'run-1',
          eventType: 'progress',
          runRevision: 2,
          payload: {},
          createdAt: 2,
        }],
        nextSequence: 0,
        lastSequence: 0,
        hasMore: false,
        snapshotRevision: 1,
      };
    }
    throw new Error(`Unexpected RPC ${method}`);
  });
  const store = createCollaborationStore(client);

  const stop = store.getState().startSessionPolling(SESSION, {
    activeIntervalMs: 1,
    idleIntervalMs: 1,
  });
  await listStarted;
  stop();
  resolveList(sessionRunListResponse('instance-a', [summary(1)]));
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(eventCalls, 0);
});

test('session sync is isolated by native session id and never rolls back a run revision', async () => {
  let revision = 2;
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-a');
    }
    return sessionRunListResponse('instance-a', [summary(revision)]);
  });
  const store = createCollaborationStore(client);

  await store.getState().syncSession(SESSION);
  revision = 1;
  await store.getState().syncSession(SESSION);

  assert.equal(store.getState().runsById['run-1']?.revision, 2);
  assert.equal(selectCollaborationRunsForSession(store.getState(), SESSION).length, 1);
  assert.equal(selectCollaborationRunsForSession(store.getState(), { ...SESSION, sessionId: 'after-reset' }).length, 0);
});

test('event sync consumes cursor pages, deduplicates events, and refreshes a newer snapshot', async () => {
  const eventRequests: number[] = [];
  const client = new CollaborationClient(async (method, params = {}) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-a');
    }
    if (method === 'junqi.collab.run.listBySession') {
      return sessionRunListResponse('instance-a', [summary(1)]);
    }
    if (method === 'junqi.collab.run.get') {
      return runGetResponse('instance-a', snapshot(3));
    }
    const afterSequence = params.afterSequence as number;
    eventRequests.push(afterSequence);
    if (afterSequence === 0) {
      return {
        collaborationInstanceId: 'instance-a', runId: 'run-1',
        events: [
          { sequence: 1, runId: 'run-1', eventType: 'created', runRevision: 1, payload: {}, createdAt: 1 },
          { sequence: 2, runId: 'run-1', eventType: 'started', runRevision: 2, payload: {}, createdAt: 2 },
        ],
        nextSequence: 2, lastSequence: 3, hasMore: true, snapshotRevision: 2,
      };
    }
    return {
      collaborationInstanceId: 'instance-a', runId: 'run-1',
      events: [
        { sequence: 3, runId: 'run-1', eventType: 'progress', runRevision: 3, payload: {}, createdAt: 3 },
      ],
      nextSequence: 3, lastSequence: 3, hasMore: false, snapshotRevision: 3,
    };
  });
  const store = createCollaborationStore(client);

  await store.getState().syncSession(SESSION);
  store.setState({
    eventsByRunId: {
      'run-1': [{
        sequence: 1,
        runId: 'run-1',
        eventType: 'created',
        runRevision: 1,
        payload: {},
        createdAt: 1,
      }],
    },
  });
  await store.getState().syncRunEvents('run-1');

  assert.deepEqual(eventRequests, [0, 2]);
  assert.deepEqual(store.getState().eventsByRunId['run-1']?.map((event) => event.sequence), [1, 2, 3]);
  assert.equal(store.getState().cursorsByRunId['run-1']?.afterSequence, 3);
  assert.equal(store.getState().runsById['run-1']?.revision, 3);
  assert.equal(store.getState().snapshotsByRunId['run-1']?.snapshotRevision, 3);
});

test('invalid event cursor marks the timeline incomplete and reloads authoritative snapshot', async () => {
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-a');
    }
    if (method === 'junqi.collab.run.listBySession') {
      return sessionRunListResponse('instance-a', [summary(1)]);
    }
    if (method === 'junqi.collab.run.get') {
      return runGetResponse('instance-a', snapshot(5));
    }
    return {
      collaborationInstanceId: 'instance-a', runId: 'run-1',
      events: [{
        sequence: 50,
        runId: 'run-1',
        eventType: 'cursor-recovery',
        runRevision: 5,
        payload: {},
        createdAt: 50,
      }],
      nextSequence: 50, lastSequence: 50, hasMore: false, snapshotRevision: 5,
      cursorInvalid: true, cursorInvalidReason: 'compacted',
    };
  });
  const store = createCollaborationStore(client);

  await store.getState().syncSession(SESSION);
  await store.getState().syncRunEvents('run-1');

  assert.equal(store.getState().cursorsByRunId['run-1']?.complete, false);
  assert.equal(store.getState().cursorsByRunId['run-1']?.incompleteReason, 'compacted');
  assert.equal(store.getState().cursorsByRunId['run-1']?.afterSequence, 50);
  assert.equal(store.getState().runsById['run-1']?.revision, 5);
});

test('event page limits mark a partial timeline until the next sync reaches the authoritative tail', async () => {
  let eventCall = 0;
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-a');
    }
    if (method === 'junqi.collab.run.listBySession') {
      return sessionRunListResponse('instance-a', [summary(2)]);
    }
    if (method === 'junqi.collab.run.get') {
      return runGetResponse('instance-a', snapshot(2));
    }
    eventCall += 1;
    const sequence = eventCall;
    return {
      collaborationInstanceId: 'instance-a',
      runId: 'run-1',
      events: [{
        sequence,
        runId: 'run-1',
        eventType: `event-${sequence}`,
        runRevision: sequence,
        payload: {},
        createdAt: sequence,
      }],
      nextSequence: sequence,
      lastSequence: 2,
      hasMore: sequence < 2,
      snapshotRevision: 2,
    };
  });
  const store = createCollaborationStore(client);

  await store.getState().syncSession(SESSION);
  await store.getState().syncRunEvents('run-1', { maxPages: 1 });
  assert.equal(store.getState().cursorsByRunId['run-1']?.complete, false);
  assert.equal(store.getState().cursorsByRunId['run-1']?.incompleteReason, 'page_limit');
  assert.deepEqual(store.getState().eventsByRunId['run-1']?.map((event) => event.sequence), [1]);

  await store.getState().syncRunEvents('run-1', { maxPages: 1 });
  assert.equal(store.getState().cursorsByRunId['run-1']?.complete, true);
  assert.equal(store.getState().cursorsByRunId['run-1']?.incompleteReason, undefined);
  assert.deepEqual(store.getState().eventsByRunId['run-1']?.map((event) => event.sequence), [1, 2]);
});

test('first event sync loads a full snapshot even when the event page is empty', async () => {
  let getCalls = 0;
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-a');
    }
    if (method === 'junqi.collab.run.listBySession') {
      return sessionRunListResponse('instance-a', [summary(2)]);
    }
    if (method === 'junqi.collab.run.get') {
      getCalls += 1;
      return runGetResponse('instance-a', snapshot(2));
    }
    return {
      collaborationInstanceId: 'instance-a', runId: 'run-1', events: [],
      nextSequence: 0, lastSequence: 0, hasMore: false, snapshotRevision: 2,
    };
  });
  const store = createCollaborationStore(client);

  await store.getState().syncSession(SESSION);
  await store.getState().syncRunEvents('run-1');

  assert.equal(getCalls, 1);
  assert.equal(store.getState().snapshotsByRunId['run-1']?.snapshotRevision, 2);
});

test('revision conflict refreshes state but never replays the write command', async () => {
  let writeCalls = 0;
  let getCalls = 0;
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-a');
    }
    if (method === 'junqi.collab.run.get') {
      getCalls += 1;
      return runGetResponse('instance-a', snapshot(4));
    }
    writeCalls += 1;
    throw new CollaborationClientError('REVISION_CONFLICT', 'stale', method);
  });
  const store = createCollaborationStore(client);
  const request = await createCollaborationWriteRequest(
    { runId: 'run-1' },
    { expectedCollaborationInstanceId: 'instance-a', expectedRunRevision: 3 },
    'command-conflict',
  );

  await assert.rejects(
    store.getState().executeCommand('junqi.collab.run.cancel', request),
    /stale/,
  );

  assert.equal(writeCalls, 1);
  assert.equal(getCalls, 1);
  assert.equal(store.getState().runsById['run-1']?.revision, 4);
  assert.equal(store.getState().commandsById['command-conflict']?.status, 'failed');
});

test('an accepted command from a replaced instance cannot repopulate command state', async () => {
  let instanceId = 'instance-a';
  let resolveWrite!: (value: unknown) => void;
  let markWriteStarted!: () => void;
  const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse(instanceId);
    }
    markWriteStarted();
    return new Promise((resolve) => { resolveWrite = resolve; });
  });
  const store = createCollaborationStore(client);
  const request = await createCollaborationWriteRequest(
    { runId: 'run-1' },
    { expectedCollaborationInstanceId: 'instance-a', expectedRunRevision: 1 },
    'command-cross-instance',
  );

  const write = store.getState().executeCommand('junqi.collab.run.cancel', request);
  await writeStarted;
  instanceId = 'instance-b';
  await store.getState().bootstrap(true);
  resolveWrite({
    collaborationInstanceId: 'instance-a',
    accepted: true,
    replayed: false,
    commandId: request.commandId,
    runId: 'run-1',
  });

  await assert.rejects(
    write,
    (error: unknown) => error instanceof CollaborationClientError && error.code === 'INSTANCE_MISMATCH',
  );
  assert.equal(store.getState().collaborationInstanceId, 'instance-b');
  assert.deepEqual(store.getState().commandsById, {});
});

test('malformed, foreign-instance, and stale changed hints fail closed without RPC reads', async () => {
  let readCalls = 0;
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-a');
    }
    readCalls += 1;
    if (method === 'junqi.collab.run.listBySession') {
      return sessionRunListResponse('instance-a', [summary(5)]);
    }
    if (method === 'junqi.collab.run.get') {
      return runGetResponse('instance-a', snapshot(5));
    }
    return {
      collaborationInstanceId: 'instance-a', runId: 'run-1',
      events: [{
        sequence: 5,
        runId: 'run-1',
        eventType: 'current',
        runRevision: 5,
        payload: {},
        createdAt: 5,
      }],
      nextSequence: 5, lastSequence: 5, hasMore: false, snapshotRevision: 5,
    };
  });
  const store = createCollaborationStore(client);
  await store.getState().syncSession(SESSION);
  await store.getState().refreshRun('run-1');
  await store.getState().syncRunEvents('run-1');
  readCalls = 0;

  await store.getState().handleChangedHint({
    collaborationInstanceId: 'instance-a', runId: 'run-1', runRevision: 4, lastSequence: 4,
  });
  await store.getState().handleChangedHint({
    collaborationInstanceId: 'old-instance', runId: 'run-1', runRevision: 99, lastSequence: 99,
  });
  await (store.getState().handleChangedHint as (hint: unknown) => Promise<void>)({
    collaborationInstanceId: 'instance-a', runId: 'run-1', runRevision: '6', lastSequence: 6,
  });

  assert.equal(readCalls, 0);
  assert.equal(store.getState().runsById['run-1']?.revision, 5);
  assert.equal(store.getState().cursorsByRunId['run-1']?.afterSequence, 5);
});

test('a newer changed hint catches up events and refreshes the authoritative snapshot once', async () => {
  let authoritativeRevision = 1;
  let getCalls = 0;
  let eventCalls = 0;
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-a');
    }
    if (method === 'junqi.collab.run.listBySession') {
      return sessionRunListResponse('instance-a', [summary(1)]);
    }
    if (method === 'junqi.collab.run.get') {
      getCalls += 1;
      return runGetResponse('instance-a', snapshot(authoritativeRevision));
    }
    eventCalls += 1;
    return {
      collaborationInstanceId: 'instance-a', runId: 'run-1',
      events: [{
        sequence: authoritativeRevision,
        runId: 'run-1',
        eventType: 'progress',
        runRevision: authoritativeRevision,
        payload: {},
        createdAt: authoritativeRevision,
      }],
      nextSequence: authoritativeRevision,
      lastSequence: authoritativeRevision,
      hasMore: false,
      snapshotRevision: authoritativeRevision,
    };
  });
  const store = createCollaborationStore(client);
  await store.getState().syncSession(SESSION);
  await store.getState().refreshRun('run-1');
  await store.getState().syncRunEvents('run-1');
  authoritativeRevision = 3;
  getCalls = 0;
  eventCalls = 0;

  await store.getState().handleChangedHint({
    collaborationInstanceId: 'instance-a', runId: 'run-1', runRevision: 3, lastSequence: 3,
  });

  assert.equal(eventCalls, 1);
  assert.equal(getCalls, 1);
  assert.equal(store.getState().runsById['run-1']?.revision, 3);
  assert.equal(store.getState().snapshotsByRunId['run-1']?.revision, 3);
  assert.equal(store.getState().cursorsByRunId['run-1']?.afterSequence, 3);
});

test('a changed hint immediately links an externally created run to its origin session', async () => {
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') return capabilitiesResponse('instance-a');
    if (method === 'junqi.collab.run.get') return runGetResponse('instance-a', snapshot(2));
    if (method === 'junqi.collab.events.list') {
      return {
        collaborationInstanceId: 'instance-a',
        runId: 'run-1',
        events: [{
          sequence: 2,
          runId: 'run-1',
          eventType: 'progress',
          runRevision: 2,
          payload: {},
          createdAt: 2,
        }],
        nextSequence: 2,
        lastSequence: 2,
        hasMore: false,
        snapshotRevision: 2,
      };
    }
    throw new Error(`Unexpected RPC ${method}`);
  });
  const store = createCollaborationStore(client);

  await store.getState().handleChangedHint({
    collaborationInstanceId: 'instance-a', runId: 'run-1', runRevision: 2, lastSequence: 2,
  });

  assert.deepEqual(
    selectCollaborationRunsForSession(store.getState(), SESSION).map((run) => run.runId),
    ['run-1'],
  );
});

test('changed hint subscription is active only until its disposer runs', async () => {
  let getCalls = 0;
  let getObserved!: () => void;
  let observed = new Promise<void>((resolve) => { getObserved = resolve; });
  const client = new CollaborationClient(async (method) => {
    if (method === 'junqi.collab.capabilities') {
      return capabilitiesResponse('instance-a');
    }
    if (method === 'junqi.collab.run.get') {
      getCalls += 1;
      getObserved();
      return runGetResponse('instance-a', snapshot(getCalls + 1));
    }
    throw new Error(`Unexpected RPC ${method}`);
  });
  const store = createCollaborationStore(client);
  await store.getState().bootstrap();
  const unsubscribe = store.getState().startChangedHintSubscription();

  publishCollaborationChangedEvent({
    type: 'event', event: 'agent',
    payload: {
      stream: 'junqi-collab.changed',
      data: { collaborationInstanceId: 'instance-a', runId: 'run-1', runRevision: 2, lastSequence: 0 },
    },
  });
  await observed;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(getCalls, 1);

  unsubscribe();
  observed = new Promise<void>((resolve) => { getObserved = resolve; });
  publishCollaborationChangedEvent({
    type: 'event', event: 'agent',
    payload: {
      stream: 'junqi-collab.changed',
      data: { collaborationInstanceId: 'instance-a', runId: 'run-1', runRevision: 3, lastSequence: 0 },
    },
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(getCalls, 1);
});
