import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectActiveSessionThinking,
  selectActiveSessionTyping,
  selectSessionRequestActive,
  useChatStore,
  type Session,
} from './chatStore';
import { normalizeHistoryMessage } from '@/processing/normalizeHistoryMessage';
import { gateway } from '@/services/gateway';
import { OpenClawSessionGroupsUnsupportedError } from '@/services/gateway/OpenClawSessionGroupsClient';
import { subscribeSessionIdentityTransitions } from '@/services/chat/sessionIdentityTransition';
import {
  __resetSessionOrganizationForTests,
} from '@/services/chat/sessionOrganization';
import { markSessionDeleted, restoreSessionKey } from '@/utils/sessionLifecycle';

const MAIN_KEY = 'agent:main:main';
const OTHER_KEY = 'agent:worker:main';

function seedSessions(activeSessionKey = MAIN_KEY) {
  const sessions: Session[] = [
    { key: MAIN_KEY, label: 'Main', model: 'anthropic/claude-sonnet-4-6', thinkingLevel: 'low' },
    { key: OTHER_KEY, label: 'Worker', model: 'openai/gpt-4o', thinkingLevel: 'medium' },
  ];
  useChatStore.setState({
    sessions,
    activeSessionKey,
    currentModel: sessions.find((s) => s.key === activeSessionKey)?.model ?? null,
    currentThinking: sessions.find((s) => s.key === activeSessionKey)?.thinkingLevel ?? null,
    manualModelOverride: null,
  });
}

test('only a Gateway-owned request is eligible for a native Stop', () => {
  const sessionKey = 'agent:main:pending-send';
  const inactive = { typingBySession: {}, sendingBySession: {} };
  const sending = { typingBySession: {}, sendingBySession: { [sessionKey]: true } };
  const streaming = { typingBySession: { [sessionKey]: true }, sendingBySession: {} };

  assert.equal(selectSessionRequestActive(inactive, sessionKey), false);
  assert.equal(selectSessionRequestActive(sending, sessionKey), false);
  assert.equal(selectSessionRequestActive(streaming, sessionKey), true);
});

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

test('setSessionThinking updates only the matching session and active title state', () => {
  seedSessions(MAIN_KEY);

  useChatStore.getState().setSessionThinking(OTHER_KEY, 'high');
  assert.equal(useChatStore.getState().currentThinking, 'low');
  assert.equal(
    useChatStore.getState().sessions.find((session) => session.key === OTHER_KEY)?.thinkingLevel,
    'high',
  );

  useChatStore.getState().setSessionThinking(MAIN_KEY, 'xhigh');
  assert.equal(useChatStore.getState().currentThinking, 'xhigh');
});

test('setSessionFastMode updates only the matching session', () => {
  seedSessions(MAIN_KEY);

  useChatStore.getState().setSessionFastMode(OTHER_KEY, 'auto');
  assert.equal(
    useChatStore.getState().sessions.find((session) => session.key === OTHER_KEY)?.fastMode,
    'auto',
  );
  assert.equal(
    useChatStore.getState().sessions.find((session) => session.key === MAIN_KEY)?.fastMode,
    undefined,
  );

  useChatStore.getState().setSessionFastMode(MAIN_KEY, false);
  assert.equal(
    useChatStore.getState().sessions.find((session) => session.key === MAIN_KEY)?.fastMode,
    false,
  );
});

test('setSessionVerbose updates only the matching session', () => {
  seedSessions(MAIN_KEY);

  useChatStore.getState().setSessionVerbose(OTHER_KEY, 'full');
  assert.equal(
    useChatStore.getState().sessions.find((session) => session.key === OTHER_KEY)?.verboseLevel,
    'full',
  );
  assert.equal(
    useChatStore.getState().sessions.find((session) => session.key === MAIN_KEY)?.verboseLevel,
    undefined,
  );

  useChatStore.getState().setSessionVerbose(MAIN_KEY, 'off');
  assert.equal(
    useChatStore.getState().sessions.find((session) => session.key === MAIN_KEY)?.verboseLevel,
    'off',
  );
});

