import assert from 'node:assert/strict';
import test from 'node:test';
import { CollaborationClientError, hashCollaborationPayload } from './client';
import {
  SessionMutationCoordinator,
  SessionMutationCoordinatorError,
  type ActiveSessionMutation,
  type SessionMutationAction,
  type SessionMutationCoordinatorDependencies,
  type SessionMutationExecutionResult,
  type SessionMutationRequest,
} from './SessionMutationCoordinator';
import type {
  CollaborationRunReference,
  CollaborationRunSummary,
  CollaborationWriteMethod,
  CollaborationWriteRequest,
  CollaborationWriteResponse,
} from './types';

const BASE_REQUEST: SessionMutationRequest = {
  collaborationInstanceId: 'instance-1',
  runtimeId: 'instance-1',
  sessionKey: 'agent:main:desktop',
  sessionId: 'native-session-1',
  action: 'delete',
};

function activeRun(overrides: Partial<CollaborationRunSummary> = {}): CollaborationRunSummary {
  return {
    runId: 'run-1',
    status: 'RUNNING',
    dispatchState: 'OPEN',
    archiveState: 'ACTIVE',
    reconcileState: 'IDLE',
    completionOutcome: null,
    revision: 1,
    lastEventSequence: 0,
    goal: 'Complete the task',
    origin: {
      runtimeId: BASE_REQUEST.runtimeId,
      agentId: 'main',
      sessionKey: BASE_REQUEST.sessionKey,
      sessionId: BASE_REQUEST.sessionId,
      nativeMessageId: 'message-1',
    },
    currentPlanRevisionId: 'plan-1',
    allowedActions: ['CANCEL'],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function mutation(
  action: SessionMutationAction = BASE_REQUEST.action,
  overrides: Partial<ActiveSessionMutation> = {},
): ActiveSessionMutation {
  return {
    mutationId: 'mutation-1',
    runtimeId: BASE_REQUEST.runtimeId,
    sessionKey: BASE_REQUEST.sessionKey,
    sessionId: BASE_REQUEST.sessionId,
    action,
    policy: 'PROCEED',
    status: 'PREPARED',
    expiresAt: 120_000,
    result: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function impact(options: {
  request?: SessionMutationRequest;
  runs?: CollaborationRunSummary[];
  activeMutation?: ActiveSessionMutation | null;
  strategies?: string[];
  coreRpcAllowed?: boolean;
  runtimeMatches?: boolean;
} = {}): Record<string, unknown> {
  const request = options.request ?? BASE_REQUEST;
  const runs = options.runs ?? [];
  const activeMutation = options.activeMutation ?? null;
  return {
    runtimeId: request.runtimeId,
    sessionKey: request.sessionKey,
    sessionId: request.sessionId,
    action: request.action,
    activeRuns: runs.map((run) => ({ ...run, id: run.runId, runId: undefined })),
    blocked: runs.length > 0,
    runtimeMatches: options.runtimeMatches ?? true,
    activeMutation,
    mutationFenceActive: Boolean(activeMutation),
    recoveryRequired: activeMutation?.status === 'EXPIRED',
    coreRpcAllowed: options.coreRpcAllowed ?? false,
    resetCasSupported: false,
    strategies: options.strategies ?? (runs.length > 0
      ? ['CANCEL_AND_WAIT', 'STOP_AND_RETARGET_LATER', 'ABORT']
      : ['PROCEED']),
  };
}

interface WriteCall {
  method: CollaborationWriteMethod;
  request: CollaborationWriteRequest<any>;
}

interface Harness {
  coordinator: SessionMutationCoordinator;
  writes: WriteCall[];
  cancellations: Array<{ run: CollaborationRunReference; request: CollaborationWriteRequest<any> }>;
  deletes: Array<[string, true, string]>;
  resets: string[];
  describes: string[];
  impactParams: Array<Record<string, unknown>>;
  sleeps: number[];
  setCoreResult(value: unknown): void;
  setDescription(value: unknown): void;
  setImpactFailure(error: unknown): void;
  setWriteFailure(method: CollaborationWriteMethod, error: unknown): void;
  setCancellationFailure(runId: string, error: unknown): void;
}

function harness(impacts: Record<string, unknown>[]): Harness {
  const writes: WriteCall[] = [];
  const cancellations: Array<{ run: CollaborationRunReference; request: CollaborationWriteRequest<any> }> = [];
  const deletes: Array<[string, true, string]> = [];
  const resets: string[] = [];
  const describes: string[] = [];
  const impactParams: Array<Record<string, unknown>> = [];
  const sleeps: number[] = [];
  const failures = new Map<CollaborationWriteMethod, unknown>();
  const cancellationFailures = new Map<string, unknown>();
  let impactIndex = 0;
  let impactFailure: unknown;
  let now = 0;
  let coreResult: unknown = {
    success: true,
    key: BASE_REQUEST.sessionKey,
    deleted: true,
    entry: { sessionId: 'native-session-2' },
  };
  let descriptionResult: unknown = { session: { sessionId: BASE_REQUEST.sessionId } };

  const dependencies: SessionMutationCoordinatorDependencies = {
    getCollaborationInstanceId: async () => 'instance-1',
    readImpact: async (params) => {
      impactParams.push(params);
      if (impactFailure !== undefined) throw impactFailure;
      const selected = impacts[Math.min(impactIndex, impacts.length - 1)];
      impactIndex += 1;
      if (!selected) throw new Error('No impact response configured');
      return selected;
    },
    write: async <T extends Record<string, unknown>>(
      method: CollaborationWriteMethod,
      request: CollaborationWriteRequest<T>,
    ): Promise<CollaborationWriteResponse> => {
      writes.push({ method, request });
      if (failures.has(method)) throw failures.get(method);
      if (method === 'junqi.collab.session.mutation.prepare') {
        const preparedRuns = (impacts[0]?.activeRuns as unknown[] | undefined) ?? [];
        return {
          collaborationInstanceId: request.expectedCollaborationInstanceId,
          accepted: true,
          replayed: false,
          commandId: request.commandId,
          mutationId: 'mutation-1',
          status: 'PREPARED',
          expiresAt: 120_000,
          activeRuns: preparedRuns.map((value) => {
            const run = value as Record<string, unknown>;
            return { ...run, revision: Number(run.revision) + 1 };
          }),
          coreRpcAllowed: preparedRuns.length === 0 || request.policy === 'STOP_AND_RETARGET_LATER',
        };
      }
      const success = request.success === true;
      return {
        collaborationInstanceId: request.expectedCollaborationInstanceId,
        accepted: true,
        replayed: false,
        commandId: request.commandId,
        mutationId: request.mutationId,
        success,
        status: success ? 'COMPLETED' : 'FAILED',
      };
    },
    cancelRun: async (run, request) => {
      cancellations.push({ run, request });
      if (cancellationFailures.has(run.runId)) throw cancellationFailures.get(run.runId);
      return {
        collaborationInstanceId: request.expectedCollaborationInstanceId,
        accepted: true,
        replayed: false,
        commandId: request.commandId,
      };
    },
    deleteSession: async (sessionKey, deleteTranscript, expectedSessionId) => {
      deletes.push([sessionKey, deleteTranscript, expectedSessionId]);
      if (coreResult instanceof Error) throw coreResult;
      return coreResult;
    },
    resetSession: async (sessionKey) => {
      resets.push(sessionKey);
      if (coreResult instanceof Error) throw coreResult;
      return coreResult;
    },
    describeSession: async (sessionKey) => {
      describes.push(sessionKey);
      if (descriptionResult instanceof Error) throw descriptionResult;
      return descriptionResult;
    },
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    randomUUID: () => 'generated-id',
  };

  return {
    coordinator: new SessionMutationCoordinator(dependencies),
    writes,
    cancellations,
    deletes,
    resets,
    describes,
    impactParams,
    sleeps,
    setCoreResult(value) { coreResult = value; },
    setDescription(value) { descriptionResult = value; },
    setImpactFailure(error) { impactFailure = error; },
    setWriteFailure(method, error) {
      if (error === undefined) failures.delete(method);
      else failures.set(method, error);
    },
    setCancellationFailure(runId, error) { cancellationFailures.set(runId, error); },
  };
}

function assertCoordinatorError(code: SessionMutationCoordinatorError['code']) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof SessionMutationCoordinatorError);
    assert.equal(error.code, code);
    return true;
  };
}

test('inspectImpact sends the exact durable identity and returns authoritative impact', async () => {
  const run = activeRun();
  const testHarness = harness([impact({ runs: [run] })]);

  const result = await testHarness.coordinator.inspectImpact(BASE_REQUEST);

  assert.deepEqual(testHarness.impactParams, [{
    runtimeId: BASE_REQUEST.runtimeId,
    sessionKey: BASE_REQUEST.sessionKey,
    sessionId: BASE_REQUEST.sessionId,
    action: 'delete',
  }]);
  assert.equal(result.collaborationInstanceId, 'instance-1');
  assert.equal(result.activeRuns[0]?.runId, 'run-1');
  assert.deepEqual(result.strategies, ['CANCEL_AND_WAIT', 'STOP_AND_RETARGET_LATER', 'ABORT']);
});

test('inspectImpact fails closed before reading impact when the plugin instance changed', async () => {
  let impactReads = 0;
  const dependencies: SessionMutationCoordinatorDependencies = {
    getCollaborationInstanceId: async () => 'instance-2',
    readImpact: async () => { impactReads += 1; return {}; },
    write: async (_method, request) => ({
      collaborationInstanceId: request.expectedCollaborationInstanceId,
      accepted: true,
      replayed: false,
      commandId: 'unused',
    }),
    cancelRun: async () => {},
    deleteSession: async () => ({}),
    resetSession: async () => ({}),
    now: () => 0,
    sleep: async () => {},
    randomUUID: () => 'unused',
  };
  const coordinator = new SessionMutationCoordinator(dependencies);

  await assert.rejects(coordinator.inspectImpact(BASE_REQUEST), assertCoordinatorError('INSTANCE_MISMATCH'));
  assert.equal(impactReads, 0);
});

test('inspectImpact rejects a mismatched runtime even when the server flag is incorrectly true', async () => {
  const wrongRun = activeRun({
    origin: { ...activeRun().origin, runtimeId: 'runtime-other' },
  });
  const testHarness = harness([impact({ runs: [wrongRun], runtimeMatches: true })]);

  await assert.rejects(
    testHarness.coordinator.inspectImpact(BASE_REQUEST),
    assertCoordinatorError('SESSION_IDENTITY_MISMATCH'),
  );
});

test('inspectImpact routes injected raw responses through the shared fail-closed decoder', async () => {
  const malformed = impact({ strategies: ['PROCEED'] });
  malformed.strategies = ['PROCEED', 'PROCEED'];
  const testHarness = harness([malformed]);

  await assert.rejects(
    testHarness.coordinator.inspectImpact(BASE_REQUEST),
    (error: unknown) => {
      assert.ok(error instanceof SessionMutationCoordinatorError);
      assert.equal(error.code, 'INVALID_RESPONSE');
      assert.equal(error.details.path, 'response.strategies');
      return true;
    },
  );
});

test('inspectImpact maps typed client decoder failures to the coordinator error contract', async () => {
  const testHarness = harness([impact()]);
  testHarness.setImpactFailure(new CollaborationClientError(
    'INVALID_RESPONSE',
    'junqi.collab.session.mutationImpact returned an invalid response at response.sessionId',
    'junqi.collab.session.mutationImpact',
    { path: 'response.sessionId' },
  ));

  await assert.rejects(
    testHarness.coordinator.inspectImpact(BASE_REQUEST),
    (error: unknown) => {
      assert.ok(error instanceof SessionMutationCoordinatorError);
      assert.equal(error.code, 'SESSION_IDENTITY_MISMATCH');
      assert.equal(error.details.path, 'response.sessionId');
      assert.ok(error.originalError instanceof CollaborationClientError);
      return true;
    },
  );
});

test('execute rejects a strategy not offered by the authoritative impact without preparing', async () => {
  const testHarness = harness([impact({
    request: { ...BASE_REQUEST, action: 'reset' },
    runs: [activeRun()],
    strategies: ['CANCEL_AND_WAIT', 'ABORT'],
  })]);

  await assert.rejects(
    testHarness.coordinator.execute({ ...BASE_REQUEST, action: 'reset' }, 'STOP_AND_RETARGET_LATER'),
    assertCoordinatorError('UNSUPPORTED_STRATEGY'),
  );
  assert.equal(testHarness.writes.length, 0);
  assert.equal(testHarness.resets.length, 0);
});

test('ABORT returns without establishing a fence or calling the core RPC', async () => {
  const testHarness = harness([impact({ runs: [activeRun()], strategies: ['ABORT'] })]);

  const result = await testHarness.coordinator.execute(BASE_REQUEST, 'ABORT');

  assert.equal(result.status, 'ABORTED');
  assert.equal(result.success, false);
  assert.equal(result.mutationId, null);
  assert.equal(testHarness.writes.length, 0);
  assert.equal(testHarness.deletes.length, 0);
});

test('PROCEED deletes with expectedSessionId and reports success only after complete succeeds', async () => {
  const prepared = mutation('delete');
  const testHarness = harness([
    impact({ strategies: ['PROCEED'] }),
    impact({ activeMutation: prepared, strategies: ['PROCEED'], coreRpcAllowed: true }),
  ]);

  const result = await testHarness.coordinator.execute(
    { ...BASE_REQUEST, operationId: 'stable-operation' },
    'PROCEED',
  );

  assert.deepEqual(testHarness.deletes, [[BASE_REQUEST.sessionKey, true, BASE_REQUEST.sessionId]]);
  assert.equal(testHarness.resets.length, 0);
  assert.deepEqual(testHarness.writes.map((call) => call.method), [
    'junqi.collab.session.mutation.prepare',
    'junqi.collab.session.mutation.complete',
  ]);
  assert.equal(testHarness.writes[0]?.request.commandId, 'session-mutation:stable-operation:prepare');
  assert.equal(testHarness.writes[0]?.request.expectedCollaborationInstanceId, 'instance-1');
  assert.equal(testHarness.writes[1]?.request.commandId, 'session-mutation:stable-operation:complete');
  assert.equal(testHarness.writes[1]?.request.expectedCollaborationInstanceId, 'instance-1');
  assert.equal(testHarness.writes[1]?.request.runtimeId, 'instance-1');
  assert.equal(testHarness.writes[1]?.request.success, true);
  assert.equal(testHarness.writes[1]?.request.error, null);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.success, true);
  assert.equal(result.completion?.status, 'COMPLETED');
});

