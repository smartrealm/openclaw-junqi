import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawModelAuthLogoutClient,
  OpenClawModelAuthLogoutResponseError,
  OpenClawModelAuthLogoutUnavailableError,
  parseOpenClawModelAuthLogout,
} from './OpenClawModelAuthLogoutClient';

test('OpenClawModelAuthLogoutClient delegates provider-wide logout to the privileged official RPC', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawModelAuthLogoutClient({
    requestPrivileged: async (method, params) => {
      calls.push({ method, params });
      return {
        provider: 'openai',
        removedProfiles: ['openai:work', 'openai:backup'],
        abortedRunIds: ['run-a'],
      };
    },
  });

  assert.deepEqual(await client.logoutProvider(' openai '), {
    provider: 'openai',
    removedProfileCount: 2,
    abortedRunCount: 1,
  });
  assert.deepEqual(calls, [{ method: 'models.authLogout', params: { provider: 'openai' } }]);
});

test('OpenClawModelAuthLogoutClient rejects malformed and mismatched official results', async () => {
  assert.throws(
    () => parseOpenClawModelAuthLogout({ provider: 'openai', removedProfiles: [], abortedRunIds: [1] }),
    OpenClawModelAuthLogoutResponseError,
  );
  const client = new OpenClawModelAuthLogoutClient({
    requestPrivileged: async () => ({ provider: 'anthropic', removedProfiles: [], abortedRunIds: [] }),
  });
  await assert.rejects(client.logoutProvider('openai'), OpenClawModelAuthLogoutResponseError);
});

test('OpenClawModelAuthLogoutClient maps an unsupported official RPC without a fallback', async () => {
  const client = new OpenClawModelAuthLogoutClient({
    requestPrivileged: async (method) => {
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    },
  });
  await assert.rejects(client.logoutProvider('openai'), OpenClawModelAuthLogoutUnavailableError);
});