test('setSessionReasoning updates only the matching session', () => {
  seedSessions(MAIN_KEY);

  useChatStore.getState().setSessionReasoning(OTHER_KEY, 'stream');
  assert.equal(
    useChatStore.getState().sessions.find((session) => session.key === OTHER_KEY)?.reasoningLevel,
    'stream',
  );
  assert.equal(
    useChatStore.getState().sessions.find((session) => session.key === MAIN_KEY)?.reasoningLevel,
    undefined,
  );

  useChatStore.getState().setSessionReasoning(MAIN_KEY, 'off');
  assert.equal(
    useChatStore.getState().sessions.find((session) => session.key === MAIN_KEY)?.reasoningLevel,
    'off',
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
  useChatStore.setState({
    sessions: [
      { key: MAIN_KEY, label: 'Main' },
      { key: deletedKey, label: 'Delete me' },
    ],
    openTabs: [MAIN_KEY, deletedKey],
    activeSessionKey: deletedKey,
  });
  useChatStore.getState().setSessions([
    { key: MAIN_KEY, label: 'Main' },
  ]);

  const state = useChatStore.getState();
  assert.equal(state.sessions.some((session) => session.key === deletedKey), false);
  assert.equal(state.sessions.some((session) => session.key === MAIN_KEY), true);
  assert.deepEqual(state.openTabs, [MAIN_KEY]);
  assert.equal(state.activeSessionKey, MAIN_KEY);
});

test('a partial sessions.list page preserves sessions outside the current page', () => {
  const outsidePageKey = 'agent:worker:outside-partial-page';
  useChatStore.setState({
    sessions: [
      { key: MAIN_KEY, label: 'Main' },
      { key: outsidePageKey, label: 'Outside page' },
    ],
    openTabs: [MAIN_KEY, outsidePageKey],
    activeSessionKey: outsidePageKey,
  });

  useChatStore.getState().setSessions(
    [{ key: MAIN_KEY, label: 'Main updated' }],
    undefined,
    { completeSnapshot: false },
  );

  const state = useChatStore.getState();
  assert.equal(state.sessions.find((session) => session.key === MAIN_KEY)?.label, 'Main updated');
  assert.equal(state.sessions.some((session) => session.key === outsidePageKey), true);
  assert.deepEqual(state.openTabs, [MAIN_KEY, outsidePageKey]);
  assert.equal(state.activeSessionKey, outsidePageKey);
});

test('a complete snapshot started before a confirmed new session cannot select a historical fallback', () => {
  const createdKey = 'agent:main:dashboard-created';
  useChatStore.setState({
    sessions: [
      { key: MAIN_KEY, label: 'Main' },
      { key: OTHER_KEY, label: 'History' },
    ],
    openTabs: [MAIN_KEY, OTHER_KEY],
    activeSessionKey: OTHER_KEY,
    sessionProjectionRevision: 40,
  });
  const sourceProjectionRevision = useChatStore.getState().sessionProjectionRevision;

  useChatStore.getState().addNativeSession({
    key: createdKey,
    sessionId: 'created-id',
    label: 'Created',
  });
  useChatStore.getState().setSessions([
    { key: MAIN_KEY, label: 'Main' },
    { key: OTHER_KEY, label: 'History' },
  ], undefined, {
    completeSnapshot: true,
    sourceProjectionRevision,
  });

  const state = useChatStore.getState();
  assert.equal(state.activeSessionKey, createdKey);
  assert.equal(state.openTabs.includes(createdKey), true);
  assert.equal(state.sessions.some((session) => session.key === createdKey), true);
});

test('a complete snapshot started after a native create can reconcile a missing session', () => {
  const createdKey = 'agent:main:dashboard-deleted';
  useChatStore.setState({
    sessions: [
      { key: MAIN_KEY, label: 'Main' },
      { key: OTHER_KEY, label: 'History' },
    ],
    openTabs: [MAIN_KEY, OTHER_KEY],
    activeSessionKey: OTHER_KEY,
    sessionProjectionRevision: 50,
  });
  useChatStore.getState().addNativeSession({
    key: createdKey,
    sessionId: 'created-id',
    label: 'Created',
  });
  const sourceProjectionRevision = useChatStore.getState().sessionProjectionRevision;

  useChatStore.getState().setSessions([
    { key: MAIN_KEY, label: 'Main' },
    { key: OTHER_KEY, label: 'History' },
  ], undefined, {
    completeSnapshot: true,
    sourceProjectionRevision,
  });

  const state = useChatStore.getState();
  assert.equal(state.sessions.some((session) => session.key === createdKey), false);
  assert.equal(state.activeSessionKey, OTHER_KEY);
});

test('a stale snapshot cannot rotate a locally replaced session identity backward', () => {
  useChatStore.setState({
    sessions: [
      { key: MAIN_KEY, label: 'Main', sessionId: 'main-id' },
      { key: OTHER_KEY, label: 'Replacement', sessionId: 'new-id' },
    ],
    activeSessionKey: OTHER_KEY,
    sessionProjectionRevision: 60,
  });

  useChatStore.getState().setSessions([
    { key: MAIN_KEY, label: 'Main', sessionId: 'main-id' },
    { key: OTHER_KEY, label: 'Old snapshot', sessionId: 'old-id' },
  ], undefined, {
    completeSnapshot: true,
    sourceProjectionRevision: 59,
  });

  const session = useChatStore.getState().sessions.find((candidate) => candidate.key === OTHER_KEY);
  assert.equal(session?.sessionId, 'new-id');
  assert.equal(session?.label, 'Old snapshot');
});

test('setSessions stores metadata without bypassing the run projection', () => {
  useChatStore.setState({
    sessions: [{ key: MAIN_KEY, label: 'Main', hasActiveRun: true }],
    activeSessionKey: MAIN_KEY,
    typingBySession: { [MAIN_KEY]: true },
    typingStartedAtBySession: { [MAIN_KEY]: 1_000 },
    thinkingBySession: { [MAIN_KEY]: { runId: 'run-stale', text: 'still thinking' } },
  });

  useChatStore.getState().setSessions([
    { key: MAIN_KEY, label: 'Main', hasActiveRun: false },
  ]);

  const state = useChatStore.getState();
  assert.equal(state.sessions.find((session) => session.key === MAIN_KEY)?.hasActiveRun, false);
  assert.equal(state.typingBySession[MAIN_KEY], true);
  assert.equal(state.typingStartedAtBySession[MAIN_KEY], 1_000);
  assert.deepEqual(state.thinkingBySession[MAIN_KEY], { runId: 'run-stale', text: 'still thinking' });
});

test('an equivalent sessions.list refresh preserves session object references', () => {
  const origin = {
    provider: 'desktop',
    surface: 'dashboard',
    threadId: 'thread-main',
  };
  useChatStore.setState({
    sessions: [],
    activeSessionKey: MAIN_KEY,
    currentModel: 'openai/gpt-5.4',
    currentThinking: 'medium',
    manualModelOverride: null,
  });
  useChatStore.getState().setSessions([{
      key: MAIN_KEY,
      label: 'Main',
      model: 'openai/gpt-5.4',
      thinkingLevel: 'medium',
      totalTokens: 1_024,
      contextTokens: 128_000,
      origin,
  }]);
  const previous = useChatStore.getState().sessions[0];

  useChatStore.getState().setSessions([{
    key: MAIN_KEY,
    label: 'Main',
    model: 'openai/gpt-5.4',
    thinkingLevel: 'medium',
    totalTokens: 1_024,
    contextTokens: 128_000,
    origin: { ...origin },
  }]);

  assert.equal(useChatStore.getState().sessions[0], previous);
});

test('sessionId rotation atomically replaces transcript state and resets identity-bound organization', () => {
  const transitions: Array<{ previousSessionId: string; nextSessionId: string }> = [];
  const unsubscribe = subscribeSessionIdentityTransitions((transition) => {
    if (transition.sessionKey === OTHER_KEY) transitions.push(transition);
  });
  useChatStore.setState({
    sessions: [
      { key: MAIN_KEY, label: 'Main', sessionId: 'main-id' },
      { key: OTHER_KEY, label: 'Old transcript', sessionId: 'old-id', pinned: true },
    ],
    activeSessionKey: OTHER_KEY,
    messages: [{ id: 'old', role: 'assistant', content: 'old', timestamp: '2026-01-01' }],
    messagesPerSession: {
      [OTHER_KEY]: [{ id: 'old', role: 'assistant', content: 'old', timestamp: '2026-01-01' }],
    },
    typingBySession: { [OTHER_KEY]: true },
    chatSendTimingBySession: {
      [OTHER_KEY]: {
        sessionKey: OTHER_KEY,
        runId: 'run-old',
        phase: 'agent-run-started',
        ackToPhaseMs: 12,
        receivedToPhaseMs: 18,
      },
    },
    thinkingBySession: { [OTHER_KEY]: { runId: 'run-old', text: 'old thought' } },
    messageQueue: { [OTHER_KEY]: [{ id: 'queued-old', text: 'old', timestamp: '2026-01-01' }] },
    drafts: { [OTHER_KEY]: 'keep this draft' },
  });

  useChatStore.getState().setSessions([
    { key: MAIN_KEY, label: 'Main', sessionId: 'main-id' },
    { key: OTHER_KEY, label: 'New transcript', sessionId: 'new-id' },
  ]);
  unsubscribe();

  const state = useChatStore.getState();
  assert.equal(state.messagesPerSession[OTHER_KEY], undefined);
  assert.equal(state.typingBySession[OTHER_KEY], undefined);
  assert.equal(state.chatSendTimingBySession[OTHER_KEY], undefined);
  assert.equal(state.thinkingBySession[OTHER_KEY], undefined);
  assert.equal(state.messageQueue[OTHER_KEY], undefined);
  assert.deepEqual(state.messages, []);
  assert.equal(state.drafts[OTHER_KEY], 'keep this draft');
  assert.equal(state.sessions.find((session) => session.key === OTHER_KEY)?.pinned, undefined);
  assert.equal(state.sessions.find((session) => session.key === OTHER_KEY)?.sessionId, 'new-id');
  assert.deepEqual(transitions, [{
    sessionKey: OTHER_KEY,
    previousSessionId: 'old-id',
    nextSessionId: 'new-id',
  }]);
});

test('settleSessionRunUi atomically clears one session without disturbing another', () => {
  seedSessions(MAIN_KEY);
  useChatStore.setState({
    typingBySession: { [MAIN_KEY]: true, [OTHER_KEY]: true },
    typingStartedAtBySession: { [MAIN_KEY]: 1_000, [OTHER_KEY]: 2_000 },
    chatSendTimingBySession: {
      [MAIN_KEY]: {
        sessionKey: MAIN_KEY,
        runId: 'run-main',
        phase: 'agent-run-started',
        ackToPhaseMs: 10,
        receivedToPhaseMs: 14,
      },
      [OTHER_KEY]: {
        sessionKey: OTHER_KEY,
        runId: 'run-other',
        phase: 'model-selected',
        ackToPhaseMs: 16,
        receivedToPhaseMs: 21,
      },
    },
    thinkingBySession: {
      [MAIN_KEY]: { runId: 'run-main', text: 'main thinking' },
      [OTHER_KEY]: { runId: 'run-other', text: 'other thinking' },
    },
    sendingBySession: { [MAIN_KEY]: true, [OTHER_KEY]: true },
  });

  useChatStore.getState().settleSessionRunUi(MAIN_KEY);

  const state = useChatStore.getState();
  assert.equal(selectActiveSessionTyping(state), false);
  assert.deepEqual(selectActiveSessionThinking(state), { runId: null, text: '' });
  assert.equal(state.typingStartedAtBySession[MAIN_KEY], undefined);
  assert.equal(state.chatSendTimingBySession[MAIN_KEY], undefined);
  assert.equal(state.sendingBySession[MAIN_KEY], false);
  assert.equal(state.typingBySession[OTHER_KEY], true);
  assert.equal(state.typingStartedAtBySession[OTHER_KEY], 2_000);
  assert.equal(state.chatSendTimingBySession[OTHER_KEY]?.runId, 'run-other');
  assert.deepEqual(state.thinkingBySession[OTHER_KEY], { runId: 'run-other', text: 'other thinking' });
  assert.equal(state.sendingBySession[OTHER_KEY], true);
});

test('setMessages enforces one projection per message id and keeps terminal state', () => {
  seedSessions(MAIN_KEY);
  useChatStore.getState().setMessages([
    {
      id: 'same-live-id',
      role: 'assistant',
      content: 'Complete answer.',
      timestamp: '2026-07-22T00:00:00.000Z',
      isStreaming: false,
      responseState: 'final',
    },
    {
      id: 'same-live-id',
      role: 'assistant',
      content: 'Complete answer.',
      timestamp: '2026-07-22T00:00:00.000Z',
      isStreaming: true,
      responseState: 'streaming',
    },
  ], MAIN_KEY);

  const messages = useChatStore.getState().messagesPerSession[MAIN_KEY];
  assert.equal(messages.length, 1);
  assert.equal(messages[0].responseState, 'final');
  assert.equal(messages[0].isStreaming, false);
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
    sideQuestionResultsBySession: {
      [deletedKey]: {
        'btw-delete': {
          kind: 'btw',
          sessionKey: deletedKey,
          runId: 'btw-delete',
          question: 'Temporary question',
          text: 'Temporary answer',
          isError: false,
          ts: 1_773_000_000_000,
        },
      },
    },
  });

  useChatStore.getState().removeSession(deletedKey);

  const state = useChatStore.getState();
  assert.deepEqual(state.openTabs, [MAIN_KEY]);
  assert.equal(state.activeSessionKey, MAIN_KEY);
  assert.equal(state.sessions.some((session) => session.key === deletedKey), false);
  assert.equal(state.messagesPerSession[deletedKey], undefined);
  assert.equal(state.sideQuestionResultsBySession[deletedKey], undefined);
  assert.equal(localStorage.getItem('aegis-open-tabs'), JSON.stringify([MAIN_KEY]));
});