test('a PREPARED fence resumes its stored mutation and policy without preparing again', async () => {
  const run = activeRun();
  const prepared = mutation('delete', { policy: 'STOP_AND_RETARGET_LATER' });
  const preparedImpact = impact({
    runs: [run],
    activeMutation: prepared,
    strategies: ['PROCEED'],
    coreRpcAllowed: true,
  });
  const testHarness = harness([preparedImpact, preparedImpact]);

  const result = await testHarness.coordinator.execute(
    { ...BASE_REQUEST, operationId: 'resume-prepared' },
    'PROCEED',
  );

  assert.equal(result.strategy, 'STOP_AND_RETARGET_LATER');
  assert.equal(result.mutationId, 'mutation-1');
  assert.deepEqual(testHarness.writes.map((call) => call.method), [
    'junqi.collab.session.mutation.complete',
  ]);
  assert.equal(testHarness.writes[0]?.request.commandId, 'session-mutation:resume-prepared:complete');
  assert.equal(testHarness.cancellations.length, 0);
  assert.equal(testHarness.deletes.length, 1);
});

test('reset uses the non-CAS core method only after a prepared empty-session fence', async () => {
  const request = { ...BASE_REQUEST, action: 'reset' as const };
  const prepared = mutation('reset');
  const testHarness = harness([
    impact({ request, strategies: ['PROCEED'] }),
    impact({ request, activeMutation: prepared, strategies: ['PROCEED'], coreRpcAllowed: true }),
  ]);

  const result = await testHarness.coordinator.execute(request, 'PROCEED');

  assert.deepEqual(testHarness.resets, [BASE_REQUEST.sessionKey]);
  assert.equal(testHarness.deletes.length, 0);
  assert.equal(result.success, true);
});

