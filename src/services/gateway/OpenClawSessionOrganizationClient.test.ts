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
      request: async (method, params) => {
        calls.push({ method, params });
        if (method === 'sessions.groups.list') {
          return { groups: [{ name: 'Legal', position: 0 }] } as never;
        }
        if (method === 'sessions.groups.put') {
          return {
            ok: true,
            groups: [{ name: 'Legal', position: 0 }, { name: 'Finance', position: 1 }],
          } as never;
        }
        if (method === 'sessions.groups.rename') {
          return {
            ok: true,
            groups: [{ name: 'Legal', position: 0 }, { name: 'Credit', position: 1 }],
          } as never;
        }
        return { ok: true, groups: [{ name: 'Legal', position: 0 }] } as never;
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

  it('serializes catalog writes so concurrent group creation keeps prior confirmed entries', async () => {
    const puts: string[][] = [];
    let groups = ['Legal'];
    let releaseFirstList: ((result: unknown) => void) | undefined;
    let listCalls = 0;
    const client = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async (method, params) => {
        if (method === 'sessions.groups.list') {
          listCalls += 1;
          if (listCalls === 1) {
            return new Promise<unknown>((resolve) => { releaseFirstList = resolve; }) as never;
          }
          return { groups: groups.map((name, position) => ({ name, position })) } as never;
        }
        if (method === 'sessions.groups.put') {
          groups = [...params.names as string[]];
          puts.push(groups);
          return { ok: true, groups: groups.map((name, position) => ({ name, position })) } as never;
        }
        throw new Error(`Unexpected method: ${method}`);
      },
    });

    const finance = client.putGroup('Finance');
    await Promise.resolve();
    const research = client.putGroup('Research');
    await Promise.resolve();
    assert.equal(listCalls, 1);
    releaseFirstList?.({ groups: [{ name: 'Legal', position: 0 }] });

    await Promise.all([finance, research]);
    assert.deepEqual(puts, [
      ['Legal', 'Finance'],
      ['Legal', 'Finance', 'Research'],
    ]);
  });

  it('rejects incomplete native group catalog entries', async () => {
    const client = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async () => ({ groups: [{ name: 'Legal' }] } as never),
    });

    await assert.rejects(client.listGroups(), SessionOrganizationResponseError);
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