test('opening or replacing the active tab does not create a local unread marker', () => {
  const unreadKey = 'agent:worker:unread-target';
  const unreadSession = { key: unreadKey, sessionId: 'gateway-session-id', label: 'Unread target' };
  const mainSession = { key: MAIN_KEY, sessionId: 'main-gateway-session-id', label: 'Main' };
  __resetSessionOrganizationForTests();
  useChatStore.setState({
    sessions: [mainSession, unreadSession],
    openTabs: [MAIN_KEY],
    activeSessionKey: MAIN_KEY,
  });

  useChatStore.getState().openTab(unreadKey);

  assert.equal(localStorage.getItem('junqi:session-organization:v1'), null);

  useChatStore.getState().closeTab(unreadKey);
  assert.equal(localStorage.getItem('junqi:session-organization:v1'), null);
  __resetSessionOrganizationForTests();
});

test('session category updates only after Gateway confirms the patched entry', async () => {
  const setSessionCategory = gateway.setSessionCategory;
  const sessionKey = 'agent:main:jarvis';
  Object.assign(gateway, {
    setSessionCategory: async () => 'Jarvis: JunQi',
  });
  useChatStore.setState({
    sessions: [{ key: sessionKey, label: 'Jarvis session' }],
  });

  try {
    await useChatStore.getState().setSessionCategory(sessionKey, 'Jarvis: JunQi');
    assert.deepEqual(useChatStore.getState().sessions, [{
      key: sessionKey,
      label: 'Jarvis session',
      groupId: 'Jarvis: JunQi',
      category: 'Jarvis: JunQi',
    }]);
  } finally {
    Object.assign(gateway, { setSessionCategory });
  }
});

