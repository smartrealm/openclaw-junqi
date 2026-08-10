import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawModelProbeClient,
  OpenClawModelProbeResponseError,
  OpenClawModelProbeUnavailableError,
  parseOpenClawModelProbe,
} from './OpenClawModelProbeClient';

test('OpenClawModelProbeClient runs the bounded official provider probe only on demand', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawModelProbeClient({
    requestPrivileged: async (method, params) => {
      calls.push({ method, params });
      return {
        provider: 'openai',
        status: 'ok',
        latencyMs: 420,
        results: [{ profileId: 'sensitive-profile', label: 'Work', status: 'ok', latencyMs: 420 }],
      };
    },
  });

  assert.deepEqual(await client.probeProvider(' openai '), {
    provider: 'openai',
    status: 'ok',
    latencyMs: 420,
    targetCount: 1,
  });
  assert.deepEqual(calls, [{ method: 'models.probe', params: { provider: 'openai' } }]);
});

test('OpenClawModelProbeClient projects only provider-level non-secret probe facts', () => {
  const parsed = parseOpenClawModelProbe({
    provider: 'anthropic',
    status: 'auth',
    error: 'Authentication failed.',
    results: [{
      profileId: 'anthropic:private',
      label: 'private@example.test',
      status: 'auth',
      error: 'Authentication failed.',
    }],
  });

  assert.deepEqual(parsed, {
    provider: 'anthropic',
    status: 'auth',
    targetCount: 1,
  });
  assert.equal(JSON.stringify(parsed).includes('private@example.test'), false);
  assert.equal(JSON.stringify(parsed).includes('anthropic:private'), false);
});

test('OpenClawModelProbeClient rejects malformed, mismatched, and unsupported results', async () => {
  assert.throws(
    () => parseOpenClawModelProbe({ provider: 'openai', status: 'healthy', results: [] }),
    OpenClawModelProbeResponseError,
  );
  assert.throws(
    () => parseOpenClawModelProbe({ provider: 'openai', status: 'ok', results: [{ label: '', status: 'ok' }] }),
    OpenClawModelProbeResponseError,
  );

  const mismatched = new OpenClawModelProbeClient({
    requestPrivileged: async () => ({ provider: 'anthropic', status: 'ok', results: [] }),
  });
  await assert.rejects(mismatched.probeProvider('openai'), OpenClawModelProbeResponseError);

  const unsupported = new OpenClawModelProbeClient({
    requestPrivileged: async (method) => {
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    },
  });
  await assert.rejects(unsupported.probeProvider('openai'), OpenClawModelProbeUnavailableError);
});