test('CANCEL_AND_WAIT cancels every prepared run, polls until empty, and keeps stable commands', async () => {
  const runOne = activeRun({ runId: 'run-1', revision: 4 });
  const runTwo = activeRun({ runId: 'run-2', revision: 7 });
  const preparedMutation = mutation('reset', { policy: 'CANCEL_AND_WAIT' });
  const request = { ...BASE_REQUEST, action: 'reset' as const, operationId: 'cancel-op' };
  const testHarness = harness([
    impact({ request, runs: [runOne, runTwo], strategies: ['CANCEL_AND_WAIT', 'ABORT'] }),
    impact({ request, runs: [runOne], activeMutation: preparedMutation, strategies: ['CANCEL_AND_WAIT', 'ABORT'] }),
    impact({ request, activeMutation: preparedMutation, strategies: ['PROCEED'], coreRpcAllowed: true }),
  ]);

  const result = await testHarness.coordinator.execute(
    { ...request, timeoutMs: 20, pollIntervalMs: 5 },
    'CANCEL_AND_WAIT',
  );

  assert.deepEqual(testHarness.cancellations.map(({ run, request: cancellation }) => ({
    runId: run.runId,
    revision: cancellation.expectedRunRevision,
    commandId: cancellation.commandId,
  })), [
    { runId: 'run-1', revision: 5, commandId: 'session-mutation:cancel-op:cancel:run-1' },
    { runId: 'run-2', revision: 8, commandId: 'session-mutation:cancel-op:cancel:run-2' },
  ]);
  for (const { run } of testHarness.cancellations) {
    assert.equal('goal' in run, false);
    assert.equal('allowedActions' in run, false);
    assert.equal('lastEventSequence' in run, false);
  }
  assert.deepEqual(testHarness.sleeps, [5]);
  assert.deepEqual(testHarness.resets, [BASE_REQUEST.sessionKey]);
  assert.equal(result.success, true);

  for (const { request: cancellation } of testHarness.cancellations) {
    const { commandId: _commandId, payloadHash, ...payload } = cancellation;
    assert.equal(payloadHash, await hashCollaborationPayload(payload));
  }
});

