import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CollaborationClientError } from '@/services/collaboration/client';
import { CollaborationRunActionError } from '@/services/collaboration/runActions';
import type { CollaborationRunSummary } from '@/services/collaboration/types';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';
import {
  CollaborationSessionDockView,
  CollaborationSessionSyncNotice,
  collaborationActionPreviewRecovery,
  collaborationConnectionToBootstrap,
  existingCollaborationRunId,
  isCollaborationProjectionCurrent,
  loadCollaborationRunTrace,
  requestCollaborationRuntimeSetup,
  retryCollaborationDeletionCleanup,
  runCollaborationUiOperation,
  selectSessionCollaborationDockRun,
} from './CollaborationChatProvider';
import { COLLABORATION_SETUP_REQUESTED_EVENT } from '@/stores/collaborationSetupStore';

function runtimeIdentity(overrides: Partial<RuntimeIdentity> = {}): RuntimeIdentity {
  return {
    runtimeId: 'instance-a',
    targetFingerprint: 'target-a',
    connectionId: 'connection-a',
    endpoint: 'ws://127.0.0.1:18789',
    gatewayVersion: '2026.7.1',
    protocol: 3,
    stateDir: '/tmp/openclaw',
    configPath: '/tmp/openclaw/config.json',
    localStateDir: '/tmp/openclaw',
    localConfigPath: '/tmp/openclaw/config.json',
    deploymentKind: 'external',
    ownership: 'user_managed',
    persistence: 'desktop_independent',
    installTarget: 'native_cli',
    endpointAttestation: 'matched',
    pathAttestation: 'matched',
    desktopMutationAllowed: false,
    desktopExitContinuity: true,
    verified: true,
    issues: [],
    authMode: 'token',
    methods: [],
    events: [],
    negotiatedRole: 'operator',
    negotiatedScopes: [],
    supervisorLifecycle: 'running',
    supervisorPort: 18_789,
    observedAtMs: 1,
    ...overrides,
  };
}

function collaborationRun(overrides: Partial<CollaborationRunSummary> = {}): CollaborationRunSummary {
  return {
    runId: 'run-active',
    status: 'RUNNING',
    dispatchState: 'OPEN',
    archiveState: 'ACTIVE',
    reconcileState: 'IDLE',
    completionOutcome: null,
    revision: 3,
    lastEventSequence: 8,
    goal: 'Review the release impact',
    origin: {
      runtimeId: 'instance-a',
      agentId: 'coordinator',
      sessionKey: 'agent:coordinator:main',
      sessionId: 'session-a',
      nativeMessageId: 'message-a',
    },
    currentPlanRevisionId: 'plan-a',
    allowedActions: [],
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  };
}

test('shows collaboration projections only for the exact verified connection and runtime', () => {
  const identity = runtimeIdentity();
  assert.equal(isCollaborationProjectionCurrent(true, identity, 'connection-a', 'instance-a'), true);
  assert.equal(isCollaborationProjectionCurrent(false, identity, 'connection-a', 'instance-a'), false);
  assert.equal(isCollaborationProjectionCurrent(
    true,
    runtimeIdentity({ connectionId: 'connection-b' }),
    'connection-a',
    'instance-a',
  ), false);
  assert.equal(isCollaborationProjectionCurrent(
    true,
    runtimeIdentity({ runtimeId: 'instance-b' }),
    'connection-a',
    'instance-a',
  ), false);
});

test('session dock prioritizes active work and exposes durable runs without duplicating the transcript card', () => {
  const archived = collaborationRun({
    runId: 'run-complete',
    status: 'COMPLETED',
    goal: 'Earlier summary',
    updatedAt: 900,
  });
  const active = collaborationRun({ updatedAt: 100 });
  assert.equal(selectSessionCollaborationDockRun([archived, active])?.runId, 'run-active');

  const html = renderToStaticMarkup(createElement(CollaborationSessionDockView, {
    runs: [archived, active],
    snapshotsByRunId: {
      'run-active': {
        workItems: [{ status: 'SUCCEEDED' }, { status: 'RUNNING' }],
      },
    },
    text: (_key, fallback, values = {}) => fallback.replace('{{completed}}', String(values.completed ?? '')).replace('{{total}}', String(values.total ?? '')).replace('{{count}}', String(values.count ?? '')),
    onOpenRun: () => undefined,
    onOpenHistory: () => undefined,
  }));

  assert.match(html, /data-collaboration-session-dock/);
  assert.match(html, /Review the release impact/);
  assert.match(html, /1\/2/);
  assert.match(html, /Runs/);
});