test('native session group catalog stays transient and preserves Gateway display order', async () => {
  const listSessionGroups = gateway.listSessionGroups;
  Object.assign(gateway, {
    listSessionGroups: async () => [
      { name: 'Jarvis: Office', position: 0 },
      { name: 'Projects', position: 1 },
    ],
  });
  useChatStore.setState({
    sessionGroupCatalog: [],
    sessionGroupCatalogAvailability: 'unknown',
  });

  try {
    await useChatStore.getState().refreshSessionGroupCatalog();
    assert.deepEqual(useChatStore.getState().sessionGroupCatalog, ['Jarvis: Office', 'Projects']);
    assert.equal(useChatStore.getState().sessionGroupCatalogAvailability, 'ready');
    useChatStore.getState().setConnectionStatus({ connected: false, connecting: false });
    assert.deepEqual(useChatStore.getState().sessionGroupCatalog, []);
    assert.equal(useChatStore.getState().sessionGroupCatalogAvailability, 'unknown');
  } finally {
    Object.assign(gateway, { listSessionGroups });
  }
});

test('unsupported native group catalog does not create a local catalog', async () => {
  const listSessionGroups = gateway.listSessionGroups;
  Object.assign(gateway, {
    listSessionGroups: async () => { throw new OpenClawSessionGroupsUnsupportedError(); },
  });
  useChatStore.setState({
    sessionGroupCatalog: ['stale local value'],
    sessionGroupCatalogAvailability: 'unknown',
  });

  try {
    await useChatStore.getState().refreshSessionGroupCatalog();
    assert.deepEqual(useChatStore.getState().sessionGroupCatalog, []);
    assert.equal(useChatStore.getState().sessionGroupCatalogAvailability, 'unavailable');
  } finally {
    Object.assign(gateway, { listSessionGroups });
  }
});