test('CANCEL_AND_WAIT timeout preserves the prepared fence and never calls core or complete', async () => {
  const run = activeRun();
  const preparedMutation = mutation('reset', { policy: 'CANCEL_AND_WAIT' });
  const request = { ...BASE_REQUEST, action: 'reset' as const, operationId: 'timeout-op' };
  const stillRunning = impact({
    request,
    runs: [run],
    activeMutation: preparedMutation,
    strategies: ['CANCEL_AND_WAIT', 'ABORT'],
    coreRpcAllowed: false,
  });
  const testHarness = harness([
    impact({ request, runs: [run], strategies: ['CANCEL_AND_WAIT', 'ABORT'] }),
    stillRunning,
  ]);

  await assert.rejects(
    testHarness.coordinator.execute({ ...request, timeoutMs: 10, pollIntervalMs: 5 }, 'CANCEL_AND_WAIT'),
    (error: unknown) => {
      assert.ok(error instanceof SessionMutationCoordinatorError);
      assert.equal(error.code, 'CANCELLATION_TIMEOUT');
      assert.equal(error.details.mutationId, 'mutation-1');
      return true;
    },
  );
  assert.deepEqual(testHarness.writes.map((call) => call.method), [
    'junqi.collab.session.mutation.prepare',
  ]);
  assert.equal(testHarness.resets.length, 0);
  assert.deepEqual(testHarness.sleeps, [5, 5]);
});

