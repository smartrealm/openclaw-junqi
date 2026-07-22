import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawSessionRunReconciler,
  resolveOpenClawSessionRun,
} from './OpenClawSessionRunResolver';

test('resolves an out-of-page session through official describe and history RPCs', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const result = await resolveOpenClawSessionRun(async (method, params) => {
    calls.push({ method, params });
    return method === 'sessions.describe'
      ? { session: { key: 'session-a' } }
      : {
          sessionInfo: { hasActiveRun: true, activeRunIds: ['run-a'] },
          inFlightRun: { runId: 'run-a', text: 'buffered answer' },
        };
  }, 'session-a');

  assert.deepEqual(calls, [
    { method: 'sessions.describe', params: { key: 'session-a' } },
    { method: 'chat.history', params: { sessionKey: 'session-a', limit: 50 } },
  ]);
  assert.deepEqual(result, {
    state: 'history',
    response: {
      sessionInfo: { hasActiveRun: true, activeRunIds: ['run-a'] },
      inFlightRun: { runId: 'run-a', text: 'buffered answer' },
    },
  });
});

test('a missing described session settles without requesting history', async () => {
  const calls: string[] = [];
  const result = await resolveOpenClawSessionRun(async (method) => {
    calls.push(method);
    return { session: null };
  }, 'session-missing');

  assert.deepEqual(result, { state: 'missing' });
  assert.deepEqual(calls, ['sessions.describe']);
});

test('malformed official responses remain unknown', async () => {
  assert.deepEqual(
    await resolveOpenClawSessionRun(async () => ({ ok: true }), 'session-a'),
    { state: 'unknown' },
  );
});

test('the keyed reconciler reruns a coalesced request after its first observation becomes stale', async () => {
  let connectionId = 'connection-a';
  let observation = 1;
  let releaseDescribe!: (value: unknown) => void;
  const describe = new Promise<unknown>((resolve) => { releaseDescribe = resolve; });
  const applied: string[] = [];
  const reconciler = new OpenClawSessionRunReconciler({
    captureConnectionId: () => connectionId,
    isConnectionCurrent: (expected) => expected === connectionId,
    requestFenced: async (method) => (
      method === 'sessions.describe'
        ? describe
        : { sessionInfo: { hasActiveRun: false, activeRunIds: [] } }
    ),
    captureObservation: () => observation,
    isObservationCurrent: (expected) => expected === observation,
    applyMissing: () => applied.push('missing'),
    applyHistory: () => applied.push('history'),
  });

  const first = reconciler.reconcile('session-a');
  const duplicate = reconciler.reconcile('session-a');
  assert.equal(first, duplicate);
  connectionId = 'connection-b';
  observation = 2;
  releaseDescribe({ session: null });
  await first;

  assert.deepEqual(applied, ['missing']);
});

test('a failed single-flight lookup is released for a later retry', async () => {
  let attempt = 0;
  const errors: unknown[] = [];
  const applied: string[] = [];
  const reconciler = new OpenClawSessionRunReconciler({
    captureConnectionId: () => 'connection-a',
    isConnectionCurrent: () => true,
    requestFenced: async (method) => {
      if (method === 'sessions.describe' && attempt++ === 0) throw new Error('temporary failure');
      return method === 'sessions.describe'
        ? { session: { key: 'session-a' } }
        : { sessionInfo: { hasActiveRun: false, activeRunIds: [] } };
    },
    captureObservation: () => 1,
    isObservationCurrent: () => true,
    applyMissing: () => applied.push('missing'),
    applyHistory: () => applied.push('history'),
    onError: (_sessionKey, error) => errors.push(error),
  });

  await reconciler.reconcile('session-a');
  await reconciler.reconcile('session-a');

  assert.equal(errors.length, 1);
  assert.deepEqual(applied, ['history']);
});
