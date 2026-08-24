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
describe('OpenClawSessionOrganizationClient', () => {
  it('仅发送原生组织字段，以 regular mutation lane 申请 operator.write', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async (method, params) => {
        calls.push({ method, params });
        return {
          ok: true,
          key: SESSION_KEY,
          entry: method === 'sessions.patch' && params.category === 'Finance'
            ? { category: 'Finance' }
            : {
                ...(params.pinned === true ? { pinnedAt: 1_755_000_000_000 } : {}),
                ...(params.unread === true ? { markedUnreadAt: 1_755_000_000_001 } : {}),
                ...(params.unread === false ? { lastReadAt: 1_755_000_000_002 } : {}),
                ...(params.archived === true ? { archivedAt: 1_755_000_000_003 } : {}),
              },
        } as never;
      },
    });

    await client.setPinned(SESSION_KEY, true);
    await client.setUnread(SESSION_KEY, true);
    await client.setArchived(SESSION_KEY, true, 'session-id');
    await client.setCategory(SESSION_KEY, 'Finance');

    assert.deepEqual(calls, [
      { method: 'sessions.patch', params: { key: SESSION_KEY, pinned: true } },
      { method: 'sessions.patch', params: { key: SESSION_KEY, unread: true } },
      { method: 'sessions.patch', params: { key: SESSION_KEY, expectedSessionId: 'session-id', archived: true } },
      { method: 'sessions.patch', params: { key: SESSION_KEY, category: 'Finance' } },
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

    await assert.rejects(client.setPinned(missingTarget, true), OpenClawSessionTargetError);
    await assert.rejects(client.setUnread(missingTarget, true), OpenClawSessionTargetError);
    await assert.rejects(client.setArchived(missingTarget, true), OpenClawSessionTargetError);
    await assert.rejects(client.setCategory(missingTarget, 'Finance'), OpenClawSessionTargetError);
    assert.equal(mutationStarted, false);
    assert.equal(requestStarted, false);
  });

  it('requires the returned entry to confirm a requested category', async () => {
    const client = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async () => ({ ok: true, key: SESSION_KEY, entry: { category: 'Other' } } as never),
    });

    await assert.rejects(client.setCategory(SESSION_KEY, 'Finance'), SessionOrganizationResponseError);
  });

  it('拒绝缺失或不一致的原生时间戳组织字段', async () => {
    const client = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async (_method, params) => ({
        ok: true,
        key: SESSION_KEY,
        entry: params.pinned === false
          ? { pinnedAt: 1_755_000_000_000 }
          : params.archived === false
            ? { archivedAt: 1_755_000_000_001 }
            : params.unread === false
              ? { markedUnreadAt: 1_755_000_000_002 }
              : {},
      } as never),
    });

    await assert.rejects(client.setPinned(SESSION_KEY, true), SessionOrganizationResponseError);
    await assert.rejects(client.setPinned(SESSION_KEY, false), SessionOrganizationResponseError);
    await assert.rejects(client.setArchived(SESSION_KEY, true), SessionOrganizationResponseError);
    await assert.rejects(client.setArchived(SESSION_KEY, false), SessionOrganizationResponseError);
    await assert.rejects(client.setUnread(SESSION_KEY, true), SessionOrganizationResponseError);
    await assert.rejects(client.setUnread(SESSION_KEY, false), SessionOrganizationResponseError);
  });

  it('按官方持久化字段确认取消置顶、恢复归档和标记已读', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async (_method, params) => {
        calls.push(params);
        return {
          ok: true,
          key: SESSION_KEY,
          entry: params.unread === false ? { lastReadAt: 1_755_000_000_000 } : {},
        } as never;
      },
    });

    await client.setPinned(SESSION_KEY, false);
    await client.setArchived(SESSION_KEY, false, 'session-id');
    await client.setUnread(SESSION_KEY, false);

    assert.deepEqual(calls[1], {
      key: SESSION_KEY,
      expectedSessionId: 'session-id',
      archived: false,
    });
  });

  it('归档回执仍带置顶时间戳时拒绝确认', async () => {
    const client = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async () => ({
        ok: true,
        key: SESSION_KEY,
        entry: { archivedAt: 1_755_000_000_000, pinnedAt: 1_754_000_000_000 },
      } as never),
    });

    await assert.rejects(client.setArchived(SESSION_KEY, true), SessionOrganizationResponseError);
  });

  it('identifies only explicit protocol incompatibility for capability reporting', async () => {
    const client = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async (method) => {
        throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
      },
    });
    await assert.rejects(client.setPinned(SESSION_KEY, true), SessionOrganizationProtocolUnsupportedError);

    const invalidPatchClient = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async () => {
        throw new GatewayRpcError('unknown field: pinned', 'INVALID_REQUEST');
      },
    });
    await assert.rejects(invalidPatchClient.setPinned(SESSION_KEY, true), GatewayRpcError);

    const deniedClient = new OpenClawSessionOrganizationClient({
      runMutation: (_key, operation) => operation(),
      request: async () => {
        throw new GatewayRpcError('missing scope: operator.write', 'UNAUTHORIZED');
      },
    });
    await assert.rejects(deniedClient.setPinned(SESSION_KEY, true), GatewayRpcError);
  });
});
