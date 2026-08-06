import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  createNativeSession,
  projectCreatedNativeSession,
  setSessionCreateDependenciesForTests,
  type CreateNativeSessionInput,
} from './sessionCreate';
import { subscribeNativeSessionCommit } from './sessionLifecycle';
import type { OpenClawCreatedSession } from '@/services/gateway/OpenClawSessionLifecycleClient';

const CREATED: OpenClawCreatedSession = {
  key: 'agent:main:created',
  sessionId: 'created-id',
  entry: { sessionId: 'created-id', label: 'Created', createdAt: 1 },
};

afterEach(() => setSessionCreateDependenciesForTests());

describe('createNativeSession', () => {
  it('将非 fork 的确认创建绑定到目标 Agent 并投影权威空 transcript leaf', () => {
    const session = projectCreatedNativeSession(CREATED, {
      agentId: 'architect',
      label: 'Created',
    });
    const fork = projectCreatedNativeSession(CREATED, {
      agentId: 'architect',
      label: 'Forked',
      parentSessionKey: 'agent:architect:parent',
      fork: true,
    });

    assert.deepEqual(
      {
        key: session.key,
        sessionId: session.sessionId,
        agentId: session.agentId,
        activeLeafEntryId: session.activeLeafEntryId,
        initialLabel: session.initialLabel,
      },
      {
        key: CREATED.key,
        sessionId: CREATED.sessionId,
        agentId: 'architect',
        activeLeafEntryId: null,
        initialLabel: 'Created',
      },
    );
    assert.equal(fork.activeLeafEntryId, undefined);
    assert.equal(fork.initialLabel, undefined);

    const createdWithoutLabel = projectCreatedNativeSession({
      key: 'agent:architect:without-label',
      sessionId: 'without-label-id',
      entry: { sessionId: 'without-label-id', createdAt: 2 },
    }, {
      agentId: 'architect',
      label: '新会话',
    });
    assert.equal(createdWithoutLabel.label, '新会话');
    assert.equal(createdWithoutLabel.initialLabel, '新会话');
  });

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

  it('notifies the authoritative list owner after the confirmed session is committed', async () => {
    let notifications = 0;
    const unsubscribe = subscribeNativeSessionCommit(() => { notifications += 1; });
    try {
      setSessionCreateDependenciesForTests({
        createRemote: async () => CREATED,
        commit: (created, input) => ({
          key: created.key,
          sessionId: created.sessionId,
          label: input.label,
        }),
      });

      const result = await createNativeSession({ agentId: 'main', label: 'Created' });
      assert.equal(result.ok, true);
      assert.equal(notifications, 1);
    } finally {
      unsubscribe();
    }
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

  it('keeps distinct labels and fork semantics as separate Gateway intents', async () => {
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

    const first = createNativeSession({ agentId: 'main', label: 'First' });
    const duplicate = createNativeSession({ agentId: ' main ', label: ' First ' });
    const differentLabel = createNativeSession({ agentId: 'main', label: 'Second' });
    const child = createNativeSession({
      agentId: 'main', label: 'Branch', parentSessionKey: 'agent:main:parent',
    });
    const fork = createNativeSession({
      agentId: 'main', label: 'Branch', parentSessionKey: 'agent:main:parent', fork: true,
    });

    assert.equal(first, duplicate);
    await Promise.all([first, differentLabel, child, fork]);
    assert.deepEqual(requests, [
      { agentId: 'main', label: 'First' },
      { agentId: 'main', label: 'Second' },
      { agentId: 'main', label: 'Branch', parentSessionKey: 'agent:main:parent' },
      { agentId: 'main', label: 'Branch', parentSessionKey: 'agent:main:parent', fork: true },
    ]);
  });

  it('rejects a transcript fork without a parent before calling Gateway', async () => {
    let requests = 0;
    setSessionCreateDependenciesForTests({
      createRemote: async () => {
        requests += 1;
        return CREATED;
      },
    });

    assert.deepEqual(
      await createNativeSession({ agentId: 'main', label: 'Fork', fork: true }),
      { ok: false, error: 'fork requires parentSessionKey' },
    );
    assert.equal(requests, 0);
  });
});
