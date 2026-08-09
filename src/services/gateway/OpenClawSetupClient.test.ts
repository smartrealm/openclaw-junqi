import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError, GatewayRpcError } from './Connection';
import {
  OPENCLAW_SETUP_DETECT_METHOD,
  OPENCLAW_SETUP_VERIFY_METHOD,
  OpenClawSetupClient,
  OpenClawSetupMethodUnavailableError,
  OpenClawSetupResponseError,
  parseOpenClawSetupDetection,
  parseOpenClawSetupVerification,
} from './OpenClawSetupClient';

test('OpenClawSetupClient uses official structured detection and verification methods', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawSetupClient({
    requestPrivileged: async (method, params) => {
      calls.push({ method, params });
      return method === OPENCLAW_SETUP_DETECT_METHOD
        ? { setupComplete: true, configuredModel: 'openai/gpt-5.6-sol' }
        : { ok: true, modelRef: 'openai/gpt-5.6-sol', latencyMs: 321 };
    },
  });

  assert.deepEqual(await client.detect(), {
    setupComplete: true,
    configuredModel: 'openai/gpt-5.6-sol',
  });
  assert.deepEqual(await client.verify(), {
    ok: true,
    modelRef: 'openai/gpt-5.6-sol',
    latencyMs: 321,
  });
  assert.deepEqual(calls, [
    { method: OPENCLAW_SETUP_DETECT_METHOD, params: {} },
    { method: OPENCLAW_SETUP_VERIFY_METHOD, params: {} },
  ]);
});

test('OpenClawSetupClient rejects malformed official responses', () => {
  assert.deepEqual(parseOpenClawSetupDetection({ setupComplete: false }), {
    setupComplete: false,
  });
  assert.throws(
    () => parseOpenClawSetupDetection({ setupComplete: 'yes' }),
    OpenClawSetupResponseError,
  );
  assert.deepEqual(parseOpenClawSetupVerification({
    ok: false,
    status: 'auth',
    error: 'Credential expired',
  }), {
    ok: false,
    status: 'auth',
    error: 'Credential expired',
  });
  assert.throws(
    () => parseOpenClawSetupVerification({ ok: true, modelRef: 'openai/gpt-5.6-sol' }),
    OpenClawSetupResponseError,
  );
});

test('OpenClawSetupClient preserves unavailable method and connection semantics', async () => {
  const unsupported = new OpenClawSetupClient({
    requestPrivileged: async () => { throw new GatewayRpcError('missing', 'METHOD_NOT_FOUND'); },
  });
  await assert.rejects(unsupported.detect(), OpenClawSetupMethodUnavailableError);

  const disconnected = new OpenClawSetupClient({
    requestPrivileged: async () => { throw new GatewayDisconnectedError(); },
  });
  await assert.rejects(disconnected.verify(), OpenClawSetupMethodUnavailableError);
});