test('requests a forced capability bootstrap after reconnect or runtime identity replacement', () => {
  assert.equal(collaborationConnectionToBootstrap(
    true,
    runtimeIdentity({ connectionId: 'connection-b' }),
    'connection-a',
    'instance-a',
  ), 'connection-b');
  assert.equal(collaborationConnectionToBootstrap(
    true,
    runtimeIdentity({ runtimeId: 'instance-b' }),
    'connection-a',
    'instance-a',
  ), 'connection-a');
  assert.equal(collaborationConnectionToBootstrap(
    true,
    runtimeIdentity({ runtimeId: null }),
    'connection-a',
    'instance-a',
  ), 'connection-a');
  assert.equal(collaborationConnectionToBootstrap(
    true,
    runtimeIdentity(),
    'connection-a',
    'instance-a',
  ), null);
  assert.equal(collaborationConnectionToBootstrap(false, runtimeIdentity(), null, null), null);
});

test('renders session decoder failures as a nonblocking retryable chat notice', () => {
  const html = renderToStaticMarkup(createElement(CollaborationSessionSyncNotice, {
    error: 'INVALID_RESPONSE at runs[0].origin.sessionId',
    onRetry: () => undefined,
  }));

  assert.match(html, /role="alert"/);
  assert.match(html, /INVALID_RESPONSE at runs\[0\]\.origin\.sessionId/);
  assert.match(html, />Retry</);
});

test('recovers an authoritative active run id from a create race', () => {
  assert.equal(existingCollaborationRunId(new CollaborationClientError(
    'ACTIVE_RUN_EXISTS',
    'already active',
    'junqi.collab.plan.create',
    { runId: ' run-existing ' },
  )), 'run-existing');
  assert.equal(existingCollaborationRunId(new CollaborationClientError(
    'REVISION_CONFLICT',
    'changed',
    'junqi.collab.plan.create',
    { runId: 'run-wrong-code' },
  )), null);
});

test('loads a cross-session run snapshot before its trace timeline', async () => {
  const calls: string[] = [];
  await loadCollaborationRunTrace(
    'run-history',
    async (runId) => { calls.push(`snapshot:${runId}`); },
    async (runId) => { calls.push(`events:${runId}`); },
  );
  assert.deepEqual(calls, ['snapshot:run-history', 'events:run-history']);
});

test('successful UI operations clear a prior local error before and after refresh', async () => {
  const errors: Array<string | null> = ['stale failure'];
  const result = await runCollaborationUiOperation(
    async () => 'refreshed',
    (error) => errors.push(error),
  );

  assert.equal(result, 'refreshed');
  assert.deepEqual(errors, ['stale failure', null, null]);
});

test('failed UI operations retain their actionable error', async () => {
  const errors: Array<string | null> = [];
  await assert.rejects(
    runCollaborationUiOperation(
      async () => { throw new Error('snapshot refresh failed'); },
      (error) => errors.push(error),
    ),
    /snapshot refresh failed/,
  );
  assert.deepEqual(errors, [null, 'snapshot refresh failed']);
});

test('invalidates destructive previews only for recoverable server conflicts', () => {
  assert.equal(collaborationActionPreviewRecovery(
    'DELETE',
    new CollaborationClientError(
      'FLOW_RECONCILIATION_REQUIRED',
      'preview again and confirm Flow abandonment',
      'junqi.collab.run.delete',
    ),
  ), 'INVALIDATE_AND_REFRESH');
  assert.equal(collaborationActionPreviewRecovery(
    'PARTIAL',
    new CollaborationClientError(
      'REVISION_CONFLICT',
      'run changed',
      'junqi.collab.run.partial.accept',
    ),
  ), 'INVALIDATE_AND_REFRESH');
  assert.equal(collaborationActionPreviewRecovery(
    'DELETE',
    new CollaborationRunActionError(
      'INVALID_ACTION_RESPONSE',
      'delete response identity was not verifiable',
    ),
  ), 'INVALIDATE_AND_REFRESH');
  assert.equal(collaborationActionPreviewRecovery(
    'EXPORT',
    new CollaborationClientError(
      'REVISION_CONFLICT',
      'run changed',
      'junqi.collab.export.create',
    ),
  ), 'KEEP');
  assert.equal(collaborationActionPreviewRecovery('DELETE', new Error('network unavailable')), 'KEEP');
});