test('CANCEL_AND_WAIT attempts every run and preserves the fence when one cancellation fails', async () => {
  const runOne = activeRun({ runId: 'run-1' });
  const runTwo = activeRun({ runId: 'run-2' });
  const request = { ...BASE_REQUEST, action: 'reset' as const, operationId: 'cancel-failure-op' };
  const testHarness = harness([
    impact({ request, runs: [runOne, runTwo], strategies: ['CANCEL_AND_WAIT', 'ABORT'] }),
  ]);
  testHarness.setCancellationFailure('run-1', new Error('cancel unavailable'));

  await assert.rejects(
    testHarness.coordinator.execute(request, 'CANCEL_AND_WAIT'),
    (error: unknown) => {
      assert.ok(error instanceof SessionMutationCoordinatorError);
      assert.equal(error.code, 'CANCELLATION_FAILED');
      assert.equal(error.details.mutationId, 'mutation-1');
      return true;
    },
  );
  assert.deepEqual(testHarness.cancellations.map(({ run }) => run.runId), ['run-1', 'run-2']);
  assert.deepEqual(testHarness.writes.map((call) => call.method), [
    'junqi.collab.session.mutation.prepare',
  ]);
  assert.equal(testHarness.resets.length, 0);
});

test('core RPC rejection is durably completed as failed before CORE_RPC_FAILED is reported', async () => {
  const prepared = mutation('delete');
  const testHarness = harness([
    impact({ strategies: ['PROCEED'] }),
    impact({ activeMutation: prepared, strategies: ['PROCEED'], coreRpcAllowed: true }),
  ]);
  testHarness.setCoreResult({ success: false, error: 'expectedSessionId mismatch', code: 'CONFLICT' });

  await assert.rejects(
    testHarness.coordinator.execute({ ...BASE_REQUEST, operationId: 'failed-core' }, 'PROCEED'),
    (error: unknown) => {
      assert.ok(error instanceof SessionMutationCoordinatorError);
      assert.equal(error.code, 'CORE_RPC_FAILED');
      assert.equal(error.details.mutationId, 'mutation-1');
      assert.equal(error.details.fenceReleased, true);
      assert.equal(error.committedResult, undefined);
      return true;
    },
  );
  const complete = testHarness.writes.at(-1);
  assert.equal(complete?.method, 'junqi.collab.session.mutation.complete');
  assert.equal(complete?.request.success, false);
  assert.equal((complete?.request.error as Record<string, unknown>).code, 'CORE_RPC_REJECTED');
});

