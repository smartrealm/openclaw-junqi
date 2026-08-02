import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawSessionOrganizationClient,
  SessionOrganizationProtocolUnsupportedError,
} from './OpenClawSessionOrganizationClient';

const SESSION_KEY = 'agent:main:main';

describe('OpenClawSessionOrganizationClient', () => {
  it('uses the native sessions.patch fields through the privileged mutation lane', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      requestPrivileged: async (method, params) => {
        calls.push({ method, params });
        return { ok: true, key: SESSION_KEY, entry: {} } as never;
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

  it('preserves the existing native group catalog when creating a group', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      requestPrivileged: async (method, params) => {
        calls.push({ method, params });
        if (method === 'sessions.groups.list') {
          return { groups: [{ name: 'Legal', position: 0 }] } as never;
        }
        return { ok: true, groups: [] } as never;
      },
    });

    await client.putGroup('Finance');
    await client.renameGroup('Finance', 'Credit');
    await client.deleteGroup('Credit');

    assert.deepEqual(calls, [
      { method: 'sessions.groups.list', params: {} },
      { method: 'sessions.groups.put', params: { names: ['Legal', 'Finance'] } },
      { method: 'sessions.groups.rename', params: { name: 'Finance', to: 'Credit' } },
      { method: 'sessions.groups.delete', params: { name: 'Credit' } },
    ]);
  });

  it('identifies only explicit protocol incompatibility as a legacy fallback condition', async () => {
    const client = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      requestPrivileged: async () => {
        throw new GatewayRpcError('unknown field: pinned', 'INVALID_PARAMS');
      },
    });
    await assert.rejects(client.setPinned(SESSION_KEY, true), SessionOrganizationProtocolUnsupportedError);

    const deniedClient = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      requestPrivileged: async () => {
        throw new GatewayRpcError('missing scope: operator.admin', 'UNAUTHORIZED');
      },
    });
    await assert.rejects(deniedClient.setPinned(SESSION_KEY, true), GatewayRpcError);
  });
});