test('runtime review reuses the registered collaboration setup event', () => {
  const received: Event[] = [];
  requestCollaborationRuntimeSetup('runtime-not-durable', {
    dispatchEvent: (event) => {
      received.push(event);
      return true;
    },
  });

  const [event] = received;
  assert.ok(event instanceof CustomEvent);
  assert.equal(event.type, COLLABORATION_SETUP_REQUESTED_EVENT);
  assert.deepEqual(event.detail, { reason: 'runtime-not-durable' });
});

test('retries deletion cleanup with a stable write envelope and syncs the tombstone after completion', async () => {
  const calls: string[] = [];
  await retryCollaborationDeletionCleanup(
    ' delete-job-1 ',
    'run-1',
    'instance-1',
    async (method, request) => {
      calls.push(`write:${method}`);
      assert.equal(request.jobId, 'delete-job-1');
      assert.equal(request.expectedRunId, 'run-1');
      assert.match(request.payloadHash, /^[a-f0-9]{64}$/);
      assert.ok(request.commandId);
      return {
        collaborationInstanceId: 'instance-1',
        accepted: true,
        replayed: false,
        commandId: request.commandId,
        runId: 'run-1',
        deletionJobId: 'delete-job-1',
      };
    },
    async () => { calls.push('sync:tombstones'); },
    async (response) => {
      calls.push(`wait:${String(response.deletionJobId)}`);
      return { jobId: 'delete-job-1', status: 'COMPLETED', lastError: null };
    },
  );

  assert.deepEqual(calls, [
    'write:junqi.collab.run.delete.retry',
    'wait:delete-job-1',
    'sync:tombstones',
  ]);
});

test('rejects a deletion retry response for another job before polling', async () => {
  let waitCount = 0;
  let syncCount = 0;
  await assert.rejects(
    retryCollaborationDeletionCleanup(
      'delete-job-1',
      'run-1',
      'instance-1',
      async (_method, request) => ({
        collaborationInstanceId: 'instance-1',
        accepted: true,
        replayed: false,
        commandId: request.commandId,
        runId: 'run-1',
        deletionJobId: 'delete-job-other',
      }),
      async () => { syncCount += 1; },
      async () => {
        waitCount += 1;
        return { jobId: 'delete-job-other', status: 'COMPLETED', lastError: null };
      },
    ),
    (error: unknown) => error instanceof CollaborationClientError
      && error.code === 'INVALID_RESPONSE'
      && error.details?.expectedJobId === 'delete-job-1'
      && error.details?.returnedJobId === 'delete-job-other',
  );
  assert.equal(waitCount, 0);
  assert.equal(syncCount, 1);
});

test('syncs the terminal deletion tombstone before surfacing a partial cleanup failure', async () => {
  let syncCount = 0;
  await assert.rejects(
    retryCollaborationDeletionCleanup(
      'delete-job-partial',
      'run-1',
      'instance-1',
      async (_method, request) => ({
        collaborationInstanceId: 'instance-1',
        accepted: true,
        replayed: false,
        commandId: request.commandId,
        runId: 'run-1',
        deletionJobId: 'delete-job-partial',
      }),
      async () => { syncCount += 1; },
      async () => ({
        jobId: 'delete-job-partial',
        status: 'PARTIAL',
        lastError: 'permission denied',
      }),
    ),
    /permission denied/,
  );
  assert.equal(syncCount, 1);
});

test('syncs the tombstone even when deletion retry reports a server-side cleanup error', async () => {
  let syncCount = 0;
  await assert.rejects(
    retryCollaborationDeletionCleanup(
      'delete-job-server-error',
      'run-1',
      'instance-1',
      async () => { throw new Error('physical cleanup remains pending'); },
      async () => { syncCount += 1; },
    ),
    /physical cleanup remains pending/,
  );
  assert.equal(syncCount, 1);
});
