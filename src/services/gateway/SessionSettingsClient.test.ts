import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SessionCommandCoordinator } from '@/services/chat/sessionCommandCoordinator';
import { SessionSettingsClient } from './SessionSettingsClient';

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
  it('uses an operator.admin request for every persistent sessions.patch mutation', async () => {
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
    await client.setFastMode(SESSION_KEY, 'auto');
    await client.setFastMode(SESSION_KEY, null);
    await client.setLabel(SESSION_KEY, 'Planning');

    assert.deepEqual(calls, [
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, model: 'openai/gpt-5.6' } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, model: null } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, thinkingLevel: 'high' } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, fastMode: 'auto' } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, fastMode: null } },
      { lane: 'admin', method: 'sessions.patch', params: { key: SESSION_KEY, label: 'Planning' } },
    ]);
  });

  it('keeps session setting mutations ordered in the shared session lane', async () => {
    const coordinator = new SessionCommandCoordinator();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let requestCount = 0;
    const client = new SessionSettingsClient({
      runMutation: (key, operation) => coordinator.runMutation(key, operation),
      request: async () => response() as never,
      requestPrivileged: async () => {
        requestCount += 1;
        order.push(`start-${requestCount}`);
        if (requestCount === 1) await firstPending;
        order.push(`end-${requestCount}`);
        return response() as never;
      },
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
});