test('an empty core RPC response is treated as a failure and never reports success', async () => {
  const prepared = mutation('delete');
  const testHarness = harness([
    impact({ strategies: ['PROCEED'] }),
    impact({ activeMutation: prepared, strategies: ['PROCEED'], coreRpcAllowed: true }),
  ]);
  testHarness.setCoreResult({});

  await assert.rejects(
    testHarness.coordinator.execute({ ...BASE_REQUEST, operationId: 'empty-core' }, 'PROCEED'),
    (error: unknown) => {
      assert.ok(error instanceof SessionMutationCoordinatorError);
      assert.equal(error.code, 'CORE_RPC_FAILED');
      return true;
    },
  );
  const complete = testHarness.writes.at(-1);
  assert.equal(complete?.method, 'junqi.collab.session.mutation.complete');
  assert.equal(complete?.request.success, false);
});

test('a mismatched key or unconfirmed delete effect is durably recorded as core failure', async () => {
  const responses = [
    { ok: true, key: 'agent:other:session', deleted: true },
    { ok: true, key: BASE_REQUEST.sessionKey, deleted: false },
  ];

  for (const [index, response] of responses.entries()) {
    const prepared = mutation('delete');
    const testHarness = harness([
      impact({ strategies: ['PROCEED'] }),
      impact({ activeMutation: prepared, strategies: ['PROCEED'], coreRpcAllowed: true }),
    ]);
    testHarness.setCoreResult(response);

    await assert.rejects(
      testHarness.coordinator.execute(
        { ...BASE_REQUEST, operationId: `invalid-core-proof-${index}` },
        'PROCEED',
      ),
      assertCoordinatorError('CORE_RPC_FAILED'),
    );
    const complete = testHarness.writes.at(-1);
    assert.equal(complete?.method, 'junqi.collab.session.mutation.complete');
    assert.equal(complete?.request.success, false);
  }
});

test('a lost reset acknowledgement is proven from the official replacement identity', async () => {
  const request = { ...BASE_REQUEST, action: 'reset' as const, operationId: 'ambiguous-reset' };
  const prepared = mutation('reset');
  const testHarness = harness([
    impact({ request, strategies: ['PROCEED'] }),
    impact({ request, activeMutation: prepared, strategies: ['PROCEED'], coreRpcAllowed: true }),
  ]);
  testHarness.setCoreResult(new Error('Request timeout (120000ms)'));
  testHarness.setDescription({ session: { key: request.sessionKey, sessionId: 'native-session-2' } });

  const result = await testHarness.coordinator.execute(request, 'PROCEED');

  assert.equal(result.success, true);
  assert.equal(result.coreMutationCommitted, true);
  assert.equal(result.resolvedSessionId, 'native-session-2');
  assert.deepEqual(testHarness.resets, [request.sessionKey]);
  assert.deepEqual(testHarness.describes, [request.sessionKey]);
  assert.equal(testHarness.writes.at(-1)?.request.success, true);
});

