import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectActiveSessionThinking,
  selectActiveSessionTyping,
  useChatStore,
  type Session,
} from './chatStore';
import { normalizeHistoryMessage } from '@/processing/normalizeHistoryMessage';
import { gateway } from '@/services/gateway';
import { subscribeSessionIdentityTransitions } from '@/services/chat/sessionIdentityTransition';

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

test('sessionId rotation atomically replaces transcript state and preserves user preferences', () => {
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
  assert.equal(state.thinkingBySession[OTHER_KEY], undefined);
  assert.equal(state.messageQueue[OTHER_KEY], undefined);
  assert.deepEqual(state.messages, []);
  assert.equal(state.drafts[OTHER_KEY], 'keep this draft');
  assert.equal(state.sessions.find((session) => session.key === OTHER_KEY)?.pinned, true);
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
  assert.equal(state.sendingBySession[MAIN_KEY], false);
  assert.equal(state.typingBySession[OTHER_KEY], true);
  assert.equal(state.typingStartedAtBySession[OTHER_KEY], 2_000);
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
  });

  useChatStore.getState().removeSession(deletedKey);

  const state = useChatStore.getState();
  assert.deepEqual(state.openTabs, [MAIN_KEY]);
  assert.equal(state.activeSessionKey, MAIN_KEY);
  assert.equal(state.sessions.some((session) => session.key === deletedKey), false);
  assert.equal(state.messagesPerSession[deletedKey], undefined);
  assert.equal(localStorage.getItem('aegis-open-tabs'), JSON.stringify([MAIN_KEY]));
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
