import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawSessionOrganizationClient,
  SessionOrganizationResponseError,
  SessionOrganizationProtocolUnsupportedError,
} from './OpenClawSessionOrganizationClient';

const SESSION_KEY = 'agent:main:main';

describe('OpenClawSessionOrganizationClient', () => {
  it('uses the native sessions.patch fields through the regular mutation lane', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async (method, params) => {
        calls.push({ method, params });
        return {
          ok: true,
          key: SESSION_KEY,
          entry: method === 'sessions.patch' && params.category === 'Finance' ? { category: 'Finance' } : {},
        } as never;
      },
    });

    await client.setPinned(SESSION_KEY, true);
    await client.setUnread(SESSION_KEY, true);
    await client.setArchived(SESSION_KEY, true);
    await client.setCategory(SESSION_KEY, 'Finance');

    assert.deepEqual(calls, [
      { method: 'sessions.patch', params: { key: SESSION_KEY, pinned: true } },
      { method: 'sessions.patch', params: { key: SESSION_KEY, unread: true } },
      { method: 'sessions.patch', params: { key: SESSION_KEY, archived: true } },
      { method: 'sessions.patch', params: { key: SESSION_KEY, category: 'Finance' } },
    ]);
  });

  it('requires the returned entry to confirm a requested category', async () => {
    const client = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async () => ({ ok: true, key: SESSION_KEY, entry: { category: 'Other' } } as never),
    });

    await assert.rejects(client.setCategory(SESSION_KEY, 'Finance'), SessionOrganizationResponseError);
  });

  it('identifies only explicit protocol incompatibility for capability reporting', async () => {
    const client = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async () => {
        throw new GatewayRpcError('unknown field: pinned', 'INVALID_PARAMS');
      },
    });
    await assert.rejects(client.setPinned(SESSION_KEY, true), SessionOrganizationProtocolUnsupportedError);

    const deniedClient = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async () => {
        throw new GatewayRpcError('missing scope: operator.write', 'UNAUTHORIZED');
      },
    });
    await assert.rejects(deniedClient.setPinned(SESSION_KEY, true), GatewayRpcError);
  });
});
