import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../test-setup';
import { useChatStore, type ChatMessage, type Session } from '@/stores/chatStore';
import { handleGatewayEvent, useGatewayDataStore } from '@/stores/gatewayDataStore';
import {
  __resetSessionLifecycleForTest,
  coalesceSessionsByKey,
  createAgentSessionKey,
  createLatestRequestGate,
  isSessionDeleted,
} from '@/utils/sessionLifecycle';
import {
  __setSessionDeleteDepsForTest,
  applyConfirmedSessionDeletion,
  deleteSessionEverywhere,
} from '@/utils/sessionDelete';
import { __setSessionRenameDepsForTest, applySessionRename } from '@/utils/sessionRename';
import { __setSessionResetDepsForTest, resetSessionEverywhere } from '@/utils/sessionReset';
import { getSessionDisplayLabel } from '@/utils/sessionLabel';

const MAIN_KEY = 'agent:main:main';
const SESSION_KEY = 'agent:worker:desktop-lifecycle-regression';

function message(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, timestamp: new Date(0).toISOString() };
}

function seedSession(activeSessionKey = SESSION_KEY): Session[] {
  const sessions: Session[] = [
    { key: MAIN_KEY, label: 'Main' },
    { key: SESSION_KEY, label: 'Worker' },
  ];
  useChatStore.setState({
    sessions,
    openTabs: [MAIN_KEY, SESSION_KEY],
    activeSessionKey,
    messages: activeSessionKey === SESSION_KEY ? [message('m1', 'private history')] : [],
    messagesPerSession: { [SESSION_KEY]: [message('m1', 'private history')] },
    _blocksCache: { [SESSION_KEY]: [] },
    _groupsCache: { [SESSION_KEY]: [] },
    typingBySession: { [SESSION_KEY]: true },
    quickRepliesBySession: { [SESSION_KEY]: [{ text: 'Continue', value: 'continue' }] },
    thinkingBySession: { [SESSION_KEY]: { runId: 'run-1', text: 'thinking' } },
    drafts: { [SESSION_KEY]: 'private draft' },
    messageQueue: { [SESSION_KEY]: [{ id: 'q1', text: 'queued', timestamp: 'now' }] },
    draftAttachments: { [SESSION_KEY]: ['/tmp/private.txt'] },
  });
  useGatewayDataStore.setState({ sessions: sessions.map(({ key, label }) => ({ key, label })) });
  return sessions;
}

beforeEach(() => {
  localStorage.clear();
  __resetSessionLifecycleForTest();
  __setSessionDeleteDepsForTest();
  __setSessionRenameDepsForTest();
  __setSessionResetDepsForTest();
  useChatStore.setState({
    sessions: [{ key: MAIN_KEY, label: 'Main' }],
    openTabs: [MAIN_KEY],
    activeSessionKey: MAIN_KEY,
    messages: [],
    messagesPerSession: {},
    _blocksCache: {},
    _groupsCache: {},
    typingBySession: {},
    quickRepliesBySession: {},
    thinkingBySession: {},
    drafts: {},
    messageQueue: {},
    draftAttachments: {},
  });
  useGatewayDataStore.setState({ sessions: [] });
});

