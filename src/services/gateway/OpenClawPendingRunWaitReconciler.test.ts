import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenClawPendingRunWaitReconciler } from './OpenClawPendingRunWaitReconciler';

function uncertainObservation(sessionKey = 'agent:main:session-a', runId = 'run-a') {
  return {
    sessionKey,
    activeRunId: null,
    activeRunGeneration: null,
    hasActiveRun: false,
    typingStartedAt: 1,
    pendingRunId: runId,
    pendingRunGeneration: 1,
    pendingRunPhase: 'uncertain' as const,
  };
}

test('pending Run wait applies only an exact terminal result for the current observation', async () => {
  const observation = uncertainObservation();
  const calls: Array<{ runId: string; connectionId: string }> = [];
  const applied: Array<{ sessionKey: string; runId: string }> = [];
  const reconciler = new OpenClawPendingRunWaitReconciler({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    checkRunForConnection: async (runId, connectionId) => {
      calls.push({ runId, connectionId });
      return { runId, status: 'error' };
    },
    captureObservation: () => observation,
    isObservationCurrent: (candidate) => candidate === observation,
    applyTerminal: (sessionKey, runId) => {
      applied.push({ sessionKey, runId });
      return true;
    },
  });

  assert.equal(await reconciler.reconcile(observation.sessionKey), true);
  assert.deepEqual(calls, [{ runId: 'run-a', connectionId: 'gateway-a' }]);
  assert.deepEqual(applied, [{ sessionKey: observation.sessionKey, runId: 'run-a' }]);
});

test('pending Run wait leaves timeout and stale observations for history reconciliation', async () => {
  let observation = uncertainObservation();
  let release!: (value: { runId: string; status: 'ok' }) => void;
  const response = new Promise<{ runId: string; status: 'ok' }>((resolve) => { release = resolve; });
  const applied: string[] = [];
  const reconciler = new OpenClawPendingRunWaitReconciler({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    checkRunForConnection: async () => response,
    captureObservation: () => observation,
    isObservationCurrent: (candidate) => candidate === observation,
    applyTerminal: (_sessionKey, runId) => {
      applied.push(runId);
      return true;
    },
  });

  const pending = reconciler.reconcile(observation.sessionKey);
  observation = uncertainObservation('agent:main:session-a', 'run-b');
  release({ runId: 'run-a', status: 'ok' });

  assert.equal(await pending, false);
  assert.equal(applied.length, 0);

  const timedOut = new OpenClawPendingRunWaitReconciler({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    checkRunForConnection: async (runId) => ({ runId, status: 'timeout' }),
    captureObservation: () => observation,
    isObservationCurrent: () => true,
    applyTerminal: (_sessionKey, runId) => {
      applied.push(runId);
      return true;
    },
  });
  assert.equal(await timedOut.reconcile(observation.sessionKey), false);
  assert.equal(applied.length, 0);
});
