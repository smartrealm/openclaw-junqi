import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SessionCommandCoordinator } from '@/services/chat/sessionCommandCoordinator';
import { SessionSettingsClient, SessionSettingsTargetError } from './SessionSettingsClient';

const SESSION_KEY = 'agent:main:main';

function response(entry: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    key: SESSION_KEY,
    entry,
    resolved: { modelProvider: 'openai', model: 'gpt-5.6' },
  };
}

describe('SessionSettingsClient', () => {
  it('按字段权限将会话 patch 路由到最小权限连接', async () => {
    const calls: Array<{ lane: 'daily' | 'admin'; method: string; params: Record<string, unknown> }> = [];
    const client = new SessionSettingsClient({
      runMutation: (_key, operation) => operation(),
      request: async (method, params) => {
        calls.push({ lane: 'daily', method, params });
        return response() as never;
      },
      requestPrivileged: async (method, params) => {
        calls.push({ lane: 'admin', method, params });
        return response() as never;
      },
    });

    await client.setModel(SESSION_KEY, 'openai/gpt-5.6');
    await client.setModel(SESSION_KEY, null);
    await client.setThinking(SESSION_KEY, 'high');
    await client.setThinking(SESSION_KEY, null);
    await client.setFastMode(SESSION_KEY, 'auto');
    await client.setFastMode(SESSION_KEY, null);
    await client.setVerbose(SESSION_KEY, 'full');
    await client.setVerbose(SESSION_KEY, null);
    await client.setTrace(SESSION_KEY, 'on');
    await client.setTrace(SESSION_KEY, null);
    await client.setResponseUsage(SESSION_KEY, 'full');
    await client.setResponseUsage(SESSION_KEY, null);
    await client.setReasoning(SESSION_KEY, 'stream');
    await client.setReasoning(SESSION_KEY, null);
    await client.setLabel(SESSION_KEY, 'Planning');

    assert.deepEqual(calls, [
      { lane: 'daily', method: 'sessions.patch', params: { key: SESSION_KEY, model: 'openai/gpt-5.6' } },
      { lane: 'daily', method: 'sessions.patch', params: { key: SESSION_KEY, model: null } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, thinkingLevel: 'high' } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, thinkingLevel: null } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, fastMode: 'auto' } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, fastMode: null } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, verboseLevel: 'full' } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, verboseLevel: null } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, traceLevel: 'on' } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, traceLevel: null } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, responseUsage: 'full' } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, responseUsage: null } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, reasoningLevel: 'stream' } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, reasoningLevel: null } },
      { lane: 'daily', method: 'sessions.patch', params: { key: SESSION_KEY, label: 'Planning' } },
    ]);
  });

  it('keeps session setting mutations ordered in the shared session lane', async () => {
    const coordinator = new SessionCommandCoordinator();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let requestCount = 0;
    const orderedRequest = async () => {
      requestCount += 1;
      order.push(`start-${requestCount}`);
      if (requestCount === 1) await firstPending;
      order.push(`end-${requestCount}`);
      return response() as never;
    };
    const client = new SessionSettingsClient({
      runMutation: (key, operation) => coordinator.runMutation(key, operation),
      request: orderedRequest,
      requestPrivileged: orderedRequest,
    });

    const first = client.setModel(SESSION_KEY, 'openai/gpt-5.6');
    const second = client.setThinking(SESSION_KEY, 'high');
    await Promise.resolve();
    assert.deepEqual(order, ['start-1']);

    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
  });

  it('rejects an unconfirmed Gateway response', async () => {
    const client = new SessionSettingsClient({
      runMutation: (_key, operation) => operation(),
      request: async () => ({ ok: false }) as never,
      requestPrivileged: async () => ({ ok: false }) as never,
    });

    await assert.rejects(
      client.setModel(SESSION_KEY, 'openai/gpt-5.6'),
      (error: unknown) => (
        error instanceof Error
        && (error as Error & { code?: string }).code === 'SESSION_SETTINGS_RESPONSE_INVALID'
      ),
    );
  });

  it('rejects a patch response without the installed resolved model projection', async () => {
    const client = new SessionSettingsClient({
      runMutation: (_key, operation) => operation(),
      request: async () => ({ ok: true, key: SESSION_KEY, entry: {} }) as never,
      requestPrivileged: async () => ({ ok: true, key: SESSION_KEY, entry: {} }) as never,
    });

    await assert.rejects(
      client.setModel(SESSION_KEY, null),
      (error: unknown) => (
        error instanceof Error
        && (error as Error & { reason?: string }).reason === 'missing-resolved-model'
      ),
    );
  });

  it('requires an explicit session target before opening a mutation lane', async () => {
    let mutations = 0;
    let requests = 0;
    const client = new SessionSettingsClient({
      runMutation: async (_key, operation) => {
        mutations += 1;
        return operation();
      },
      request: async () => {
        requests += 1;
        return response() as never;
      },
      requestPrivileged: async () => {
        requests += 1;
        return response() as never;
      },
    });

    await assert.rejects(client.setThinking('  ', 'high'), SessionSettingsTargetError);
    assert.equal(mutations, 0);
    assert.equal(requests, 0);
  });
});