describe('session lifecycle regression fixes', () => {
  test('session snapshots collapse by normalized key and keep the newest label', () => {
    const sessions = coalesceSessionsByKey([
      { key: ` ${SESSION_KEY} `, label: '旧名称', updatedAt: '2026-07-20T08:00:00Z' },
      { key: SESSION_KEY, label: '新名称', updatedAt: '2026-07-20T08:01:00Z' },
    ]);

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.key, SESSION_KEY);
    assert.equal(sessions[0]?.label, '新名称');
  });

  test('BUG-01 deletion purges every per-session cache and blocks late writes', () => {
    seedSession();

    assert.equal(applyConfirmedSessionDeletion(SESSION_KEY), true);
    useChatStore.getState().setMessages([message('late', 'late history')], SESSION_KEY);
    useChatStore.getState().addMessage(message('late-stream', 'late stream'), SESSION_KEY);
    useChatStore.getState().setDraft(SESSION_KEY, 'late draft');
    useChatStore.getState().setDraftAttachments(SESSION_KEY, ['/tmp/late.txt']);

    const state = useChatStore.getState();
    assert.equal(isSessionDeleted(SESSION_KEY), true);
    assert.equal(state.sessions.some((session) => session.key === SESSION_KEY), false);
    assert.equal(state.messagesPerSession[SESSION_KEY], undefined);
    assert.equal(state._blocksCache[SESSION_KEY], undefined);
    assert.equal(state._groupsCache[SESSION_KEY], undefined);
    assert.equal(state.typingBySession[SESSION_KEY], undefined);
    assert.equal(state.quickRepliesBySession[SESSION_KEY], undefined);
    assert.equal(state.thinkingBySession[SESSION_KEY], undefined);
    assert.equal(state.drafts[SESSION_KEY], undefined);
    assert.equal(state.messageQueue[SESSION_KEY], undefined);
    assert.equal(state.draftAttachments[SESSION_KEY], undefined);
  });

  test('BUG-02 an external delete event carries the key and removes the gateway row', async () => {
    seedSession();

    handleGatewayEvent('sessions.changed', { reason: 'delete', sessionKey: SESSION_KEY });
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(isSessionDeleted(SESSION_KEY), true);
    assert.equal(useGatewayDataStore.getState().sessions.some((session) => session.key === SESSION_KEY), false);
    const gatewaySource = readFileSync(new URL('../stores/gatewayDataStore.ts', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    assert.match(gatewaySource, /detail: eventDetail/);
    assert.match(appSource, /applyConfirmedSessionDeletion\(detail\.sessionKey\)/);
  });

  test('BUG-02 confirmed external deletion closes the active tab and selects a valid fallback', () => {
    seedSession();

    applyConfirmedSessionDeletion(SESSION_KEY);

    const state = useChatStore.getState();
    assert.deepEqual(state.openTabs, [MAIN_KEY]);
    assert.equal(state.activeSessionKey, MAIN_KEY);
    assert.equal(state.sessions.some((session) => session.key === SESSION_KEY), false);
  });

  test('BUG-03 request gate rejects stale responses and tombstones reject stale lists', () => {
    const gate = createLatestRequestGate();
    const staleRequest = gate.begin();
    const currentRequest = gate.begin();
    assert.equal(gate.isCurrent(staleRequest), false);
    assert.equal(gate.isCurrent(currentRequest), true);

    const sessions = seedSession();
    applyConfirmedSessionDeletion(SESSION_KEY);
    useChatStore.getState().setSessions(sessions);
    useGatewayDataStore.getState().setSessions(sessions.map(({ key, label }) => ({ key, label })));

    assert.equal(useChatStore.getState().sessions.some((session) => session.key === SESSION_KEY), false);
    assert.equal(useGatewayDataStore.getState().sessions.some((session) => session.key === SESSION_KEY), false);
  });

  test('BUG-04 rename rejects explicit Gateway failures without changing local state', async () => {
    seedSession();
    const failures: string[] = [];
    __setSessionRenameDepsForTest({
      patchLabel: async () => ({ ok: false, error: { message: 'label rejected' } }),
      notifyFailure: (detail) => failures.push(detail),
      warn: () => {},
    });

    const result = await applySessionRename(SESSION_KEY, 'Changed');

    assert.deepEqual(result, { ok: false, error: 'label rejected' });
    assert.equal(useChatStore.getState().sessions.find((session) => session.key === SESSION_KEY)?.label, 'Worker');
    assert.deepEqual(failures, ['label rejected']);
  });

  test('BUG-04 rename requests are serialized and only the latest intent is applied', async () => {
    seedSession();
    let releaseFirst!: (value: unknown) => void;
    const firstResponse = new Promise<unknown>((resolve) => { releaseFirst = resolve; });
    const calls: Array<string | null> = [];
    __setSessionRenameDepsForTest({
      patchLabel: async (_key, label) => {
        calls.push(label);
        if (label === 'First') return firstResponse;
        return { entry: { label } };
      },
      notifyFailure: () => {},
      warn: () => {},
    });

    const first = applySessionRename(SESSION_KEY, 'First');
    const second = applySessionRename(SESSION_KEY, 'Second');
    await Promise.resolve();
    assert.deepEqual(calls, ['First']);

    releaseFirst({ entry: { label: 'First' } });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(firstResult.ok && firstResult.superseded, true);
    assert.deepEqual(secondResult, { ok: true, label: 'Second' });
    assert.deepEqual(calls, ['First', 'Second']);
    assert.equal(useChatStore.getState().sessions.find((session) => session.key === SESSION_KEY)?.label, 'Second');
  });

  test('BUG-05 reset preserves local history when Gateway rejects the mutation', async () => {
    seedSession();
    __setSessionResetDepsForTest({
      resetRemote: async () => ({ success: false, message: 'session still active' }),
      notifyFailure: () => {},
      warn: () => {},
    });

    assert.equal(await resetSessionEverywhere(SESSION_KEY), false);
    assert.deepEqual(useChatStore.getState().messagesPerSession[SESSION_KEY], [message('m1', 'private history')]);
    assert.equal(useChatStore.getState().messageQueue[SESSION_KEY]?.length, 1);
  });

  test('BUG-05 reset clears history, queue, and tokens only after success', async () => {
    seedSession();
    useChatStore.setState({ sessions: [
      { key: MAIN_KEY, label: 'Main' },
      { key: SESSION_KEY, label: 'Worker', totalTokens: 42, contextTokens: 100 },
    ] });
    __setSessionResetDepsForTest({
      resetRemote: async () => ({ ok: true }),
      notifyFailure: () => {},
      warn: () => {},
    });

    assert.equal(await resetSessionEverywhere(SESSION_KEY), true);
    assert.deepEqual(useChatStore.getState().messagesPerSession[SESSION_KEY], []);
    assert.deepEqual(useChatStore.getState().messageQueue[SESSION_KEY], []);
    assert.equal(useChatStore.getState().sessions.find((session) => session.key === SESSION_KEY)?.totalTokens, 0);
  });

  test('BUG-06 concurrent deletes share one Gateway request', async () => {
    seedSession();
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
    let requests = 0;
    __setSessionDeleteDepsForTest({
      deleteRemote: async () => {
        requests += 1;
        await deleteGate;
        return { ok: true, deleted: true };
      },
      notifyFailure: () => {},
      warn: () => {},
    });

    const first = deleteSessionEverywhere(SESSION_KEY);
    const second = deleteSessionEverywhere(SESSION_KEY);
    assert.equal(first, second);
    releaseDelete();
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(requests, 1);
  });

  test('BUG-06 confirmation dialog awaits and disables an in-flight action', () => {
    const source = readFileSync(new URL('../components/shared/AlertDialog.tsx', import.meta.url), 'utf8');
    assert.match(source, /await onConfirm\(\)/);
    assert.match(source, /disabled=\{confirming\}/);
    assert.match(source, /aria-busy=\{confirming/);
  });

  test('BUG-07 generated keys remain unique within the same millisecond', () => {
    const originalNow = Date.now;
    Date.now = () => 1_720_000_000_000;
    try {
      const first = createAgentSessionKey('main');
      const second = createAgentSessionKey('main');
      assert.notEqual(first, second);
      assert.match(first, /^agent:main:desktop-[a-z0-9]+-[a-z0-9]+$/);
      assert.equal(
        getSessionDisplayLabel({ key: first, label: '新会话' }, { genericSessionLabel: '会话' }),
        '会话',
      );
      assert.equal(
        getSessionDisplayLabel(
          { key: 'agent:worker:main', label: 'Main Session' },
          { mainSessionLabel: '主会话' },
        ),
        '主会话',
      );
    } finally {
      Date.now = originalNow;
    }
  });

  test('BUG-07 route-based creation consumes params through React Router and can repeat', () => {
    const source = readFileSync(new URL('../hooks/useAgentScopedSession.ts', import.meta.url), 'utf8');
    assert.match(source, /handledLocationKeyRef/);
    assert.match(source, /setParams\(nextParams, \{ replace: true \}\)/);
    assert.doesNotMatch(source, /window\.history\.replaceState|appliedRef/);
  });

  test('BUG-08 pinned sessions survive a store reload and deletion clears the preference', () => {
    seedSession(MAIN_KEY);
    useChatStore.getState().togglePinSession(SESSION_KEY);
    assert.equal(JSON.parse(localStorage.getItem('aegis:session-pin-prefs') || '{}')[SESSION_KEY], true);

    useChatStore.setState({ sessions: [] });
    useChatStore.getState().setSessions([{ key: MAIN_KEY, label: 'Main' }, { key: SESSION_KEY, label: 'Worker' }]);
    assert.equal(useChatStore.getState().sessions.find((session) => session.key === SESSION_KEY)?.pinned, true);

    useChatStore.getState().togglePinSession(SESSION_KEY);
    useChatStore.setState({ sessions: [] });
    useChatStore.getState().setSessions([{ key: MAIN_KEY, label: 'Main' }, { key: SESSION_KEY, label: 'Worker', pinned: true }]);
    assert.equal(useChatStore.getState().sessions.find((session) => session.key === SESSION_KEY)?.pinned, false);

    useChatStore.getState().removeSession(SESSION_KEY);
    assert.equal(JSON.parse(localStorage.getItem('aegis:session-pin-prefs') || '{}')[SESSION_KEY], undefined);
  });
});
