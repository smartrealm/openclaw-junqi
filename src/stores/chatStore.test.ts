import test from 'node:test';
import assert from 'node:assert/strict';
import { useChatStore, type Session } from './chatStore';
import { normalizeHistoryMessage } from '@/processing/normalizeHistoryMessage';
import { gateway } from '@/services/gateway';

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
    isTyping: false,
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

test('CHAT-02 queue actions immediately update the active transcript', () => {
  seedSessions(MAIN_KEY);
  useChatStore.getState().setMessages([
    {
      id: 'queued-1',
      role: 'user',
      content: 'first draft',
      timestamp: new Date(0).toISOString(),
      status: 'failed',
    },
    {
      id: 'queued-2',
      role: 'user',
      content: 'second draft',
      timestamp: new Date(1).toISOString(),
      status: 'queued',
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

  state.clearQueue(MAIN_KEY);
  state = useChatStore.getState();
  assert.deepEqual(state.messageQueue[MAIN_KEY], []);
  assert.equal(state.messages[1]?.status, 'cancelled');
  assert.equal(state.messagesPerSession[MAIN_KEY][1]?.status, 'cancelled');
});