test('an unprovable core result keeps the fence and retry never replays the core RPC', async () => {
  const request = { ...BASE_REQUEST, action: 'reset' as const, operationId: 'unknown-reset' };
  const prepared = mutation('reset');
  const testHarness = harness([
    impact({ request, strategies: ['PROCEED'] }),
    impact({ request, activeMutation: prepared, strategies: ['PROCEED'], coreRpcAllowed: true }),
  ]);
  testHarness.setCoreResult(new Error('socket closed after request dispatch'));
  testHarness.setDescription(new Error('Gateway is not connected'));

  let pending: SessionMutationExecutionResult | undefined;
  await assert.rejects(
    testHarness.coordinator.execute(request, 'PROCEED'),
    (error: unknown) => {
      assert.ok(error instanceof SessionMutationCoordinatorError);
      assert.equal(error.code, 'CORE_RPC_OUTCOME_UNKNOWN');
      assert.equal(error.details.fenceReleased, false);
      pending = error.pendingResult;
      assert.equal(pending?.status, 'OUTCOME_PENDING');
      return true;
    },
  );
  assert.deepEqual(testHarness.writes.map((call) => call.method), [
    'junqi.collab.session.mutation.prepare',
  ]);

  testHarness.setDescription({ session: { key: request.sessionKey, sessionId: 'native-session-2' } });
  const result = await testHarness.coordinator.resolvePendingCoreMutation(request, pending!);

  assert.equal(result.success, true);
  assert.equal(result.resolvedSessionId, 'native-session-2');
  assert.deepEqual(testHarness.resets, [request.sessionKey]);
  assert.equal(testHarness.writes.at(-1)?.method, 'junqi.collab.session.mutation.complete');
  assert.equal(testHarness.writes.at(-1)?.request.success, true);
});

test('complete failure after a successful core RPC never reports mutation success', async () => {
  const prepared = mutation('delete');
  const testHarness = harness([
    impact({ strategies: ['PROCEED'] }),
    impact({ activeMutation: prepared, strategies: ['PROCEED'], coreRpcAllowed: true }),
  ]);
  testHarness.setWriteFailure(
    'junqi.collab.session.mutation.complete',
    new Error('connection closed before complete acknowledgement'),
  );

  await assert.rejects(
    testHarness.coordinator.execute(BASE_REQUEST, 'PROCEED'),
    (error: unknown) => {
      assert.ok(error instanceof SessionMutationCoordinatorError);
      assert.equal(error.code, 'COMPLETION_FAILED');
      assert.equal(error.details.coreRpcSucceeded, true);
      assert.equal(error.committedResult?.status, 'COMPLETION_PENDING');
      assert.equal(error.committedResult?.coreMutationCommitted, true);
      assert.equal(error.committedResult?.collaborationRecoveryRequired, true);
      assert.deepEqual(error.committedResult?.coreRpcResult, {
        success: true,
        key: BASE_REQUEST.sessionKey,
        deleted: true,
        entry: { sessionId: 'native-session-2' },
      });
      return true;
    },
  );
  assert.equal(testHarness.deletes.length, 1);
});

test('complete failure after a known core failure retries only the durable failure record', async () => {
  const prepared = mutation('delete');
  const testHarness = harness([
    impact({ strategies: ['PROCEED'] }),
    impact({ activeMutation: prepared, strategies: ['PROCEED'], coreRpcAllowed: true }),
  ]);
  testHarness.setCoreResult(new Error('OpenClaw rejected the delete request'));
  testHarness.setWriteFailure(
    'junqi.collab.session.mutation.complete',
    new Error('completion acknowledgement lost'),
  );

  let pending: NonNullable<SessionMutationCoordinatorError['pendingResult']> | undefined;
  await assert.rejects(
    testHarness.coordinator.execute(
      { ...BASE_REQUEST, operationId: 'stable-failure-completion' },
      'PROCEED',
    ),
    (error: unknown) => {
      assert.ok(error instanceof SessionMutationCoordinatorError);
      assert.equal(error.code, 'COMPLETION_FAILED');
      pending = error.pendingResult;
      assert.equal(pending?.status, 'FAILURE_COMPLETION_PENDING');
      assert.equal(pending?.coreMutationCommitted, false);
      return true;
    },
  );
  assert.equal(testHarness.deletes.length, 1);

  testHarness.setWriteFailure('junqi.collab.session.mutation.complete', undefined);
  await assert.rejects(
    testHarness.coordinator.resolvePendingCoreMutation(
      { ...BASE_REQUEST, operationId: 'stable-failure-completion' },
      pending!,
    ),
    assertCoordinatorError('CORE_RPC_FAILED'),
  );

  assert.equal(testHarness.deletes.length, 1);
  assert.equal(testHarness.describes.length, 1);
  assert.deepEqual(testHarness.writes.map((call) => call.method), [
    'junqi.collab.session.mutation.prepare',
    'junqi.collab.session.mutation.complete',
    'junqi.collab.session.mutation.complete',
  ]);
  assert.equal(testHarness.writes[1]?.request.commandId, 'session-mutation:stable-failure-completion:complete');
  assert.equal(testHarness.writes[2]?.request.commandId, 'session-mutation:stable-failure-completion:complete');
  assert.equal(testHarness.writes[2]?.request.success, false);
});

