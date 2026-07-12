import test from 'node:test';
import assert from 'node:assert/strict';
import { useChatStore, type Session } from './chatStore';

const MAIN_KEY = 'agent:main:main';
const OTHER_KEY = 'agent:worker:main';

function seedSessions(activeSessionKey = MAIN_KEY) {
  const sessions: Session[] = [
    { key: MAIN_KEY, label: 'Main', model: 'anthropic/claude-sonnet-4-6' },
    { key: OTHER_KEY, label: 'Worker', model: 'openai/gpt-4o' },
  ];
  useChatStore.setState({
    sessions,
    activeSessionKey,
    currentModel: sessions.find((s) => s.key === activeSessionKey)?.model ?? null,
    manualModelOverride: null,
  });
}

test('setSessionModel updates the session row and active currentModel', () => {
  seedSessions(MAIN_KEY);

  useChatStore.getState().setSessionModel(MAIN_KEY, 'google/gemini-2.5-pro');

  const state = useChatStore.getState();
  assert.equal(state.currentModel, 'google/gemini-2.5-pro');
  assert.equal(
    state.sessions.find((session) => session.key === MAIN_KEY)?.model,
    'google/gemini-2.5-pro',
  );
});

test('setSessionModel does not overwrite currentModel for inactive sessions', () => {
  seedSessions(MAIN_KEY);

  useChatStore.getState().setSessionModel(OTHER_KEY, 'deepseek/deepseek-v4-pro');

  const state = useChatStore.getState();
  assert.equal(state.currentModel, 'anthropic/claude-sonnet-4-6');
  assert.equal(
    state.sessions.find((session) => session.key === OTHER_KEY)?.model,
    'deepseek/deepseek-v4-pro',
  );
});

test('setSessionModel upserts a local session row when sessions.list has not caught up', () => {
  const desktopKey = 'agent:main:desktop-123';
  seedSessions(desktopKey);
  useChatStore.setState({ sessions: [] });

  useChatStore.getState().setSessionModel(desktopKey, 'openai/gpt-5.4');

  const state = useChatStore.getState();
  assert.equal(state.currentModel, 'openai/gpt-5.4');
  assert.deepEqual(
    state.sessions.find((session) => session.key === desktopKey),
    { key: desktopKey, label: desktopKey, model: 'openai/gpt-5.4' },
  );
});

test('setSessions follows the Gateway session list after a deletion', () => {
  const deletedKey = 'agent:worker:s-deleted';
  useChatStore.getState().setSessions([
    { key: MAIN_KEY, label: 'Main' },
  ]);

  const state = useChatStore.getState();
  assert.equal(state.sessions.some((session) => session.key === deletedKey), false);
  assert.equal(state.sessions.some((session) => session.key === MAIN_KEY), true);
});

test('removeSession closes the tab, switches active session, and persists tab order', () => {
  const deletedKey = 'agent:worker:s-delete-tab';
  useChatStore.setState({
    sessions: [
      { key: MAIN_KEY, label: 'Main' },
      { key: deletedKey, label: 'Delete me' },
    ],
    openTabs: [MAIN_KEY, deletedKey],
    activeSessionKey: deletedKey,
    messagesPerSession: {
      [deletedKey]: [{
        id: 'm1',
        role: 'user',
        content: 'delete me',
        timestamp: new Date(0).toISOString(),
      }],
    },
  });

  useChatStore.getState().removeSession(deletedKey);

  const state = useChatStore.getState();
  assert.deepEqual(state.openTabs, [MAIN_KEY]);
  assert.equal(state.activeSessionKey, MAIN_KEY);
  assert.equal(state.sessions.some((session) => session.key === deletedKey), false);
  assert.equal(state.messagesPerSession[deletedKey], undefined);
  assert.equal(localStorage.getItem('aegis-open-tabs'), JSON.stringify([MAIN_KEY]));
});
