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
    assert.equal(created.sessionId, SESSION_ID);
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
