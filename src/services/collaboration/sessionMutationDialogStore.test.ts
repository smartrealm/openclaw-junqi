import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type {
  SessionMutationExecutionResult,
  SessionMutationRequest,
} from './SessionMutationCoordinator';
import {
  reportSessionCoreCommit,
  requestSessionMutationDialog,
  resetSessionMutationDialogStoreForTests,
  settleSessionMutationDialog,
  useSessionMutationDialogStore,
} from './sessionMutationDialogStore';

const first: SessionMutationRequest = {
  collaborationInstanceId: 'instance-1',
  runtimeId: 'instance-1',
  sessionKey: 'agent:main:first',
  sessionId: 'session-1',
  action: 'reset',
};

beforeEach(resetSessionMutationDialogStoreForTests);

function pendingCompletion(
  request: SessionMutationRequest,
  operationId: string,
): SessionMutationExecutionResult {
  return {
    operationId,
    action: request.action,
    strategy: 'PROCEED',
    status: 'COMPLETION_PENDING',
    success: false,
    coreMutationCommitted: true,
    collaborationRecoveryRequired: true,
    mutationId: 'mutation-1',
    impact: {
      ...request,
      activeRuns: [],
      blocked: false,
      runtimeMatches: true,
      activeMutation: null,
      mutationFenceActive: false,
      recoveryRequired: false,
      coreRpcAllowed: true,
      resetCasSupported: false,
      strategies: ['PROCEED'],
    },
  };
}

function completedRecovery(
  pending: SessionMutationExecutionResult,
): SessionMutationExecutionResult {
  return {
    ...pending,
    status: 'COMPLETED',
    success: true,
    collaborationRecoveryRequired: false,
    completion: {
      collaborationInstanceId: pending.impact.collaborationInstanceId,
      accepted: true,
      replayed: true,
      commandId: `session-mutation:${pending.operationId}:complete`,
      mutationId: pending.mutationId,
      success: true,
      status: 'COMPLETED',
    },
  };
}

test('deduplicates the same native session mutation while its dialog is pending', async () => {
  const left = requestSessionMutationDialog(first);
  const right = requestSessionMutationDialog({ ...first });
  assert.equal(left, right);

  const current = useSessionMutationDialogStore.getState().current;
  assert.ok(current);
  assert.match(current.operationId, /^operation-/);
  assert.equal(useSessionMutationDialogStore.getState().current?.operationId, current.operationId);
  settleSessionMutationDialog(current.id, null);
  assert.equal(await left, null);
});

test('serializes mutations for different sessions', async () => {
  const firstResult = requestSessionMutationDialog(first);
  const secondResult = requestSessionMutationDialog({
    ...first,
    sessionKey: 'agent:main:second',
    sessionId: 'session-2',
  });

  const firstEntry = useSessionMutationDialogStore.getState().current;
  assert.equal(firstEntry?.request.sessionId, 'session-1');
  settleSessionMutationDialog(firstEntry!.id, null);
  await firstResult;
  await new Promise<void>((resolve) => queueMicrotask(resolve));

  const secondEntry = useSessionMutationDialogStore.getState().current;
  assert.equal(secondEntry?.request.sessionId, 'session-2');
  settleSessionMutationDialog(secondEntry!.id, null);
  await secondResult;
});

test('ignores stale dialog completion attempts', async () => {
  const result = requestSessionMutationDialog(first);
  const current = useSessionMutationDialogStore.getState().current;
  assert.ok(current);
  assert.equal(settleSessionMutationDialog('stale-entry', null), false);
  assert.equal(useSessionMutationDialogStore.getState().current?.id, current.id);
  settleSessionMutationDialog(current.id, null);
  await result;
});

test('reports a committed core deletion without dismissing its recovery dialog', async () => {
  const deletion = { ...first, action: 'delete' as const };
  const result = requestSessionMutationDialog(deletion);
  const current = useSessionMutationDialogStore.getState().current;
  assert.ok(current);

  const committed = pendingCompletion(deletion, current.operationId);
  assert.equal(reportSessionCoreCommit(current.id, committed), true);
  assert.equal(await result, committed);
  assert.equal(useSessionMutationDialogStore.getState().current?.id, current.id);
  assert.equal(useSessionMutationDialogStore.getState().current?.committedResult, committed);

  const duplicate = requestSessionMutationDialog({ ...deletion });
  assert.equal(duplicate, result);
  assert.equal(await duplicate, committed);

  assert.equal(settleSessionMutationDialog(current.id, null), false);
  assert.equal(settleSessionMutationDialog(current.id, completedRecovery(committed)), true);
  assert.equal(useSessionMutationDialogStore.getState().current, null);
});

test('rejects a committed result from another operation on the same native session', async () => {
  const result = requestSessionMutationDialog(first);
  const current = useSessionMutationDialogStore.getState().current;
  assert.ok(current);

  const wrongOperation = pendingCompletion(first, 'operation-other');
  assert.equal(reportSessionCoreCommit(current.id, wrongOperation), false);
  assert.equal(useSessionMutationDialogStore.getState().current?.committedResult, null);

  settleSessionMutationDialog(current.id, null);
  assert.equal(await result, null);
});

test('rejects a core commit report for a different native session identity', async () => {
  const deletion = { ...first, action: 'delete' as const };
  const result = requestSessionMutationDialog(deletion);
  const current = useSessionMutationDialogStore.getState().current;
  assert.ok(current);

  const mismatched = pendingCompletion(deletion, current.operationId);
  mismatched.impact = { ...mismatched.impact, sessionId: 'other-session' };
  assert.equal(reportSessionCoreCommit(current.id, mismatched), false);

  settleSessionMutationDialog(current.id, null);
  assert.equal(await result, null);
});

test('reports a committed reset while retaining the send gate until recovery closes', async () => {
  const result = requestSessionMutationDialog(first);
  const current = useSessionMutationDialogStore.getState().current;
  assert.ok(current);

  const committed = pendingCompletion(first, current.operationId);
  assert.equal(reportSessionCoreCommit(current.id, committed), true);
  assert.equal(await result, committed);
  const { sessionMutationGate } = await import('@/services/chat/sessionMutationGate');
  assert.equal(sessionMutationGate.isBlocked(first.sessionKey), true);
  assert.equal(settleSessionMutationDialog(current.id, null), false);
  assert.equal(sessionMutationGate.isBlocked(first.sessionKey), true);
  assert.equal(settleSessionMutationDialog(current.id, completedRecovery(committed)), true);
  assert.equal(sessionMutationGate.isBlocked(first.sessionKey), false);
});
