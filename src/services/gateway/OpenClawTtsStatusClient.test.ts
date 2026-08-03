import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError, GatewayRpcError } from './Connection';
import {
  OpenClawTtsStatusClient,
  OpenClawTtsStatusResponseError,
  OpenClawTtsStatusUnavailableError,
  parseOpenClawTtsStatus,
} from './OpenClawTtsStatusClient';

const statusResponse = {
  enabled: true,
  auto: 'always',
  provider: 'openai',
  persona: 'brief',
  prefsPath: '/private/gateway/tts.json',
  fallbackProvider: 'edge',
  fallbackProviders: ['edge'],
  providerStates: [{ id: 'openai', label: 'OpenAI', configured: true }],
  personas: [{
    id: 'brief',
    label: 'Brief',
    description: 'A concise voice.',
    provider: 'openai',
  }],
};

test('OpenClawTtsStatusClient fences and projects only the official safe TTS status fields', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawTtsStatusClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    hasAdvertisedMethod: () => true,
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return statusResponse;
    },
  });

  const status = await client.get();

  assert.deepEqual(calls, [{ method: 'tts.status', params: {}, connectionId: 'gateway-a' }]);
  assert.deepEqual(status, {
    enabled: true,
    auto: 'always',
    provider: 'openai',
    persona: 'brief',
    providerStates: [{ id: 'openai', label: 'OpenAI', configured: true }],
    personas: [{
      id: 'brief',
      label: 'Brief',
      description: 'A concise voice.',
      provider: 'openai',
    }],
  });
  assert.equal('prefsPath' in status, false);
  assert.equal('fallbackProvider' in status, false);
});

test('OpenClawTtsStatusClient rejects malformed official status fields', () => {
  assert.throws(() => parseOpenClawTtsStatus({
    ...statusResponse,
    auto: 'conditional',
  }), OpenClawTtsStatusResponseError);
  assert.throws(() => parseOpenClawTtsStatus({
    ...statusResponse,
    providerStates: [{ id: 'openai', label: 'OpenAI', configured: 'true' }],
  }), OpenClawTtsStatusResponseError);
  assert.throws(() => parseOpenClawTtsStatus({
    ...statusResponse,
    personas: [{ id: 'brief', label: 'Brief', provider: 'openai' }],
  }), OpenClawTtsStatusResponseError);
});

test('OpenClawTtsStatusClient does not request an unadvertised method and maps a missing method response', async () => {
  const unavailable = new OpenClawTtsStatusClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => false,
    requestFenced: async () => { throw new Error('request must not be sent'); },
  });
  const missing = new OpenClawTtsStatusClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => null,
    requestFenced: async () => { throw new GatewayRpcError('missing', 'METHOD_NOT_FOUND'); },
  });

  await assert.rejects(unavailable.get(), OpenClawTtsStatusUnavailableError);
  await assert.rejects(missing.get(), OpenClawTtsStatusUnavailableError);
});

test('OpenClawTtsStatusClient discards a result after the Gateway connection changes', async () => {
  let current = true;
  const client = new OpenClawTtsStatusClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => current,
    hasAdvertisedMethod: () => true,
    requestFenced: async () => {
      current = false;
      return statusResponse;
    },
  });

  await assert.rejects(client.get(), OpenClawTtsStatusUnavailableError);
});

test('OpenClawTtsStatusClient uses an explicit connection identity for a mutation refresh', async () => {
  const calls: Array<{ method: string; connectionId: string }> = [];
  const client = new OpenClawTtsStatusClient({
    captureConnectionId: () => 'gateway-b',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    hasAdvertisedMethod: () => true,
    requestFenced: async (method, _params, connectionId) => {
      calls.push({ method, connectionId });
      return statusResponse;
    },
  });

  const status = await client.getForConnection('gateway-a');

  assert.equal(status.provider, 'openai');
  assert.deepEqual(calls, [{ method: 'tts.status', connectionId: 'gateway-a' }]);
});

test('OpenClawTtsStatusClient maps a disconnected fenced request to unavailable', async () => {
  const client = new OpenClawTtsStatusClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => true,
    requestFenced: async () => { throw new GatewayDisconnectedError(); },
  });

  await assert.rejects(client.get(), OpenClawTtsStatusUnavailableError);
});