test('a known committed result retries only complete with the original operation id', async () => {
  const prepared = mutation('delete');
  const testHarness = harness([
    impact({ strategies: ['PROCEED'] }),
    impact({ activeMutation: prepared, strategies: ['PROCEED'], coreRpcAllowed: true }),
  ]);
  testHarness.setWriteFailure(
    'junqi.collab.session.mutation.complete',
    new Error('completion acknowledgement lost'),
  );

  let committed: NonNullable<SessionMutationCoordinatorError['committedResult']> | undefined;
  await assert.rejects(
    testHarness.coordinator.execute(
      { ...BASE_REQUEST, operationId: 'stable-completion' },
      'PROCEED',
    ),
    (error: unknown) => {
      assert.ok(error instanceof SessionMutationCoordinatorError);
      committed = error.committedResult;
      assert.ok(committed);
      return true;
    },
  );

  await assert.rejects(
    testHarness.coordinator.completeCommittedMutation(
      { ...BASE_REQUEST, operationId: 'different-completion' },
      committed!,
    ),
    assertCoordinatorError('INVALID_REQUEST'),
  );
  assert.equal(testHarness.deletes.length, 1);
  assert.equal(testHarness.writes.length, 2);

  testHarness.setWriteFailure('junqi.collab.session.mutation.complete', undefined);
  const result = await testHarness.coordinator.completeCommittedMutation(
    { ...BASE_REQUEST, operationId: 'stable-completion' },
    committed!,
  );

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.success, true);
  assert.equal(result.collaborationRecoveryRequired, false);
  assert.equal(testHarness.deletes.length, 1);
  assert.deepEqual(testHarness.writes.map((call) => call.method), [
    'junqi.collab.session.mutation.prepare',
    'junqi.collab.session.mutation.complete',
    'junqi.collab.session.mutation.complete',
  ]);
  assert.equal(testHarness.writes[1]?.request.commandId, 'session-mutation:stable-completion:complete');
  assert.equal(testHarness.writes[2]?.request.commandId, 'session-mutation:stable-completion:complete');
});

test('RECOVER closes an expired fence as unknown without replaying the core RPC', async () => {
  const expired = mutation('delete', {
    status: 'EXPIRED',
    policy: 'PROCEED',
    result: { reason: 'LEASE_EXPIRED' },
  });
  const testHarness = harness([impact({
    activeMutation: expired,
    strategies: ['RECOVER'],
    coreRpcAllowed: false,
  })]);
  testHarness.setDescription(new Error('Gateway unavailable'));

  const result = await testHarness.coordinator.execute(
    { ...BASE_REQUEST, operationId: 'recover-op' },
    'RECOVER',
  );

  assert.equal(result.status, 'RECOVERED');
  assert.equal(result.success, false);
  assert.equal(testHarness.deletes.length, 0);
  assert.deepEqual(testHarness.writes.map((call) => call.method), [
    'junqi.collab.session.mutation.complete',
  ]);
  assert.equal(testHarness.writes[0]?.request.commandId, 'session-mutation:recover-op:complete');
  assert.equal(testHarness.writes[0]?.request.success, false);
  assert.equal((testHarness.writes[0]?.request.error as Record<string, unknown>).code, 'CORE_RPC_OUTCOME_UNKNOWN');
});

test('RECOVER records a proven expired delete as successful without replaying delete', async () => {
  const expired = mutation('delete', {
    status: 'EXPIRED',
    policy: 'PROCEED',
    result: { reason: 'LEASE_EXPIRED' },
  });
  const testHarness = harness([impact({
    activeMutation: expired,
    strategies: ['RECOVER'],
    coreRpcAllowed: false,
  })]);
  testHarness.setDescription({ session: null });

  const result = await testHarness.coordinator.execute(
    { ...BASE_REQUEST, operationId: 'recover-committed-delete' },
    'RECOVER',
  );

  assert.equal(result.status, 'RECOVERED');
  assert.equal(result.success, true);
  assert.equal(result.coreMutationCommitted, true);
  assert.equal(testHarness.deletes.length, 0);
  assert.equal(testHarness.writes[0]?.request.success, true);
  assert.equal(testHarness.writes[0]?.request.error, null);
});