test('history cache preserves structured Gateway blocks through ChatStore projection', () => {
  seedSessions(MAIN_KEY);
  useChatStore.setState({
    messages: [],
    renderBlocks: [],
    responseGroups: [],
    messagesPerSession: {},
    _blocksCache: {},
    _groupsCache: {},
  });

  const toolMessage = normalizeHistoryMessage({
    __openclaw: { id: 'native-tool-message' },
    role: 'assistant',
    content: [{ type: 'toolCall', name: 'search_docs', input: { query: 'OpenClaw' } }],
    timestamp: new Date(1).toISOString(),
  });
  const thinkingMessage = normalizeHistoryMessage({
    __openclaw: { id: 'native-thinking-message' },
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Check the authoritative source.' },
      { type: 'text', text: 'The source is confirmed.' },
    ],
    timestamp: new Date(2).toISOString(),
  });
  const toolResultMessage = normalizeHistoryMessage({
    __openclaw: { id: 'native-tool-result-message' },
    role: 'tool',
    content: [{ type: 'toolResult', name: 'search_docs', result: 'Found the contract.' }],
    timestamp: new Date(3).toISOString(),
  });

  useChatStore.getState().setMessages(
    [toolMessage, thinkingMessage, toolResultMessage],
    MAIN_KEY,
  );

  const state = useChatStore.getState();
  assert.deepEqual(state.messages.map((message) => message.rawContent), [
    toolMessage.rawContent,
    thinkingMessage.rawContent,
    toolResultMessage.rawContent,
  ]);
  assert.ok(state.renderBlocks.some((block) => (
    block.type === 'tool' && block.toolName === 'search_docs'
  )));
  assert.ok(state.renderBlocks.some((block) => (
    block.type === 'thinking' && block.content === 'Check the authoritative source.'
  )));
  assert.ok(state.renderBlocks.some((block) => (
    block.type === 'tool' && block.output === 'Found the contract.'
  )));
  assert.ok(state.renderBlocks.some((block) => (
    block.type === 'message' && block.markdown === 'The source is confirmed.'
  )));
});

test('streaming tail updates preserve historical projections and match a canonical rebuild', () => {
  seedSessions(MAIN_KEY);
  useChatStore.setState({
    messages: [],
    renderBlocks: [],
    responseGroups: [],
    messagesPerSession: {},
    _blocksCache: {},
    _groupsCache: {},
    thinkingBySession: {},
  });

  const store = useChatStore.getState();
  store.setMessages([
    {
      id: 'history-user',
      role: 'user',
      content: 'Historical question',
      timestamp: '2026-08-03T00:00:00.000Z',
    },
    {
      id: 'history-assistant',
      role: 'assistant',
      content: 'Historical answer',
      timestamp: '2026-08-03T00:00:01.000Z',
      runId: 'run-history',
      isStreaming: false,
      responseState: 'final',
    },
    {
      id: 'current-user',
      role: 'user',
      content: 'Current question',
      timestamp: '2026-08-03T00:00:02.000Z',
    },
  ], MAIN_KEY);
  store.updateStreamingMessage(
    'current-assistant',
    'Partial answer',
    { runId: 'run-current' },
    MAIN_KEY,
  );

  const before = useChatStore.getState();
  const historicalGroups = before.responseGroups.slice(0, -1);
  const historicalBlocks = before.renderBlocks.slice(0, -1);

  store.updateStreamingMessage(
    'current-assistant',
    'Partial answer with more text',
    { runId: 'run-current' },
    MAIN_KEY,
  );

  const incremental = useChatStore.getState();
  historicalGroups.forEach((group, index) => assert.equal(incremental.responseGroups[index], group));
  historicalBlocks.forEach((block, index) => assert.equal(incremental.renderBlocks[index], block));
  assert.equal(incremental.messages.at(-1)?.content, 'Partial answer with more text');
  assert.notEqual(incremental.responseGroups.at(-1), before.responseGroups.at(-1));

  const incrementalGroups = structuredClone(incremental.responseGroups);
  const incrementalBlocks = structuredClone(incremental.renderBlocks);
  store.setMessages(incremental.messages, MAIN_KEY);

  const canonical = useChatStore.getState();
  assert.deepEqual(canonical.responseGroups, incrementalGroups);
  assert.deepEqual(canonical.renderBlocks, incrementalBlocks);
});

