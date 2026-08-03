import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError, GatewayRpcError } from './Connection';
import {
  OpenClawTtsPreferencesClient,
  OpenClawTtsPreferencesResponseError,
  OpenClawTtsPreferencesUnavailableError,
} from './OpenClawTtsPreferencesClient';

test('OpenClawTtsPreferencesClient fences the official TTS preference mutations', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawTtsPreferencesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    hasAdvertisedMethod: () => true,
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      if (method === 'tts.enable') return { enabled: true };
      if (method === 'tts.disable') return { enabled: false };
      if (method === 'tts.setProvider') return { provider: 'openai' };
      return { persona: null };
    },
  });

  await client.setEnabled(true);
  await client.setEnabled(false);
  await client.setProvider(' openai ');
  await client.setPersona(null);

  assert.deepEqual(calls, [
    { method: 'tts.enable', params: {}, connectionId: 'gateway-a' },
    { method: 'tts.disable', params: {}, connectionId: 'gateway-a' },
    { method: 'tts.setProvider', params: { provider: 'openai' }, connectionId: 'gateway-a' },
    { method: 'tts.setPersona', params: {}, connectionId: 'gateway-a' },
  ]);
});

test('OpenClawTtsPreferencesClient validates preference acknowledgements', async () => {
  const client = new OpenClawTtsPreferencesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => true,
    requestFenced: async () => ({ enabled: false }),
  });

  await assert.rejects(client.setEnabled(true), OpenClawTtsPreferencesResponseError);
  await assert.rejects(client.setProvider('   '), OpenClawTtsPreferencesResponseError);
});

test('OpenClawTtsPreferencesClient avoids unadvertised methods and maps connection failures', async () => {
  const unavailable = new OpenClawTtsPreferencesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => false,
    requestFenced: async () => { throw new Error('request must not be sent'); },
  });
  const missing = new OpenClawTtsPreferencesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => null,
    requestFenced: async () => { throw new GatewayRpcError('missing', 'METHOD_NOT_FOUND'); },
  });
  const disconnected = new OpenClawTtsPreferencesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => true,
    requestFenced: async () => { throw new GatewayDisconnectedError(); },
  });

  await assert.rejects(unavailable.setEnabled(true), OpenClawTtsPreferencesUnavailableError);
  await assert.rejects(missing.setEnabled(true), OpenClawTtsPreferencesUnavailableError);
  await assert.rejects(disconnected.setEnabled(true), OpenClawTtsPreferencesUnavailableError);
});

test('OpenClawTtsPreferencesClient discards acknowledgements after a Gateway switch', async () => {
  let current = true;
  const client = new OpenClawTtsPreferencesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => current,
    hasAdvertisedMethod: () => true,
    requestFenced: async () => {
      current = false;
      return { enabled: true };
    },
  });

  await assert.rejects(client.setEnabled(true), OpenClawTtsPreferencesUnavailableError);
});
