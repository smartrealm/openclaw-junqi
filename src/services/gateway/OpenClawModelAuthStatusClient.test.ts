import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError, GatewayRpcError } from './Connection';
import {
  OpenClawModelAuthStatusClient,
  OpenClawModelAuthStatusResponseError,
  OpenClawModelAuthStatusUnavailableError,
  parseOpenClawModelAuthStatus,
} from './OpenClawModelAuthStatusClient';

const response = {
  ts: 1_700_000_000_000,
  providers: [{
    provider: 'openai',
    displayName: 'OpenAI',
    status: 'expiring',
    expiry: { at: 1_700_000_600_000, remainingMs: 600_000, label: '10m' },
    apiKey: { source: 'env', envVar: 'OPENAI_API_KEY' },
    usage: { accountEmail: 'operator@example.test', plan: 'private' },
    profiles: [{
      profileId: 'openai:default',
      type: 'oauth',
      status: 'expiring',
      expiry: { at: 1_700_000_600_000, remainingMs: 600_000, label: '10m' },
      reasonCode: 'token-expiring',
    }],
  }],
};

test('OpenClawModelAuthStatusClient fences and projects only non-secret authentication health', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawModelAuthStatusClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    hasAdvertisedMethod: () => true,
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return response;
    },
  });

  const snapshot = await client.get();

  assert.deepEqual(calls, [{ method: 'models.authStatus', params: {}, connectionId: 'gateway-a' }]);
  assert.deepEqual(snapshot, {
    timestampMs: 1_700_000_000_000,
    providers: [{
      provider: 'openai',
      displayName: 'OpenAI',
      status: 'expiring',
      expiry: { at: 1_700_000_600_000, remainingMs: 600_000, label: '10m' },
      profiles: [{
        type: 'oauth',
        status: 'expiring',
        expiry: { at: 1_700_000_600_000, remainingMs: 600_000, label: '10m' },
      }],
    }],
  });
  assert.equal(JSON.stringify(snapshot).includes('OPENAI_API_KEY'), false);
  assert.equal(JSON.stringify(snapshot).includes('operator@example.test'), false);
  assert.equal(JSON.stringify(snapshot).includes('openai:default'), false);
});

test('OpenClawModelAuthStatusClient rejects malformed native status fields', () => {
  assert.throws(() => parseOpenClawModelAuthStatus({ ...response, ts: -1 }), OpenClawModelAuthStatusResponseError);
  assert.throws(() => parseOpenClawModelAuthStatus({
    ...response,
    providers: [{ ...response.providers[0], status: 'unknown' }],
  }), OpenClawModelAuthStatusResponseError);
  assert.throws(() => parseOpenClawModelAuthStatus({
    ...response,
    providers: [{ ...response.providers[0], expiry: { at: 1, remainingMs: 2 } }],
  }), OpenClawModelAuthStatusResponseError);
});

test('OpenClawModelAuthStatusClient preserves the native negative duration for expired credentials', () => {
  const snapshot = parseOpenClawModelAuthStatus({
    ...response,
    providers: [{
      ...response.providers[0],
      status: 'expired',
      expiry: { at: 1_700_000_000_000, remainingMs: -1, label: '0m' },
    }],
  });

  assert.equal(snapshot.providers[0]?.status, 'expired');
  assert.equal(snapshot.providers[0]?.expiry?.remainingMs, -1);
});

test('OpenClawModelAuthStatusClient avoids unadvertised methods and maps connection failures', async () => {
  const unavailable = new OpenClawModelAuthStatusClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => false,
    requestFenced: async () => { throw new Error('request must not be sent'); },
  });
  const missing = new OpenClawModelAuthStatusClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => null,
    requestFenced: async () => { throw new GatewayRpcError('missing', 'METHOD_NOT_FOUND'); },
  });
  const disconnected = new OpenClawModelAuthStatusClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => true,
    requestFenced: async () => { throw new GatewayDisconnectedError(); },
  });

  await assert.rejects(unavailable.get(), OpenClawModelAuthStatusUnavailableError);
  await assert.rejects(missing.get(), OpenClawModelAuthStatusUnavailableError);
  await assert.rejects(disconnected.get(), OpenClawModelAuthStatusUnavailableError);
});

test('OpenClawModelAuthStatusClient discards a status response after the Gateway changes', async () => {
  let current = true;
  const client = new OpenClawModelAuthStatusClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => current,
    hasAdvertisedMethod: () => true,
    requestFenced: async () => {
      current = false;
      return response;
    },
  });

  await assert.rejects(client.get(), OpenClawModelAuthStatusUnavailableError);
});