test('a non-tail streaming update falls back to the canonical full projection', () => {
  seedSessions(MAIN_KEY);
  useChatStore.setState({
    messages: [],
    renderBlocks: [],
    responseGroups: [],
    messagesPerSession: {},
    _blocksCache: {},
    _groupsCache: {},
    thinkingBySession: {},
  });

  const store = useChatStore.getState();
  store.setMessages([
    {
      id: 'earlier-assistant',
      role: 'assistant',
      content: 'Earlier answer',
      timestamp: '2026-08-03T00:00:00.000Z',
      runId: 'run-earlier',
      isStreaming: false,
      responseState: 'final',
    },
    {
      id: 'later-user',
      role: 'user',
      content: 'Later question',
      timestamp: '2026-08-03T00:00:01.000Z',
    },
  ], MAIN_KEY);
  const previousFirstGroup = useChatStore.getState().responseGroups[0];

  store.updateStreamingMessage(
    'earlier-assistant',
    'Corrected earlier answer',
    { runId: 'run-earlier' },
    MAIN_KEY,
  );

  const state = useChatStore.getState();
  assert.equal(state.messages[0].content, 'Corrected earlier answer');
  assert.equal(state.responseGroups[0].blocks[0]?.type, 'message-content');
  assert.equal(
    state.responseGroups[0].blocks[0]?.type === 'message-content'
      ? state.responseGroups[0].blocks[0].markdown
      : '',
    'Corrected earlier answer',
  );
  assert.notEqual(state.responseGroups[0], previousFirstGroup);
});

test('thinking-prefix removal does not restore a stale streaming fragment', () => {
  seedSessions(MAIN_KEY);
  useChatStore.setState({
    messages: [],
    renderBlocks: [],
    responseGroups: [],
    messagesPerSession: {},
    _blocksCache: {},
    _groupsCache: {},
    thinkingBySession: {},
  });

  const store = useChatStore.getState();
  store.updateStreamingMessage('thinking-final', 'partial streamed answer', { runId: 'run-thinking' }, MAIN_KEY);
  store.setThinkingStream('run-thinking', 'same final snapshot', MAIN_KEY);
  store.finalizeStreamingMessage('thinking-final', 'same final snapshot', { runId: 'run-thinking' }, MAIN_KEY);

  const message = useChatStore.getState().messagesPerSession[MAIN_KEY]?.find((item) => item.id === 'thinking-final');
  assert.equal(message?.content, '');
  assert.equal(message?.isStreaming, false);
});

test('an explicit empty terminal removes an obsolete streamed draft', () => {
  seedSessions(MAIN_KEY);
  useChatStore.setState({
    messages: [],
    renderBlocks: [],
    responseGroups: [],
    messagesPerSession: {},
    _blocksCache: {},
    _groupsCache: {},
    thinkingBySession: {},
  });

  const store = useChatStore.getState();
  store.updateStreamingMessage('empty-final', 'obsolete draft', { runId: 'run-empty' }, MAIN_KEY);
  store.finalizeStreamingMessage('empty-final', '', { runId: 'run-empty' }, MAIN_KEY);

  assert.equal(
    useChatStore.getState().messagesPerSession[MAIN_KEY]?.some((item) => item.id === 'empty-final'),
    false,
  );
});

test('a media-only terminal creates a renderable assistant message', () => {
  seedSessions(MAIN_KEY);
  useChatStore.setState({
    messages: [],
    renderBlocks: [],
    responseGroups: [],
    messagesPerSession: {},
    _blocksCache: {},
    _groupsCache: {},
    thinkingBySession: {},
  });

  useChatStore.getState().finalizeStreamingMessage('media-final', '', {
    runId: 'run-media',
    mediaUrl: 'https://media.invalid/answer.mp3',
    mediaType: 'audio',
  }, MAIN_KEY);

  const message = useChatStore.getState().messagesPerSession[MAIN_KEY]?.[0];
  assert.equal(message?.mediaUrl, 'https://media.invalid/answer.mp3');
  assert.equal(message?.isStreaming, false);
});

test('composer snapshot consumption preserves edits and attachments added during delivery', () => {
  seedSessions(MAIN_KEY);
  useChatStore.setState({
    drafts: { [MAIN_KEY]: 'sent text plus a new edit' },
    preparedAttachments: {
      [MAIN_KEY]: [
        {
          id: 'sent-file',
          type: 'file',
          mimeType: 'text/plain',
          content: 'c2VudA==',
          fileName: 'sent.txt',
          isImage: false,
          size: 4,
        },
        {
          id: 'new-file',
          type: 'file',
          mimeType: 'text/plain',
          content: 'bmV3',
          fileName: 'new.txt',
          isImage: false,
          size: 3,
        },
      ],
    },
  });

  useChatStore.getState().consumeComposerSnapshot(MAIN_KEY, {
    text: 'sent text',
    attachmentIds: ['sent-file'],
  });

  assert.equal(useChatStore.getState().drafts[MAIN_KEY], 'sent text plus a new edit');
  assert.deepEqual(
    useChatStore.getState().preparedAttachments[MAIN_KEY].map((file) => file.id),
    ['new-file'],
  );
});

test('composer snapshot consumption clears only an unchanged sent draft', () => {
  seedSessions(MAIN_KEY);
  useChatStore.setState({ drafts: { [MAIN_KEY]: 'sent text' }, preparedAttachments: {} });

  useChatStore.getState().consumeComposerSnapshot(MAIN_KEY, {
    text: 'sent text',
    attachmentIds: [],
  });

  assert.equal(useChatStore.getState().drafts[MAIN_KEY], '');
});

