import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError, GatewayRpcError } from './Connection';
import {
  OpenClawProviderUsageClient,
  OpenClawProviderUsageResponseError,
  OpenClawProviderUsageUnavailableError,
  parseOpenClawProviderUsage,
} from './OpenClawProviderUsageClient';

const response = {
  updatedAt: 1_700_000_000_000,
  providers: [{
    provider: 'openai',
    displayName: 'OpenAI',
    windows: [{ label: '5h', usedPercent: 20.5, resetAt: 1_700_000_600_000 }],
    accountEmail: 'operator@example.test',
    plan: 'private',
    billing: [{ type: 'balance', amount: 42, unit: 'USD' }],
    error: 'credential failed for OPENAI_API_KEY',
    costHistory: { unit: 'USD', periodDays: 30, daily: [] },
  }],
};

test('OpenClawProviderUsageClient fences and projects only provider quota windows', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawProviderUsageClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return response;
    },
  });

  const snapshot = await client.get();

  assert.deepEqual(calls, [{ method: 'usage.status', params: {}, connectionId: 'gateway-a' }]);
  assert.deepEqual(snapshot, {
    updatedAt: 1_700_000_000_000,
    providers: [{
      provider: 'openai',
      displayName: 'OpenAI',
      windows: [{ label: '5h', usedPercent: 20.5, resetAt: 1_700_000_600_000 }],
    }],
  });
  assert.equal(JSON.stringify(snapshot).includes('operator@example.test'), false);
  assert.equal(JSON.stringify(snapshot).includes('OPENAI_API_KEY'), false);
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  assert.equal(JSON.stringify(snapshot).includes('balance'), false);
});

test('OpenClawProviderUsageClient rejects malformed quota windows', () => {
  assert.throws(() => parseOpenClawProviderUsage({ ...response, updatedAt: -1 }), OpenClawProviderUsageResponseError);
  assert.throws(() => parseOpenClawProviderUsage({
    ...response,
    providers: [{ ...response.providers[0], windows: [{ label: '5h', usedPercent: 101 }] }],
  }), OpenClawProviderUsageResponseError);
  assert.throws(() => parseOpenClawProviderUsage({
    ...response,
    providers: [{ ...response.providers[0], windows: [{ label: '5h', usedPercent: 10, resetAt: 'soon' }] }],
  }), OpenClawProviderUsageResponseError);
});

test('OpenClawProviderUsageClient attempts omitted methods and maps connection failures', async () => {
  let omittedMethodSent = false;
  const unavailable = new OpenClawProviderUsageClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async (method) => {
      omittedMethodSent = true;
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    },
  });
  const missing = new OpenClawProviderUsageClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async (method) => {
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    },
  });
  const disconnected = new OpenClawProviderUsageClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => { throw new GatewayDisconnectedError(); },
  });

  await assert.rejects(unavailable.get(), OpenClawProviderUsageUnavailableError);
  await assert.rejects(missing.get(), OpenClawProviderUsageUnavailableError);
  await assert.rejects(disconnected.get(), OpenClawProviderUsageUnavailableError);
  assert.equal(omittedMethodSent, true);
});

test('OpenClawProviderUsageClient discards a quota response after the Gateway changes', async () => {
  let current = true;
  const client = new OpenClawProviderUsageClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => current,
    requestFenced: async () => {
      current = false;
      return response;
    },
  });

  await assert.rejects(client.get(), OpenClawProviderUsageUnavailableError);
});
