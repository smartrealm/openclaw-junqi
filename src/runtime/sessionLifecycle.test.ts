import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import type { CollaborationCapabilities } from '@/types/collaboration';
import type {
  SessionMutationExecutionResult,
  SessionMutationRequest,
} from '@/services/collaboration/SessionMutationCoordinator';
import {
  executeSessionLifecycleMutation,
  isCollaborationMethodUnavailable,
  setSessionLifecycleDependenciesForTests,
} from './sessionLifecycle';

const KEY = 'agent:main:lifecycle-test';

const capabilities: CollaborationCapabilities = {
  collaborationInstanceId: 'instance-1',
  schemaVersion: 2,
  durableRuntime: true,
  configured: true,
  configuredAgents: [],
  coordinatorAgentId: null,
  allowedAgentIds: [],
  repairs: [],
  sessionCapabilities: {
    deleteExpectedSessionId: true,
    resetExpectedSessionId: false,
  },
};

function completed(request: SessionMutationRequest): SessionMutationExecutionResult {
  return {
    operationId: 'operation-1',
    action: request.action,
    strategy: 'PROCEED',
    status: 'COMPLETED',
    success: true,
    coreMutationCommitted: true,
    collaborationRecoveryRequired: false,
    mutationId: 'mutation-1',
    impact: {
      ...request,
      activeRuns: [],
      activeMutation: null,
      blocked: false,
      runtimeMatches: true,
      mutationFenceActive: false,
      recoveryRequired: false,
      coreRpcAllowed: false,
      resetCasSupported: false,
      strategies: ['PROCEED'],
    },
  };
}

beforeEach(() => {
  useChatStore.setState({
    sessions: [{ key: KEY, sessionId: 'session-1', label: 'Lifecycle' }],
    typingBySession: {},
    sendingBySession: {},
  });
  useGatewayDataStore.setState({ sessions: [] });
  setSessionLifecycleDependenciesForTests();
});

test('routes an installed collaboration runtime through the global impact dialog', async () => {
  const requests: SessionMutationRequest[] = [];
  setSessionLifecycleDependenciesForTests({
    bootstrapCollaboration: async () => capabilities,
    requestDialog: async (request) => {
      requests.push(request);
      return completed(request);
    },
  });

  const result = await executeSessionLifecycleMutation(KEY, 'delete');
  assert.equal(result.success, true);
  assert.equal(result.coordinated, true);
  assert.deepEqual(requests, [{
    collaborationInstanceId: 'instance-1',
    runtimeId: 'instance-1',
    sessionKey: KEY,
    sessionId: 'session-1',
    action: 'delete',
  }]);
});

test('reports a verified core deletion as successful while collaboration bookkeeping awaits recovery', async () => {
  setSessionLifecycleDependenciesForTests({
    bootstrapCollaboration: async () => capabilities,
    requestDialog: async (request) => ({
      ...completed(request),
      status: 'COMPLETION_PENDING',
      success: false,
      coreMutationCommitted: true,
      collaborationRecoveryRequired: true,
    }),
  });

  const result = await executeSessionLifecycleMutation(KEY, 'delete');

  assert.equal(result.success, true);
  assert.equal(result.cancelled, false);
  assert.equal(result.coordinated, true);
  assert.equal(result.collaborationRecoveryRequired, true);
  assert.equal(result.result?.status, 'COMPLETION_PENDING');
});

test('uses the official native deletion RPC when collaboration is not installed', async () => {
  const calls: unknown[][] = [];
  setSessionLifecycleDependenciesForTests({
    bootstrapCollaboration: async () => {
      throw { code: 'INVALID_REQUEST', message: 'unknown method: junqi.collab.capabilities' };
    },
    deleteSession: async (...args) => {
      calls.push(args);
      return { success: true, key: KEY, deleted: true };
    },
  });

  const result = await executeSessionLifecycleMutation(KEY, 'delete');

  assert.equal(result.success, true);
  assert.equal(result.coordinated, false);
  assert.deepEqual(calls, [[KEY, true, 'session-1']]);
});

