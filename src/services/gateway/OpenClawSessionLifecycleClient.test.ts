import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OpenClawSessionLifecycleClient,
  OpenClawSessionLifecycleResponseError,
  parseOpenClawCreatedSession,
} from './OpenClawSessionLifecycleClient';

const SESSION_KEY = 'agent:main:session-1';
const SESSION_ID = 'session-1';

function response(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    key: SESSION_KEY,
    sessionId: SESSION_ID,
    entry: { sessionId: SESSION_ID, label: 'Planning' },
    ...overrides,
  };
}

describe('OpenClawSessionLifecycleClient', () => {
  it('creates through the protocol method and accepts only a confirmed identity', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = new OpenClawSessionLifecycleClient(async (method, params) => {
      calls.push({ method, params });
      return response() as never;
    });

    const created = await client.create({
      agentId: ' main ',
      label: ' Planning ',
      parentSessionKey: ' agent:main:parent ',
      fork: true,
    });

    assert.deepEqual(calls, [{
      method: 'sessions.create',
      params: {
        agentId: 'main',
        label: 'Planning',
        parentSessionKey: 'agent:main:parent',
        fork: true,
      },
    }]);
    assert.equal(created.key, SESSION_KEY);
    assert.equal(created.agentId, 'main');
    assert.equal(created.sessionId, SESSION_ID);
  });

  it('sends the official transcript fork flag and rejects fork without a parent', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = new OpenClawSessionLifecycleClient(async (method, params) => {
      calls.push({ method, params });
      return response() as never;
    });

    await client.create({
      agentId: 'main',
      label: 'Forked',
      parentSessionKey: ' agent:main:parent ',
      fork: true,
    });

    assert.deepEqual(calls, [{
      method: 'sessions.create',
      params: {
        agentId: 'main',
        label: 'Forked',
        parentSessionKey: 'agent:main:parent',
        fork: true,
      },
    }]);
    await assert.rejects(
      () => client.create({ agentId: 'main', label: 'Forked', fork: true }),
      /fork requires parentSessionKey/,
    );
    assert.equal(calls.length, 1);
  });

  it('omits the optional label for an ordinary session', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = new OpenClawSessionLifecycleClient(async (method, params) => {
      calls.push({ method, params });
      return response({ entry: { sessionId: SESSION_ID } }) as never;
    });

    await client.create({ agentId: ' main ' });

    assert.deepEqual(calls, [{
      method: 'sessions.create',
      params: { agentId: 'main' },
    }]);
  });

  it('accepts the official canonical Agent id returned for a differently cased request', async () => {
    const client = new OpenClawSessionLifecycleClient(async () => response() as never);

    const created = await client.create({ agentId: 'MAIN' });

    assert.equal(created.agentId, 'main');
  });

  it('rejects an unconfirmed or identity-inconsistent response', () => {
    assert.throws(
      () => parseOpenClawCreatedSession({ ok: false }),
      (error: unknown) => error instanceof OpenClawSessionLifecycleResponseError && error.reason === 'not-confirmed',
    );
    assert.throws(
      () => parseOpenClawCreatedSession(response({ entry: { sessionId: 'different' } })),
      (error: unknown) => error instanceof OpenClawSessionLifecycleResponseError && error.reason === 'missing-identity',
    );
    assert.throws(
      () => parseOpenClawCreatedSession(response(), 'research'),
      (error: unknown) => error instanceof OpenClawSessionLifecycleResponseError && error.reason === 'agent-mismatch',
    );
  });

  it('rejects a transcript fork without a parent before sending an RPC', async () => {
    let calls = 0;
    const client = new OpenClawSessionLifecycleClient(async () => {
      calls += 1;
      return response() as never;
    });

    await assert.rejects(
      client.create({ agentId: 'main', label: 'Fork', fork: true }),
      /fork requires parentSessionKey/,
    );
    assert.equal(calls, 0);
  });
});
