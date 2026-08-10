import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError, GatewayRpcError } from './Connection';
import {
  OpenClawAgentWaitClient,
  OpenClawAgentWaitResponseError,
  OpenClawAgentWaitUnavailableError,
  parseOpenClawAgentWaitResult,
} from './OpenClawAgentWaitClient';

test('agent.wait checks the exact run without waiting for new work', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawAgentWaitClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return { runId: 'run-1', status: 'ok', untrusted: 'ignored' };
    },
  });

  assert.deepEqual(await client.check(' run-1 '), { runId: 'run-1', status: 'ok' });
  assert.deepEqual(calls, [{
    method: 'agent.wait',
    params: { runId: 'run-1', timeoutMs: 0 },
    connectionId: 'gateway-a',
  }]);
});

test('agent.wait rejects malformed or mismatched run outcomes', async () => {
  assert.throws(() => parseOpenClawAgentWaitResult({ runId: '', status: 'ok' }), OpenClawAgentWaitResponseError);
  assert.throws(() => parseOpenClawAgentWaitResult({ runId: 'run-1', status: 'pending' }), OpenClawAgentWaitResponseError);

  const client = new OpenClawAgentWaitClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => ({ runId: 'other-run', status: 'ok' }),
  });
  await assert.rejects(client.check('run-1'), OpenClawAgentWaitResponseError);
});

test('agent.wait preserves timeout as non-terminal and fails closed on unavailable transport', async () => {
  const timeout = new OpenClawAgentWaitClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => ({ runId: 'run-1', status: 'timeout' }),
  });
  const unavailable = new OpenClawAgentWaitClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async (method) => {
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    },
  });
  const disconnected = new OpenClawAgentWaitClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => { throw new GatewayDisconnectedError(); },
  });

  assert.deepEqual(await timeout.check('run-1'), { runId: 'run-1', status: 'timeout' });
  await assert.rejects(unavailable.check('run-1'), OpenClawAgentWaitUnavailableError);
  await assert.rejects(disconnected.check('run-1'), OpenClawAgentWaitUnavailableError);
});
