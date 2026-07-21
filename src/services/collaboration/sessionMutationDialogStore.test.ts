import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { SessionMutationRequest } from './SessionMutationCoordinator';
import {
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

test('deduplicates the same native session mutation while its dialog is pending', async () => {
  const left = requestSessionMutationDialog(first);
  const right = requestSessionMutationDialog({ ...first });
  assert.equal(left, right);

  const current = useSessionMutationDialogStore.getState().current;
  assert.ok(current);
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
