import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GatewayRpcError } from './Connection';
import { listOpenClawSessionLifecycle } from './OpenClawSessionListClient';

describe('listOpenClawSessionLifecycle', () => {
  it('uses only the documented boolean archive filter', async () => {
    const calls: Array<{ method: string; params: Record<string, boolean> }> = [];
    const responses = await listOpenClawSessionLifecycle(async (method, params) => {
      calls.push({ method, params });
      return { sessions: [] } as never;
    });

    assert.deepEqual(calls, [
      { method: 'sessions.list', params: {} },
      { method: 'sessions.list', params: { archived: true } },
    ]);
    assert.deepEqual(responses, {
      active: { sessions: [] },
      archived: { sessions: [] },
    });
  });

  it('keeps active sessions available only when an older Gateway explicitly rejects archived filtering', async () => {
    const active = { sessions: [{ key: 'agent:main:main' }] };
    const responses = await listOpenClawSessionLifecycle(async (_method, params) => {
      if (params.archived) throw new GatewayRpcError('unknown field: archived', 'INVALID_PARAMS');
      return active as never;
    });

    assert.deepEqual(responses, { active });
  });

  it('does not hide authentication and unexpected protocol failures', async () => {
    await assert.rejects(
      listOpenClawSessionLifecycle(async (_method, params) => {
        if (params.archived) throw new GatewayRpcError('missing scope: operator.read', 'UNAUTHORIZED');
        return { sessions: [] } as never;
      }),
      GatewayRpcError,
    );
  });
});