test('Gateway acceptance settles an optimistic user message without waiting for the reply', () => {
  seedSessions(MAIN_KEY);
  useChatStore.setState({
    messages: [],
    renderBlocks: [],
    responseGroups: [],
    messagesPerSession: {},
    _blocksCache: {},
    _groupsCache: {},
  });

  const store = useChatStore.getState();
  store.addMessage({
    id: 'accepted-user-message',
    role: 'user',
    content: 'Stop should not leave this message sending.',
    timestamp: '2026-07-22T00:00:00.000Z',
    status: 'pending',
  }, MAIN_KEY);
  store.confirmPendingMessageDeliveries(MAIN_KEY, ['accepted-user-message']);

  const message = useChatStore.getState().messagesPerSession[MAIN_KEY]?.find((item) => item.id === 'accepted-user-message');
  assert.equal(message?.status, 'sent');
});

test('CHAT-02 failed queue drain keeps the item and its attachments for explicit retry', async () => {
  seedSessions(MAIN_KEY);
  useChatStore.setState({
    messages: [],
    messagesPerSession: { [MAIN_KEY]: [] },
    renderBlocks: [],
    responseGroups: [],
    _blocksCache: {},
    _groupsCache: {},
    typingBySession: { [MAIN_KEY]: false },
    connected: true,
    messageQueue: {
      [MAIN_KEY]: [{
        id: 'queued-1',
        text: 'inspect attachment',
        timestamp: new Date(0).toISOString(),
        attachments: [{
          type: 'file',
          mimeType: 'application/pdf',
          content: 'AA==',
          fileName: 'report.pdf',
        }],
      }],
    },
  });

  const originalSend = gateway.sendMessage;
  let deliveredAttachments: unknown;
  try {
    gateway.sendMessage = async () => { throw new Error('network failed'); };
    await useChatStore.getState().drainQueue(MAIN_KEY);
    let state = useChatStore.getState();
    assert.equal(state.messageQueue[MAIN_KEY][0]?.failed, true);
    assert.equal(state.messagesPerSession[MAIN_KEY][0]?.status, 'failed');
    assert.equal(state.typingBySession[MAIN_KEY], false);

    gateway.sendMessage = async (_message, attachments) => {
      deliveredAttachments = attachments;
      return { ok: true };
    };
    await state.retryQueuedMessage(MAIN_KEY, 'queued-1');
    state = useChatStore.getState();
    assert.deepEqual(state.messageQueue[MAIN_KEY], []);
    assert.equal(state.messagesPerSession[MAIN_KEY][0]?.status, 'sent');
    assert.deepEqual(deliveredAttachments, [{
      type: 'file',
      mimeType: 'application/pdf',
      content: 'AA==',
      fileName: 'report.pdf',
    }]);
  } finally {
    gateway.sendMessage = originalSend;
  }
});

test('a cached terminal acknowledgement re-arms the queue pump after its guard releases', async () => {
  seedSessions(MAIN_KEY);
  useChatStore.setState({
    messages: [],
    messagesPerSession: { [MAIN_KEY]: [] },
    renderBlocks: [],
    responseGroups: [],
    _blocksCache: {},
    _groupsCache: {},
    typingBySession: { [MAIN_KEY]: false },
    connected: true,
    messageQueue: {
      [MAIN_KEY]: [
        { id: 'cached-ack-1', text: 'first', timestamp: new Date(0).toISOString() },
        { id: 'cached-ack-2', text: 'second', timestamp: new Date(1).toISOString() },
      ],
    },
  });

  const originalSend = gateway.sendMessage;
  const delivered: string[] = [];
  try {
    gateway.sendMessage = async (message) => {
      delivered.push(message);
      // Mirrors a cached `ok`/`timeout` ACK: ChatHandler settles the run before
      // drainQueue's await continuation releases its single-session guard.
      useChatStore.getState().setIsTyping(false, MAIN_KEY);
      return { runId: `run-${delivered.length}`, status: 'ok' };
    };

    await useChatStore.getState().drainQueue(MAIN_KEY);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(delivered, ['first', 'second']);
    assert.deepEqual(useChatStore.getState().messageQueue[MAIN_KEY], []);
  } finally {
    gateway.sendMessage = originalSend;
  }
});

