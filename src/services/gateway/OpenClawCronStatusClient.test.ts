import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawCronStatusClient,
  OpenClawCronStatusResponseError,
  OpenClawCronStatusUnsupportedError,
} from './OpenClawCronStatusClient';

test('OpenClawCronStatusClient requests and decodes the official read-only scheduler summary', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawCronStatusClient(async (method, params) => {
    calls.push({ method, params });
    return {
      enabled: true,
      storage: 'sqlite',
      jobs: 3,
      nextWakeAtMs: 100,
      sqlitePath: '/private/gateway.sqlite',
    } as never;
  });

  assert.deepEqual(await client.get(), {
    enabled: true,
    storage: 'sqlite',
    jobs: 3,
    nextWakeAtMs: 100,
  });
  assert.deepEqual(calls, [{ method: 'cron.status', params: {} }]);
});

test('OpenClawCronStatusClient preserves disabled scheduler state and an absent next wake', async () => {
  const client = new OpenClawCronStatusClient(async () => ({
    enabled: false,
    storage: 'sqlite',
    jobs: 0,
    nextWakeAtMs: null,
  }) as never);

  assert.deepEqual(await client.get(), {
    enabled: false,
    storage: 'sqlite',
    jobs: 0,
    nextWakeAtMs: null,
  });
});

test('OpenClawCronStatusClient requests despite discovery omission and refuses malformed status results', async () => {
  let calls = 0;
  const unavailable = new OpenClawCronStatusClient(async () => {
    calls += 1;
    throw new GatewayRpcError('missing', 'METHOD_NOT_FOUND');
  });
  const missing = new OpenClawCronStatusClient(async () => {
    throw new GatewayRpcError('missing', 'METHOD_NOT_FOUND');
  });
  const malformed = new OpenClawCronStatusClient(async () => ({
    enabled: true,
    storage: 'json',
    jobs: 1,
    nextWakeAtMs: 1,
  }) as never);

  await assert.rejects(unavailable.get(), OpenClawCronStatusUnsupportedError);
  await assert.rejects(missing.get(), OpenClawCronStatusUnsupportedError);
  await assert.rejects(malformed.get(), OpenClawCronStatusResponseError);
  assert.equal(calls, 1);
});