test('stops a pending Gateway send before a native session reset', async () => {
  const steps: string[] = [];
  useChatStore.setState({ typingBySession: { [KEY]: true } });
  setSessionLifecycleDependenciesForTests({
    bootstrapCollaboration: async () => {
      throw { code: 'INVALID_REQUEST', message: 'unknown method: junqi.collab.capabilities' };
    },
    abortChat: async (sessionKey, sessionId) => {
      steps.push(`abort:${sessionKey}:${sessionId}`);
    },
    resetSession: async (sessionKey) => {
      steps.push(`reset:${sessionKey}`);
      return { success: true, key: sessionKey, entry: { sessionId: 'session-2' } };
    },
  });

  const result = await executeSessionLifecycleMutation(KEY, 'reset');

  assert.equal(result.success, true);
  assert.deepEqual(steps, [
    `abort:${KEY}:session-1`,
    `reset:${KEY}`,
  ]);
});

test('coordinates reset through the installed collaboration runtime without requiring a nonstandard CAS flag', async () => {
  const requests: SessionMutationRequest[] = [];
  setSessionLifecycleDependenciesForTests({
    bootstrapCollaboration: async () => capabilities,
    requestDialog: async (request) => {
      requests.push(request);
      return completed(request);
    },
  });

  const result = await executeSessionLifecycleMutation(KEY, 'reset');

  assert.equal(result.success, true);
  assert.equal(result.coordinated, true);
  assert.equal(requests[0]?.action, 'reset');
});

test('does not bypass collaboration on a transient capability failure', async () => {
  setSessionLifecycleDependenciesForTests({
    bootstrapCollaboration: async () => { throw new Error('Gateway connection closed'); },
  });

  await assert.rejects(executeSessionLifecycleMutation(KEY, 'delete'), /Gateway connection closed/);
});

test('does not treat a null capability response as collaboration absence', async () => {
  setSessionLifecycleDependenciesForTests({
    bootstrapCollaboration: async () => null as unknown as CollaborationCapabilities,
  });

  await assert.rejects(
    executeSessionLifecycleMutation(KEY, 'delete'),
    /capabilities returned an invalid response/i,
  );
});

test('allows official native reset without a locally cached session identity', async () => {
  useChatStore.setState({ sessions: [{ key: KEY, label: 'No identity' }] });
  let resetCalls = 0;
  setSessionLifecycleDependenciesForTests({
    bootstrapCollaboration: async () => {
      throw { code: 'INVALID_REQUEST', message: 'unknown method: junqi.collab.capabilities' };
    },
    listSessions: async () => ({ sessions: [{ key: KEY }] }),
    resetSession: async () => {
      resetCalls += 1;
      return { success: true, key: KEY, entry: { sessionId: 'session-2' } };
    },
  });

  const result = await executeSessionLifecycleMutation(KEY, 'reset');
  assert.equal(result.success, true);
  assert.equal(result.sessionId, 'session-2');
  assert.equal(result.previousSessionId, null);
  assert.equal(resetCalls, 1);
});

test('recognizes only the official exact missing-method error', () => {
  assert.equal(isCollaborationMethodUnavailable({
    originalError: { error: { code: 'INVALID_REQUEST', message: 'unknown method: junqi.collab.capabilities' } },
  }), false);
  assert.equal(isCollaborationMethodUnavailable(new Error('junqi.collab.capabilities temporarily unavailable')), false);
  assert.equal(isCollaborationMethodUnavailable({
    code: 'INVALID_REQUEST',
    message: 'unknown method: junqi.collab.capabilities',
  }), true);
  assert.equal(isCollaborationMethodUnavailable({
    code: 'INVALID_REQUEST',
    message: 'unknown method: sessions.reset',
  }), false);
  assert.equal(isCollaborationMethodUnavailable({
    code: 'METHOD_NOT_FOUND',
    message: 'unknown method: junqi.collab.capabilities',
  }), false);
  assert.equal(isCollaborationMethodUnavailable({
    code: 'INVALID_REQUEST',
    message: 'Unknown method: junqi.collab.capabilities',
  }), false);
});
