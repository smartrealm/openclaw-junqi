import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawSessionOrganizationClient,
  SessionOrganizationResponseError,
  SessionOrganizationProtocolUnsupportedError,
} from './OpenClawSessionOrganizationClient';
import { OpenClawSessionTargetError } from './OpenClawSessionTarget';

const SESSION_KEY = 'agent:main:main';
const SESSION_ID = 'session-main';

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

    await client.setPinned(SESSION_KEY, SESSION_ID, true);
    await client.setUnread(SESSION_KEY, SESSION_ID, true);
    await client.setArchived(SESSION_KEY, SESSION_ID, true);
    await client.setCategory(SESSION_KEY, SESSION_ID, 'Finance');

    assert.deepEqual(calls, [
      { method: 'sessions.patch', params: { key: SESSION_KEY, expectedSessionId: SESSION_ID, pinned: true } },
      { method: 'sessions.patch', params: { key: SESSION_KEY, expectedSessionId: SESSION_ID, unread: true } },
      { method: 'sessions.patch', params: { key: SESSION_KEY, expectedSessionId: SESSION_ID, archived: true } },
      { method: 'sessions.patch', params: { key: SESSION_KEY, expectedSessionId: SESSION_ID, category: 'Finance' } },
    ]);
  });

  it('在进入 mutation coordinator 或发起 Gateway 请求前拒绝缺失会话目标', async () => {
    let mutationStarted = false;
    let requestStarted = false;
    const client = new OpenClawSessionOrganizationClient({
      runMutation: async (_key, operation) => {
        mutationStarted = true;
        return operation();
      },
      request: async () => {
        requestStarted = true;
        return {} as never;
      },
    });
    const missingTarget = '   ';

    await assert.rejects(client.setPinned(missingTarget, SESSION_ID, true), OpenClawSessionTargetError);
    await assert.rejects(client.setUnread(missingTarget, SESSION_ID, true), OpenClawSessionTargetError);
    await assert.rejects(client.setArchived(missingTarget, SESSION_ID, true), OpenClawSessionTargetError);
    await assert.rejects(client.setCategory(missingTarget, SESSION_ID, 'Finance'), OpenClawSessionTargetError);
    assert.equal(mutationStarted, false);
    assert.equal(requestStarted, false);
  });

  it('requires the returned entry to confirm a requested category', async () => {
    const client = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async () => ({ ok: true, key: SESSION_KEY, entry: { category: 'Other' } } as never),
    });

    await assert.rejects(client.setCategory(SESSION_KEY, SESSION_ID, 'Finance'), SessionOrganizationResponseError);
  });

  it('identifies only explicit protocol incompatibility for capability reporting', async () => {
    const client = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async () => {
        throw new GatewayRpcError('unknown field: pinned', 'INVALID_PARAMS');
      },
    });
    await assert.rejects(client.setPinned(SESSION_KEY, SESSION_ID, true), SessionOrganizationProtocolUnsupportedError);

    const deniedClient = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async () => {
        throw new GatewayRpcError('missing scope: operator.write', 'UNAUTHORIZED');
      },
    });
    await assert.rejects(deniedClient.setPinned(SESSION_KEY, SESSION_ID, true), GatewayRpcError);
  });
});