test('CHAT-02 clearing a local queue cannot cancel an item already claimed for Gateway delivery', async () => {
  seedSessions(MAIN_KEY);
  const secondMessage = {
    id: 'clear-race-second',
    role: 'user' as const,
    content: 'second',
    timestamp: new Date(1).toISOString(),
    status: 'queued' as const,
    retryPayload: { text: 'second' },
  };
  useChatStore.setState({
    messages: [secondMessage],
    messagesPerSession: { [MAIN_KEY]: [secondMessage] },
    renderBlocks: [],
    responseGroups: [],
    _blocksCache: {},
    _groupsCache: {},
    typingBySession: { [MAIN_KEY]: false },
    connected: true,
    messageQueue: {
      [MAIN_KEY]: [
        { id: 'clear-race-first', text: 'first', timestamp: new Date(0).toISOString() },
        { id: 'clear-race-second', text: 'second', timestamp: new Date(1).toISOString() },
      ],
    },
  });

  const originalSend = gateway.sendMessage;
  const delivered: string[] = [];
  let releaseDelivery!: () => void;
  let enteredGateway!: () => void;
  const deliveryStarted = new Promise<void>((resolve) => { enteredGateway = resolve; });
  try {
    gateway.sendMessage = async (message) => {
      delivered.push(message);
      enteredGateway();
      await new Promise<void>((resolve) => { releaseDelivery = resolve; });
      return { runId: 'clear-race-first', status: 'started' };
    };

    const draining = useChatStore.getState().drainQueue(MAIN_KEY);
    await deliveryStarted;

    let state = useChatStore.getState();
    assert.deepEqual(state.messageQueue[MAIN_KEY].map((item) => item.id), ['clear-race-second']);

    state.clearQueue(MAIN_KEY);
    state = useChatStore.getState();
    assert.deepEqual(state.messageQueue[MAIN_KEY], []);
    assert.equal(
      state.messagesPerSession[MAIN_KEY]?.find((message) => message.id === 'clear-race-first')?.status,
      'pending',
    );
    assert.equal(state.messages.find((message) => message.id === 'clear-race-second')?.status, 'cancelled');

    releaseDelivery();
    await draining;

    state = useChatStore.getState();
    assert.deepEqual(delivered, ['first']);
    assert.equal(
      state.messagesPerSession[MAIN_KEY]?.find((message) => message.id === 'clear-race-first')?.status,
      'sent',
    );
  } finally {
    gateway.sendMessage = originalSend;
  }
});

test('CHAT-02 failed claimed delivery does not restore a deleted session queue', async () => {
  const sessionKey = 'agent:worker:deleted-queue';
  seedSessions(sessionKey);
  useChatStore.setState({
    messages: [],
    messagesPerSession: { [sessionKey]: [] },
    renderBlocks: [],
    responseGroups: [],
    _blocksCache: {},
    _groupsCache: {},
    typingBySession: { [sessionKey]: false },
    connected: true,
    messageQueue: {
      [sessionKey]: [{ id: 'deleted-during-send', text: 'do not restore', timestamp: new Date(0).toISOString() }],
    },
  });

  const originalSend = gateway.sendMessage;
  let releaseDelivery!: () => void;
  let enteredGateway!: () => void;
  const deliveryStarted = new Promise<void>((resolve) => { enteredGateway = resolve; });
  try {
    gateway.sendMessage = async () => {
      enteredGateway();
      await new Promise<void>((resolve) => { releaseDelivery = resolve; });
      throw new Error('network failed');
    };

    const draining = useChatStore.getState().drainQueue(sessionKey);
    await deliveryStarted;
    markSessionDeleted(sessionKey, 'worker-session-id');
    releaseDelivery();
    await draining;

    assert.deepEqual(useChatStore.getState().messageQueue[sessionKey], []);
  } finally {
    restoreSessionKey(sessionKey);
    gateway.sendMessage = originalSend;
  }
});

test('CHAT-02 queue actions immediately update the active transcript', () => {
  seedSessions(MAIN_KEY);
  useChatStore.getState().setMessages([
    {
      id: 'queued-1',
      role: 'user',
      content: 'first draft',
      timestamp: new Date(0).toISOString(),
      status: 'failed',
      retryPayload: {
        text: 'first draft',
        attachments: [{ mimeType: 'application/octet-stream', content: 'AAAA', fileName: 'one.bin' }],
      },
    },
    {
      id: 'queued-2',
      role: 'user',
      content: 'second draft',
      timestamp: new Date(1).toISOString(),
      status: 'queued',
      retryPayload: {
        text: 'second draft',
        attachments: [{ mimeType: 'application/octet-stream', content: 'AAAA', fileName: 'two.bin' }],
      },
    },
  ], MAIN_KEY);
  useChatStore.setState({
    messageQueue: {
      [MAIN_KEY]: [
        { id: 'queued-1', text: 'first draft', timestamp: new Date(0).toISOString(), failed: true },
        { id: 'queued-2', text: 'second draft', timestamp: new Date(1).toISOString() },
      ],
    },
  });

  useChatStore.getState().updateQueuedMessage(MAIN_KEY, 'queued-1', 'edited draft');
  let state = useChatStore.getState();
  assert.equal(state.messageQueue[MAIN_KEY][0]?.text, 'edited draft');
  assert.equal(state.messages[0]?.content, 'edited draft');

  state.removeQueuedMessage(MAIN_KEY, 'queued-1');
  state = useChatStore.getState();
  assert.equal(state.messageQueue[MAIN_KEY].some((message) => message.id === 'queued-1'), false);
  assert.equal(state.messages[0]?.status, 'cancelled');
  assert.equal(state.messages[0]?.retryPayload, undefined);

  state.clearQueue(MAIN_KEY);
  state = useChatStore.getState();
  assert.deepEqual(state.messageQueue[MAIN_KEY], []);
  assert.equal(state.messages[1]?.status, 'cancelled');
  assert.equal(state.messages[1]?.retryPayload, undefined);
  assert.equal(state.messagesPerSession[MAIN_KEY][1]?.status, 'cancelled');
});
