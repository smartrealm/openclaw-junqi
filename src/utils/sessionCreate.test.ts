import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  createNativeSession,
  setSessionCreateDependenciesForTests,
  type CreateNativeSessionInput,
} from './sessionCreate';
import type { OpenClawCreatedSession } from '@/services/gateway/OpenClawSessionLifecycleClient';

const CREATED: OpenClawCreatedSession = {
  key: 'agent:main:created',
  sessionId: 'created-id',
  entry: { sessionId: 'created-id', label: 'Created', createdAt: 1 },
};

afterEach(() => setSessionCreateDependenciesForTests());

describe('createNativeSession', () => {
  it('does not commit a renderer session until Gateway confirms its identity', async () => {
    let resolveRemote!: (value: OpenClawCreatedSession) => void;
    const remote = new Promise<OpenClawCreatedSession>((resolve) => { resolveRemote = resolve; });
    let commits = 0;
    setSessionCreateDependenciesForTests({
      createRemote: () => remote,
      commit: (created, input) => {
        commits += 1;
        return { key: created.key, sessionId: created.sessionId, label: input.label };
      },
    });

    const creation = createNativeSession({ agentId: 'main', label: '  Created  ' });
    assert.equal(commits, 0);
    resolveRemote(CREATED);

    assert.deepEqual(await creation, {
      ok: true,
      session: { key: CREATED.key, sessionId: CREATED.sessionId, label: 'Created' },
    });
    assert.equal(commits, 1);
  });

  it('preserves the explicit transcript fork intent through the coordinator', async () => {
    const requests: CreateNativeSessionInput[] = [];
    setSessionCreateDependenciesForTests({
      createRemote: async (input) => {
        requests.push(input);
        return CREATED;
      },
      commit: (created, input) => ({
        key: created.key,
        sessionId: created.sessionId,
        label: input.label,
      }),
    });

    await createNativeSession({
      agentId: 'main',
      label: 'Forked',
      parentSessionKey: 'agent:main:parent',
      fork: true,
    });

    assert.deepEqual(requests, [{
      agentId: 'main',
      label: 'Forked',
      parentSessionKey: 'agent:main:parent',
      fork: true,
    }]);
  });

  it('does not coalesce create intents with different labels or fork semantics', async () => {
    let resolveRemote!: (value: OpenClawCreatedSession) => void;
    const remote = new Promise<OpenClawCreatedSession>((resolve) => { resolveRemote = resolve; });
    const requests: CreateNativeSessionInput[] = [];
    setSessionCreateDependenciesForTests({
      createRemote: async (input) => {
        requests.push(input);
        return remote;
      },
      commit: (created, input) => ({
        key: `${created.key}:${input.label}:${input.fork === true ? 'fork' : 'child'}`,
        sessionId: created.sessionId,
        label: input.label,
      }),
    });

    const first = createNativeSession({
      agentId: 'main',
      label: 'Child',
      parentSessionKey: 'agent:main:parent',
    });
    const second = createNativeSession({
      agentId: 'main',
      label: 'Forked',
      parentSessionKey: 'agent:main:parent',
      fork: true,
    });

    assert.notEqual(first, second);
    assert.deepEqual(requests, [
      { agentId: 'main', label: 'Child', parentSessionKey: 'agent:main:parent' },
      { agentId: 'main', label: 'Forked', parentSessionKey: 'agent:main:parent', fork: true },
    ]);
    resolveRemote(CREATED);
    await Promise.all([first, second]);
  });

  it('coalesces duplicate create intents and preserves a failed renderer state', async () => {
    let requests = 0;
    let commits = 0;
    setSessionCreateDependenciesForTests({
      createRemote: async () => {
        requests += 1;
        throw new Error('gateway offline');
      },
      commit: () => {
        commits += 1;
        throw new Error('must not commit');
      },
    });

    const first = createNativeSession({ agentId: 'main', label: 'Created' });
    const second = createNativeSession({ agentId: 'main', label: 'Created' });
    assert.equal(first, second);
    assert.deepEqual(await first, { ok: false, error: 'gateway offline' });
    assert.equal(requests, 1);
    assert.equal(commits, 0);
  });
});
