import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError, GatewayRpcError } from './Connection';
import {
  OPENCLAW_SETUP_VERIFY_METHOD,
  OpenClawSetupVerificationClient,
  OpenClawSetupVerificationResponseError,
  OpenClawSetupVerificationUnavailableError,
  parseOpenClawSetupVerification,
} from './OpenClawSetupVerificationClient';

test('OpenClawSetupVerificationClient uses the official read-only verification method', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawSetupVerificationClient({
    requestPrivileged: async (method, params) => {
      calls.push({ method, params });
      return { ok: true, modelRef: 'openai/gpt-5.6-sol', latencyMs: 321 };
    },
  });

  assert.deepEqual(await client.verify(), {
    ok: true,
    modelRef: 'openai/gpt-5.6-sol',
    latencyMs: 321,
  });
  assert.deepEqual(calls, [{ method: OPENCLAW_SETUP_VERIFY_METHOD, params: {} }]);
});

test('OpenClawSetupVerificationClient retains only official success or failure shapes', () => {
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
    OpenClawSetupVerificationResponseError,
  );
});

test('OpenClawSetupVerificationClient distinguishes unavailable Gateway methods and connections', async () => {
  const unsupported = new OpenClawSetupVerificationClient({
    requestPrivileged: async () => { throw new GatewayRpcError('missing', 'METHOD_NOT_FOUND'); },
  });
  await assert.rejects(unsupported.verify(), OpenClawSetupVerificationUnavailableError);

  const installedRuntimeShape = new OpenClawSetupVerificationClient({
    requestPrivileged: async () => {
      throw new GatewayRpcError('unknown method: openclaw.setup.verify', 'INVALID_REQUEST');
    },
  });
  await assert.rejects(installedRuntimeShape.verify(), OpenClawSetupVerificationUnavailableError);

  const disconnected = new OpenClawSetupVerificationClient({
    requestPrivileged: async () => { throw new GatewayDisconnectedError(); },
  });
  await assert.rejects(disconnected.verify(), OpenClawSetupVerificationUnavailableError);
});
