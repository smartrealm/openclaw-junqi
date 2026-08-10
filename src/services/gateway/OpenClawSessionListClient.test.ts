import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GatewayRpcError } from './Connection';
import { listOpenClawSessionLifecycle } from './OpenClawSessionListClient';

const emptyPage = (offset: number) => ({ sessions: [], totalCount: 0, offset, nextOffset: null, hasMore: false });

describe('listOpenClawSessionLifecycle', () => {
  it('uses the official pagination and derived-field parameters', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const responses = await listOpenClawSessionLifecycle(async (method, params) => {
      calls.push({ method, params });
      return emptyPage(Number(params.offset ?? 0)) as never;
    }, ['main']);
    assert.deepEqual(calls, [
      { method: 'sessions.list', params: { agentId: 'main', includeGlobal: true, includeUnknown: true, configuredAgentsOnly: true, includeDerivedTitles: true, includeLastMessage: true, limit: 100, offset: 0 } },
      { method: 'sessions.list', params: { archived: true, agentId: 'main', includeGlobal: true, includeUnknown: true, configuredAgentsOnly: true, includeDerivedTitles: true, includeLastMessage: true, limit: 100, offset: 0 } },
    ]);
    assert.deepEqual(responses.active, emptyPage(0));
    assert.deepEqual(responses.archived, emptyPage(0));
  });

  it('loads all active pages and archived sessions independently', async () => {
    const first = { sessions: [{ key: 'agent:main:main' }], totalCount: 2, offset: 0, nextOffset: 1, hasMore: true };
    const second = { sessions: [{ key: 'agent:main:desktop-1' }], totalCount: 2, offset: 1, nextOffset: null, hasMore: false };
    const archived = emptyPage(0);
    const responses = await listOpenClawSessionLifecycle(async (_method, params) => {
      if (params.archived) return archived as never;
      return (params.offset === 0 ? first : second) as never;
    }, ['main']);
    assert.deepEqual(responses.active.sessions, [...first.sessions, ...second.sessions]);
    assert.deepEqual(responses.archived, archived);
  });

  it('accepts a terminal page that omits offset', async () => {
    const terminal = { sessions: [{ key: 'agent:main:main' }], totalCount: 1, nextOffset: null, hasMore: false };
    const archived = emptyPage(0);
    const responses = await listOpenClawSessionLifecycle(async (_method, params) => {
      return params.archived ? archived as never : terminal as never;
    }, ['main']);
    assert.deepEqual(responses.active.sessions, terminal.sessions);
  });

  it('rejects an offset-less terminal page after pagination began', async () => {
    const first = { sessions: [{ key: 'agent:main:main' }], totalCount: 2, offset: 0, nextOffset: 1, hasMore: true };
    const terminal = { sessions: [{ key: 'agent:main:desktop-1' }], totalCount: 2, nextOffset: null, hasMore: false };
    await assert.rejects(
      listOpenClawSessionLifecycle(async (_method, params) => {
        if (params.archived) return emptyPage(0) as never;
        return (params.offset === 0 ? first : terminal) as never;
      }, ['main']),
      /invalid pagination metadata/,
    );
  });

  it('does not hide authentication failures', async () => {
    await assert.rejects(
      listOpenClawSessionLifecycle(async (_method, params) => {
        if (params.archived) throw new GatewayRpcError('missing scope: operator.read', 'UNAUTHORIZED');
        return emptyPage(0) as never;
      }, ['main']),
      GatewayRpcError,
    );
  });

  it('将每个智能体范围内的裸 global 立即投影为不冲突的本地会话身份', async () => {
    const response = await listOpenClawSessionLifecycle(async (_method, params) => ({
      sessions: [{ key: 'global', createdAt: 1 }],
      totalCount: 1,
      offset: Number(params.offset ?? 0),
      nextOffset: null,
      hasMore: false,
    }), ['main', 'legal']);

    assert.deepEqual(response.active.sessions, [
      { key: 'agent:main:global', createdAt: 1, agentId: 'main' },
      { key: 'agent:legal:global', createdAt: 1, agentId: 'legal' },
    ]);
  });
});
