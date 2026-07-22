import assert from 'node:assert/strict';
import test from 'node:test';

type StreamEndCall = {
  sessionKey: string;
  messageId: string;
  content: string;
  meta?: any;
};

function resetChatStore() {
  const { useChatStore } = (globalThis as any).__chatDeps as { useChatStore: any };
  useChatStore.setState({
    messages: [],
    renderBlocks: [],
    responseGroups: [],
    messagesPerSession: {},
    _blocksCache: {},
    _groupsCache: {},
    quickReplies: [],
    quickRepliesBySession: {},
    thinkingBySession: {},
    typingBySession: {},
    typingStartedAtBySession: {},
  });
}

function installWindowMock() {
  (globalThis as any).__APP_VERSION__ = 'test';
  (globalThis as any).window = {
    aegis: {
    },
    __APP_VERSION__: 'test',
  };
}

function installDomMock() {
  Object.defineProperty(globalThis, 'document', {
    value: {
      documentElement: {
        dir: 'ltr',
        lang: 'en',
      },
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      language: 'en-US',
      languages: ['en-US'],
    },
    configurable: true,
  });
}

function installStorageMock() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

async function loadDeps() {
  installStorageMock();
  installDomMock();
  const { useChatStore } = await import('@/stores/chatStore');
  const { ChatHandler } = await import('@/services/gateway/ChatHandler');
  (globalThis as any).__chatDeps = { useChatStore };
  return { ChatHandler };
}

test('chat.final replaces a longer streamed draft with OpenClaw canonical text', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const streamEnds: StreamEndCall[] = [];
  const conn = {
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: (sessionKey: string, messageId: string, content: string, _media?: any, meta?: any) => {
        streamEnds.push({ sessionKey, messageId, content, meta });
      },
    },
  } as any;

  const handler = new ChatHandler(conn);
  const sessionKey = 'agent:main:session-a';
  const runId = 'run-chat-final';

  handler.handleEvent({
    event: 'chat',
    payload: {
      sessionKey,
      runId,
      state: 'delta',
      message: { content: 'This is a longer obsolete streamed draft.' },
    },
  });

  handler.handleEvent({
    event: 'chat',
    payload: {
      sessionKey,
      runId,
      state: 'final',
      message: { content: 'Corrected answer.' },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(streamEnds.length, 1);
  assert.equal(streamEnds[0].sessionKey, sessionKey);
  assert.ok(streamEnds[0].messageId.length > 0);
  assert.equal(streamEnds[0].content, 'Corrected answer.');
  assert.equal(streamEnds[0].meta?.runId, runId);
});

test('a final event sharing the last delta sequence still settles the run', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();
  const streamEnds: StreamEndCall[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: (sessionKey: string, messageId: string, content: string, _media?: any, meta?: any) => {
        streamEnds.push({ sessionKey, messageId, content, meta });
      },
    },
  } as any);
  const sessionKey = 'agent:main:same-sequence-terminal';
  const runId = 'run-same-sequence-terminal';

  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, seq: 9, state: 'delta', message: { content: 'Complete answer.' },
  } });
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, seq: 9, state: 'final', message: { content: 'Complete answer.' },
  } });

  assert.equal(streamEnds.length, 1);
  assert.equal(streamEnds[0]?.content, 'Complete answer.');
});

test('chat.final without a terminal message falls back to the live projection', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const streamEnds: StreamEndCall[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: (sessionKey: string, messageId: string, content: string, _media?: any, meta?: any) => {
        streamEnds.push({ sessionKey, messageId, content, meta });
      },
    },
  } as any);
  const sessionKey = 'agent:main:terminal-without-message';
  const runId = 'run-terminal-without-message';

  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'delta', message: { content: 'Live answer.' },
  } });
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'final',
  } });

  assert.equal(streamEnds.length, 1);
  assert.equal(streamEnds[0].content, 'Live answer.');
});

test('an explicitly empty chat.final remains canonical instead of restoring the draft', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();

  for (const content of ['', []] as const) {
    resetChatStore();
    const streamEnds: StreamEndCall[] = [];
    const handler = new ChatHandler({
      callbacks: {
        onStreamChunk: () => {},
        onStreamEnd: (sessionKey: string, messageId: string, finalContent: string, _media?: any, meta?: any) => {
          streamEnds.push({ sessionKey, messageId, content: finalContent, meta });
        },
      },
    } as any);
    const sessionKey = `agent:main:empty-final-${Array.isArray(content) ? 'blocks' : 'text'}`;
    const runId = `run-${sessionKey}`;
    handler.handleEvent({ event: 'chat', payload: {
      sessionKey, runId, state: 'delta', message: { content: 'Obsolete draft.' },
    } });
    handler.handleEvent({ event: 'chat', payload: {
      sessionKey, runId, state: 'final', message: { content },
    } });
    assert.equal(streamEnds.length, 1);
    assert.equal(streamEnds[0].content, '');
  }
});

test('agent replace=true supersedes a non-prefix draft in the same response', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const streamEnds: StreamEndCall[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: (sessionKey: string, messageId: string, content: string, _media?: any, meta?: any) => {
        streamEnds.push({ sessionKey, messageId, content, meta });
      },
    },
  } as any);
  const sessionKey = 'agent:main:agent-replace';
  const runId = 'run-agent-replace';
  handler.handleEvent({ event: 'agent', payload: {
    sessionKey, runId, stream: 'assistant', data: { text: 'Old prefix that must disappear.' },
  } });
  handler.handleEvent({ event: 'agent', payload: {
    sessionKey, runId, stream: 'assistant', data: { text: 'Corrected answer.', replace: true },
  } });
  handler.handleEvent({ event: 'chat', payload: { sessionKey, runId, state: 'final' } });

  assert.equal(streamEnds.length, 1);
  assert.equal(streamEnds[0].content, 'Corrected answer.');
});

test('chat.abort settles only run ids explicitly confirmed by OpenClaw', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const streamEnds: StreamEndCall[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: (sessionKey: string, messageId: string, content: string, _media?: any, meta?: any) => {
        streamEnds.push({ sessionKey, messageId, content, meta });
      },
      onSessionRunReconciliationNeeded: () => {},
    },
  } as any);
  const sessionKey = 'agent:main:abort-ack';
  const runId = 'run-abort-ack';
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'delta', message: { content: 'Partial answer.' },
  } });

  assert.equal(handler.reconcileAbortAcknowledgement(
    sessionKey,
    { ok: true, aborted: false, runIds: [] },
  ), false);
  assert.equal(streamEnds.length, 0);
  assert.equal(handler.reconcileAbortAcknowledgement(
    sessionKey,
    { ok: true, aborted: true, runIds: [runId] },
  ), true);
  assert.equal(streamEnds.length, 1);
  assert.equal(streamEnds[0].meta?.state, 'aborted');

  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'delta', message: { content: 'Late text.' },
  } });
  assert.equal(streamEnds.length, 1);
});

test('chat.history restores an exact in-flight run and its buffered text', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const chunks: Array<{ sessionKey: string; content: string; runId?: string | null }> = [];
  const reconciliations: Array<{ state: string; activeRunId?: string }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: (sessionKey: string, _messageId: string, content: string, _media?: any, runId?: string | null) => {
        chunks.push({ sessionKey, content, runId });
      },
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: { state: string; activeRunId?: string }) => {
        reconciliations.push(resolution);
      },
    },
  } as any);
  const sessionKey = 'agent:main:history-in-flight';
  const runId = 'run-history-in-flight';

  handler.reconcileHistoryRunState(sessionKey, {
    sessionInfo: { hasActiveRun: true, activeRunIds: [runId] },
    inFlightRun: { runId, text: 'Recovered buffered answer.' },
  });
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(reconciliations.at(-1)?.state, 'active');
  assert.equal(reconciliations.at(-1)?.activeRunId, runId);
  assert.deepEqual(chunks, [{ sessionKey, content: 'Recovered buffered answer.', runId }]);
});

test('a history response captured before a new run cannot settle that run', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliations: Array<{ state: string }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: { state: string }) => reconciliations.push(resolution),
    },
  } as any);
  const sessionKey = 'agent:main:stale-history-state';
  const observation = handler.captureSessionRunObservation(sessionKey);
  handler.reconcileSendAcknowledgement(
    sessionKey,
    'run-started-after-history',
    { runId: 'run-started-after-history', status: 'started' },
  );
  handler.reconcileHistoryRunState(
    sessionKey,
    { sessionInfo: { hasActiveRun: false, activeRunIds: [] } },
    observation,
  );

  assert.deepEqual(reconciliations, []);
});

test('history cannot settle a send while dispatch is pending, but can resolve uncertain delivery', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();
  const reconciliations: string[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: { state: string }) => {
        reconciliations.push(resolution.state);
      },
      onSessionRunReconciliationNeeded: () => {},
    },
  } as any);
  const sessionKey = 'agent:main:pending-dispatch';
  const runId = 'run-pending-dispatch';
  handler.beginPendingSend(sessionKey, runId);

  const dispatching = handler.captureSessionRunObservation(sessionKey);
  handler.reconcileHistoryRunState(
    sessionKey,
    { sessionInfo: { hasActiveRun: false, activeRunIds: [] } },
    dispatching,
  );
  assert.deepEqual(reconciliations, []);

  assert.equal(handler.markPendingSendUncertain(sessionKey, runId), true);
  const uncertain = handler.captureSessionRunObservation(sessionKey);
  handler.reconcileHistoryRunState(
    sessionKey,
    { sessionInfo: { hasActiveRun: false, activeRunIds: [] } },
    uncertain,
  );
  assert.deepEqual(reconciliations, ['settled']);
});

test('history confirms an uncertain send only from its exact idempotency identity', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();
  const { useChatStore } = (globalThis as any).__chatDeps as { useChatStore: any };
  const sessionKey = 'agent:main:uncertain-persisted';
  const runId = 'run-uncertain-persisted';
  useChatStore.getState().addMessage({
    id: runId,
    clientMessageId: runId,
    role: 'user',
    content: 'Persist me.',
    timestamp: new Date().toISOString(),
    status: 'pending',
  }, sessionKey);
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliationNeeded: () => {},
    },
  } as any);
  handler.beginPendingSend(sessionKey, runId);
  handler.markPendingSendUncertain(sessionKey, runId);
  handler.reconcileHistoryRunState(sessionKey, {
    messages: [{ role: 'user', content: 'Persist me.', idempotencyKey: runId }],
    sessionInfo: { hasActiveRun: false, activeRunIds: [] },
  });

  assert.equal(useChatStore.getState().getCachedMessages(sessionKey)[0]?.status, 'sent');
});

test('an exact abort acknowledgement settles a send before chat.send acknowledgement', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();
  const { useChatStore } = (globalThis as any).__chatDeps as { useChatStore: any };
  const sessionKey = 'agent:main:pre-ack-abort';
  const runId = 'run-pre-ack-abort';
  useChatStore.getState().addMessage({
    id: runId,
    clientMessageId: runId,
    role: 'user',
    content: 'Stop this.',
    timestamp: new Date().toISOString(),
    status: 'pending',
  }, sessionKey);
  const streamEnds: StreamEndCall[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: (key: string, messageId: string, content: string, _media?: any, meta?: any) => {
        streamEnds.push({ sessionKey: key, messageId, content, meta });
      },
    },
  } as any);
  handler.beginPendingSend(sessionKey, runId);

  assert.equal(handler.reconcileAbortAcknowledgement(
    sessionKey,
    { ok: true, aborted: true, runIds: [runId] },
  ), true);
  assert.equal(streamEnds[0]?.meta?.state, 'aborted');
  assert.equal(useChatStore.getState().getCachedMessages(sessionKey)[0]?.status, 'sent');
});

test('forcing one terminal flush also releases another session including media-only data', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const chunks: Array<{ sessionKey: string; content: string; mediaType?: string }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: (sessionKey: string, _messageId: string, content: string, media?: any) => {
        chunks.push({ sessionKey, content, mediaType: media?.mediaType });
      },
      onStreamEnd: () => {},
    },
  } as any);
  const firstSession = 'agent:main:flush-first';
  const secondSession = 'agent:main:flush-second';
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey: firstSession,
    runId: 'run-flush-first',
    state: 'delta',
    message: { content: 'First buffered stream.' },
  } });
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey: secondSession,
    runId: 'run-flush-second',
    state: 'delta',
    mediaUrl: 'https://media.invalid/voice.mp3',
    mediaType: 'audio',
  } });
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey: firstSession,
    runId: 'run-flush-first',
    state: 'final',
    message: { content: 'First final.' },
  } });

  assert.deepEqual(chunks.map((chunk) => chunk.sessionKey).sort(), [firstSession, secondSession].sort());
  assert.equal(chunks.find((chunk) => chunk.sessionKey === secondSession)?.mediaType, 'audio');
});

test('agent lifecycle end requests authoritative reconciliation instead of inventing a terminal', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const streamEnds: StreamEndCall[] = [];
  const reconciliationRequests: string[] = [];
  const conn = {
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: (sessionKey: string, messageId: string, content: string, _media?: any, meta?: any) => {
        streamEnds.push({ sessionKey, messageId, content, meta });
      },
      onSessionRunReconciliationNeeded: (sessionKey: string) => reconciliationRequests.push(sessionKey),
    },
  } as any;

  const handler = new ChatHandler(conn);
  const sessionKey = 'agent:main:session-b';
  const runId = 'run-agent-lifecycle';

  handler.handleEvent({
    event: 'agent',
    payload: {
      sessionKey,
      runId,
      stream: 'assistant',
      data: { text: 'Lifecycle fallback response body.' },
    },
  });

  handler.handleEvent({
    event: 'agent',
    payload: {
      sessionKey,
      runId,
      stream: 'lifecycle',
      data: { phase: 'end' },
    },
  });

  assert.equal(streamEnds.length, 0);
  assert.deepEqual(reconciliationRequests, [sessionKey]);
});

test('agent lifecycle end leaves a textless run to the authoritative snapshot', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const streamEnds: StreamEndCall[] = [];
  const reconciliationRequests: string[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: (sessionKey: string, messageId: string, content: string, _media?: any, meta?: any) => {
        streamEnds.push({ sessionKey, messageId, content, meta });
      },
      onSessionRunReconciliationNeeded: (key: string) => reconciliationRequests.push(key),
    },
  } as any);
  const sessionKey = 'agent:main:lifecycle-verification';
  const runId = 'run-lifecycle-verification';

  handler.handleEvent({ event: 'agent', payload: {
    sessionKey, runId, stream: 'lifecycle', data: { phase: 'start' },
  } });
  handler.handleEvent({ event: 'agent', payload: {
    sessionKey, runId, stream: 'lifecycle', data: { phase: 'end' },
  } });

  assert.equal(streamEnds.length, 0);
  assert.deepEqual(reconciliationRequests, [sessionKey]);
});

test('an ordinary lifecycle error remains active during OpenClaw fallback grace', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const streamEnds: StreamEndCall[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: (sessionKey: string, messageId: string, content: string, _media?: any, meta?: any) => {
        streamEnds.push({ sessionKey, messageId, content, meta });
      },
    },
  } as any);
  const sessionKey = 'agent:main:lifecycle-error';
  const runId = 'run-lifecycle-error';

  handler.handleEvent({ event: 'agent', payload: {
    sessionKey, runId, stream: 'lifecycle', data: { phase: 'start' },
  } });
  handler.handleEvent({ event: 'agent', payload: {
    sessionKey, runId, stream: 'lifecycle', data: { phase: 'error', error: 'Provider failed.' },
  } });
  await new Promise((resolve) => setTimeout(resolve, 430));

  assert.equal(streamEnds.length, 0);
});

test('an exhausted lifecycle error requests authoritative reconciliation', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const streamEnds: StreamEndCall[] = [];
  const reconciliationRequests: string[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: (sessionKey: string, messageId: string, content: string, _media?: any, meta?: any) => {
        streamEnds.push({ sessionKey, messageId, content, meta });
      },
      onSessionRunReconciliationNeeded: (key: string) => reconciliationRequests.push(key),
    },
  } as any);
  const sessionKey = 'agent:main:lifecycle-error-exhausted';
  const runId = 'run-lifecycle-error-exhausted';

  handler.handleEvent({ event: 'agent', payload: {
    sessionKey, runId, stream: 'lifecycle', data: { phase: 'start' },
  } });
  handler.handleEvent({ event: 'agent', payload: {
    sessionKey,
    runId,
    stream: 'lifecycle',
    data: { phase: 'error', error: 'Provider failed.', fallbackExhaustedFailure: true },
  } });
  assert.equal(streamEnds.length, 0);
  assert.deepEqual(reconciliationRequests, [sessionKey]);
});

test('an aborted lifecycle end waits for chat.aborted or the authoritative snapshot', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const streamEnds: StreamEndCall[] = [];
  const reconciliationRequests: string[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: (sessionKey: string, messageId: string, content: string, _media?: any, meta?: any) => {
        streamEnds.push({ sessionKey, messageId, content, meta });
      },
      onSessionRunReconciliationNeeded: (key: string) => reconciliationRequests.push(key),
    },
  } as any);
  const sessionKey = 'agent:main:lifecycle-aborted';
  const runId = 'run-lifecycle-aborted';

  handler.handleEvent({ event: 'agent', payload: {
    sessionKey, runId, stream: 'assistant', data: { text: 'Partial response.' },
  } });
  handler.handleEvent({ event: 'agent', payload: {
    sessionKey, runId, stream: 'lifecycle', data: { phase: 'end', aborted: true },
  } });
  assert.equal(streamEnds.length, 0);
  assert.deepEqual(reconciliationRequests, [sessionKey]);
});

test('tool boundaries discard an empty streamed assistant segment', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const { useChatStore } = (globalThis as any).__chatDeps as { useChatStore: any };
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: (sessionKey: string, messageId: string, content: string, media?: any, runId?: string | null) => {
        useChatStore.getState().updateStreamingMessage(messageId, content, {
          ...(media ? { mediaUrl: media.mediaUrl, mediaType: media.mediaType } : {}),
          ...(runId ? { runId } : {}),
          responseState: 'streaming',
        }, sessionKey);
      },
      onStreamEnd: (sessionKey: string, messageId: string, content: string, media?: any, meta?: any) => {
        useChatStore.getState().finalizeStreamingMessage(messageId, content, {
          ...(media ? { mediaUrl: media.mediaUrl, mediaType: media.mediaType } : {}),
          ...(meta?.runId ? { runId: meta.runId } : {}),
          responseState: meta?.state ?? 'final',
        }, sessionKey);
      },
    },
  } as any);
  const sessionKey = 'agent:main:tool-boundary';
  const runId = 'run-tool-boundary';

  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'delta', message: { content: 'Tool preparation is complete.' },
  } });
  handler.handleToolStream({ sessionKey, runId, data: {
    toolCallId: 'tool-first', name: 'search', phase: 'start', args: {},
  } });
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'delta', message: { content: '   ' },
  } });
  handler.handleEvent({ event: 'agent', payload: {
    sessionKey, runId, stream: 'lifecycle', data: { phase: 'end' },
  } });

  await new Promise((resolve) => setTimeout(resolve, 260));

  const assistants = (useChatStore.getState().messagesPerSession[sessionKey] ?? [])
    .filter((message: any) => message.role === 'assistant');
  assert.deepEqual(assistants.map((message: any) => message.content), ['Tool preparation is complete.']);
  assert.equal(assistants.some((message: any) => message.isStreaming), false);
});

test('tool boundaries preserve an independent final text snapshot', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const streamEnds: StreamEndCall[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: (sessionKey: string, messageId: string, content: string, _media?: any, meta?: any) => {
        streamEnds.push({ sessionKey, messageId, content, meta });
      },
    },
  } as any);
  const sessionKey = 'agent:main:tool-final-snapshot';
  const runId = 'run-tool-final-snapshot';

  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'delta', message: { content: 'Prefix before the tool. ' },
  } });
  handler.handleToolStream({ sessionKey, runId, data: {
    toolCallId: 'tool-final-snapshot', name: 'search', phase: 'start', args: {},
  } });
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'delta', message: { content: 'Post-tool draft.' },
  } });
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'final', message: { content: 'Post-tool final text that is longer than the earlier prefix.' },
  } });

  assert.equal(streamEnds.length, 1);
  assert.equal(streamEnds[0].content, 'Post-tool final text that is longer than the earlier prefix.');
});

test('tool duration uses the locally recorded start instant', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const originalNow = Date.now;
  try {
    Date.now = () => 1_000;
    const handler = new ChatHandler({ callbacks: { onStreamChunk: () => {}, onStreamEnd: () => {} } } as any);
    const sessionKey = 'agent:main:tool-duration';
    const runId = 'run-tool-duration';
    handler.handleToolStream({ sessionKey, runId, ts: 99_999, data: {
      toolCallId: 'tool-duration', name: 'search', phase: 'start', args: {},
    } });
    Date.now = () => 3_500;
    handler.handleToolStream({ sessionKey, runId, ts: 3_500, data: {
      toolCallId: 'tool-duration', name: 'search', phase: 'result', result: 'done',
    } });

    const { useChatStore } = (globalThis as any).__chatDeps as { useChatStore: any };
    const tool = (useChatStore.getState().messagesPerSession[sessionKey] ?? [])
      .find((message: any) => message.id === `tool-live-${runId}-tool-duration`);
    assert.equal(tool?.toolDurationMs, 2_500);
  } finally {
    Date.now = originalNow;
  }
});

test('session.tool renders the official late-subscriber tool lifecycle exactly once', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliationRequests: Array<{ sessionKey: string; runId: string }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onStreamReconciliationNeeded: (sessionKey: string, runId: string) => {
        reconciliationRequests.push({ sessionKey, runId });
      },
    },
  } as any);
  const sessionKey = 'agent:main:late-subscriber';
  const runId = 'run-session-tool';
  const startPayload = {
    sessionKey,
    runId,
    seq: 17,
    stream: 'tool',
    ts: 1_234,
    data: {
      phase: 'start',
      name: 'exec',
      toolCallId: 'tool-session-1',
      args: { command: 'echo hi' },
    },
  };

  handler.handleEvent({ event: 'session.tool', payload: startPayload });
  handler.handleEvent({ event: 'session.tool', payload: startPayload });
  handler.handleEvent({ event: 'session.tool', payload: {
    sessionKey,
    runId,
    seq: 18,
    stream: 'tool',
    ts: 1_500,
    data: {
      phase: 'result',
      name: 'exec',
      toolCallId: 'tool-session-1',
      result: 'hi',
    },
  } });

  const { useChatStore } = (globalThis as any).__chatDeps as { useChatStore: any };
  const messages = useChatStore.getState().messagesPerSession[sessionKey] ?? [];
  const toolMessages = messages.filter((message: any) => (
    message.id === `tool-live-${runId}-tool-session-1`
  ));
  assert.equal(toolMessages.length, 1);
  assert.equal(toolMessages[0]?.toolName, 'exec');
  assert.deepEqual(toolMessages[0]?.toolInput, { command: 'echo hi' });
  assert.equal(toolMessages[0]?.toolOutput, 'hi');
  assert.equal(toolMessages[0]?.toolStatus, 'done');
  assert.equal(useChatStore.getState().typingBySession[sessionKey], true);
  assert.deepEqual(reconciliationRequests, []);
});

test('session.tool uses the agent sequence fence and requests history on a live gap', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliationRequests: Array<{ sessionKey: string; runId: string }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onStreamReconciliationNeeded: (sessionKey: string, runId: string) => {
        reconciliationRequests.push({ sessionKey, runId });
      },
    },
  } as any);
  const sessionKey = 'agent:main:late-subscriber-gap';
  const runId = 'run-session-tool-gap';

  handler.handleEvent({ event: 'session.tool', payload: {
    sessionKey,
    runId,
    seq: 3,
    stream: 'tool',
    data: { phase: 'start', name: 'read', toolCallId: 'tool-gap', args: {} },
  } });
  handler.handleEvent({ event: 'session.tool', payload: {
    sessionKey,
    runId,
    seq: 5,
    stream: 'tool',
    data: { phase: 'update', name: 'read', toolCallId: 'tool-gap', partialResult: 'partial' },
  } });

  assert.deepEqual(reconciliationRequests, [{ sessionKey, runId }]);
});

test('a malformed session.tool event cannot poison the official agent sequence', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const handler = new ChatHandler({
    callbacks: { onStreamChunk: () => {}, onStreamEnd: () => {} },
  } as any);
  const sessionKey = 'agent:main:session-tool-validation';
  const runId = 'run-session-tool-validation';
  handler.handleEvent({ event: 'session.tool', payload: {
    sessionKey,
    runId,
    seq: 100,
    stream: 'assistant',
    data: { phase: 'start', toolCallId: 'invalid-tool' },
  } });
  handler.handleEvent({ event: 'session.tool', payload: {
    sessionKey,
    runId,
    seq: 1,
    stream: 'tool',
    data: { phase: 'start', name: 'exec', toolCallId: 'valid-tool', args: {} },
  } });

  const { useChatStore } = (globalThis as any).__chatDeps as { useChatStore: any };
  const tool = (useChatStore.getState().messagesPerSession[sessionKey] ?? [])
    .find((message: any) => message.id === `tool-live-${runId}-valid-tool`);
  assert.equal(tool?.toolStatus, 'running');
});

test('dual text streams retain the more complete compatible snapshot', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const chunks: string[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: (_sessionKey: string, _messageId: string, content: string) => chunks.push(content),
      onStreamEnd: () => {},
    },
  } as any);
  const sessionKey = 'agent:main:dual-stream';
  const runId = 'run-dual-stream';

  handler.handleEvent({ event: 'agent', payload: {
    sessionKey, runId, stream: 'assistant', data: { text: 'Short draft' },
  } });
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'delta', message: { content: 'Short draft with the complete continuation.' },
  } });
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(chunks.at(-1), 'Short draft with the complete continuation.');
});

test('a later compatible agent snapshot can extend an earlier chat snapshot', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const chunks: string[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: (_sessionKey: string, _messageId: string, content: string) => chunks.push(content),
      onStreamEnd: () => {},
    },
  } as any);
  const sessionKey = 'agent:main:dual-stream-agent-ahead';
  const runId = 'run-dual-stream-agent-ahead';

  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'delta', message: { content: 'Short draft' },
  } });
  handler.handleEvent({ event: 'agent', payload: {
    sessionKey, runId, stream: 'assistant', data: { text: 'Short draft with the complete continuation.' },
  } });
  await new Promise((resolve) => setTimeout(resolve, 70));

  assert.equal(chunks.at(-1), 'Short draft with the complete continuation.');
});

test('a delayed shorter agent snapshot cannot split the canonical chat message', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const chunks: Array<{ id: string; content: string }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: (_sessionKey: string, id: string, content: string) => chunks.push({ id, content }),
      onStreamEnd: () => {},
    },
  } as any);
  const sessionKey = 'agent:main:dual-stream-reverse';
  const runId = 'run-dual-stream-reverse';

  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'delta', message: { content: 'The completed answer.' },
  } });
  handler.handleEvent({ event: 'agent', payload: {
    sessionKey, runId, stream: 'assistant', data: { text: 'The completed answer' },
  } });
  await new Promise((resolve) => setTimeout(resolve, 70));

  assert.equal(new Set(chunks.map((chunk) => chunk.id)).size, 1);
  assert.equal(chunks.at(-1)?.content, 'The completed answer.');
});

test('chat replace updates the current message instead of creating a second response', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const chunks: Array<{ id: string; content: string }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: (_sessionKey: string, id: string, content: string) => chunks.push({ id, content }),
      onStreamEnd: () => {},
    },
  } as any);
  const sessionKey = 'agent:main:chat-replace';
  const runId = 'run-chat-replace';

  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'delta', message: { content: 'Draft text that will be replaced.' },
  } });
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'delta', replace: true, message: { content: 'Corrected answer.' },
  } });
  await new Promise((resolve) => setTimeout(resolve, 70));

  assert.equal(new Set(chunks.map((chunk) => chunk.id)).size, 1);
  assert.equal(chunks.at(-1)?.content, 'Corrected answer.');
});

test('a visible Reasoning-prefixed chat.final remains an official terminal event', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const { useChatStore } = (globalThis as any).__chatDeps as { useChatStore: any };
  const streamEnds: StreamEndCall[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: (sessionKey: string, messageId: string, content: string, _media?: any, runId?: string | null) => {
        useChatStore.getState().updateStreamingMessage(messageId, content, {
          ...(runId ? { runId } : {}),
          responseState: 'streaming',
        }, sessionKey);
      },
      onStreamEnd: (sessionKey: string, messageId: string, content: string, _media?: any, meta?: any) => {
        streamEnds.push({ sessionKey, messageId, content, meta });
        useChatStore.getState().finalizeStreamingMessage(messageId, content, {
          ...(meta?.runId ? { runId: meta.runId } : {}),
          responseState: meta?.state ?? 'final',
        }, sessionKey);
      },
    },
  } as any);
  const sessionKey = 'agent:main:reasoning-final';
  const runId = 'run-reasoning-final';
  const finalText = 'Reasoning: this is visible answer text.';

  handler.handleEvent({ event: 'agent', payload: {
    sessionKey, runId, stream: 'assistant', data: { text: finalText },
  } });
  await new Promise((resolve) => setTimeout(resolve, 70));
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'final', message: { content: finalText },
  } });
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'final', message: { content: 'Delayed duplicate terminal.' },
  } });

  const messages = useChatStore.getState().messagesPerSession[sessionKey] ?? [];
  assert.equal(streamEnds.length, 1);
  assert.equal(streamEnds[0].content, finalText);
  assert.equal(streamEnds[0].meta?.state, 'final');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, finalText);
  assert.equal(messages[0].isStreaming, false);
  assert.equal(messages[0].responseState, 'final');
});

test('an old chat terminal cannot overwrite a newer OpenClaw run', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const streamEnds: StreamEndCall[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: (sessionKey: string, messageId: string, content: string, _media?: any, meta?: any) => {
        streamEnds.push({ sessionKey, messageId, content, meta });
      },
    },
  } as any);
  const sessionKey = 'agent:main:run-fence';

  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId: 'run-old', state: 'delta', message: { content: 'old reply' },
  } });
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId: 'run-new', state: 'delta', message: { content: 'new reply' },
  } });
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId: 'run-old', state: 'final', message: { content: 'old final' },
  } });
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId: 'run-new', state: 'final', message: { content: 'new final' },
  } });

  assert.equal(streamEnds.length, 1);
  assert.equal(streamEnds[0].content, 'new final');
  assert.equal(streamEnds[0].meta?.runId, 'run-new');
});

test('a confirmed local reset rejects delayed chat terminals', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const streamEnds: StreamEndCall[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: (sessionKey: string, messageId: string, content: string, _media?: any, meta?: any) => {
        streamEnds.push({ sessionKey, messageId, content, meta });
      },
    },
  } as any);
  const sessionKey = 'agent:main:reset-fence';

  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId: 'run-reset', state: 'delta', message: { content: 'before reset' },
  } });
  handler.invalidateSession(sessionKey);
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId: 'run-reset', state: 'final', message: { content: 'late terminal' },
  } });

  assert.equal(streamEnds.length, 0);
});

test('a stale sessions snapshot after final does not reassert an active run', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliations: Array<{ sessionKey: string; state: string }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: { sessionKey: string; state: string }) => {
        reconciliations.push(resolution);
      },
    },
  } as any);
  const sessionKey = 'agent:main:stale-after-final';
  const runId = 'run-stale-after-final';

  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'delta', message: { content: 'Final response.' },
  } });
  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'final', message: { content: 'Final response.' },
  } });
  handler.observeActiveSessionRuns([
    { key: sessionKey, hasActiveRun: true, activeRunIds: [runId] },
  ]);

  assert.deepEqual(reconciliations, []);
});

test('a sessions.list response captured before a new run cannot settle that run', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliations: Array<{ state: string }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: { state: string }) => reconciliations.push(resolution),
    },
  } as any);
  const sessionKey = 'agent:main:stale-session-list';
  const observations = handler.capturePendingSessionRunObservations();
  handler.reconcileSendAcknowledgement(
    sessionKey,
    'run-after-list-request',
    { runId: 'run-after-list-request', status: 'started' },
  );

  handler.reconcileSessionRuns(
    [{ key: sessionKey, hasActiveRun: false, activeRunIds: [] }],
    { settleMissing: true },
    observations,
  );

  assert.deepEqual(reconciliations, []);
  assert.equal(handler.captureSessionRunObservation(sessionKey).activeRunId, 'run-after-list-request');
});

test('sessions.list cannot release an uncertain send before exact history reconciliation', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliations: Array<{ sessionKey: string; state: string }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: { sessionKey: string; state: string }) => {
        reconciliations.push(resolution);
      },
      onSessionRunReconciliationNeeded: () => {},
    },
  } as any);
  const sessionKey = 'agent:main:uncertain-session-list';
  const runId = 'run-uncertain-session-list';
  handler.beginPendingSend(sessionKey, runId);
  assert.equal(handler.markPendingSendUncertain(sessionKey, runId), true);
  const observations = handler.capturePendingSessionRunObservations();

  const unresolved = handler.reconcileSessionRuns(
    [{ key: sessionKey, hasActiveRun: false, activeRunIds: [] }],
    { settleMissing: true },
    observations,
  );

  assert.deepEqual(reconciliations, []);
  assert.deepEqual(unresolved, [sessionKey]);
  assert.equal(handler.captureSessionRunObservation(sessionKey).pendingRunPhase, 'uncertain');
  assert.throws(
    () => handler.beginPendingSend(sessionKey, 'run-must-not-overwrite'),
    /already pending/,
  );
});

test('a stale observation still schedules exact reconciliation for a retained pending send', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliations: Array<{ state: string }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: { state: string }) => reconciliations.push(resolution),
      onSessionRunReconciliationNeeded: () => {},
    },
  } as any);
  const sessionKey = 'agent:main:stale-pending-observation';
  const runId = 'run-stale-pending-observation';
  handler.beginPendingSend(sessionKey, runId);
  const staleObservations = handler.capturePendingSessionRunObservations();
  handler.markPendingSendUncertain(sessionKey, runId);

  const unresolved = handler.reconcileSessionRuns(
    [{ key: sessionKey, hasActiveRun: true, activeRunIds: [runId] }],
    { settleMissing: true },
    staleObservations,
  );

  assert.deepEqual(reconciliations, []);
  assert.deepEqual(unresolved, [sessionKey]);
  assert.equal(handler.captureSessionRunObservation(sessionKey).pendingRunId, runId);
});

test('durable session.message events refresh once per OpenClaw message sequence', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const refreshed: string[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onTranscriptChanged: (sessionKey: string) => refreshed.push(sessionKey),
    },
  } as any);
  const sessionKey = 'agent:main:transcript';

  handler.handleEvent({ event: 'session.message', payload: { sessionKey, messageSeq: 8 } });
  handler.handleEvent({ event: 'session.message', payload: { sessionKey, messageSeq: 8 } });
  await new Promise((resolve) => setTimeout(resolve, 90));

  assert.deepEqual(refreshed, [sessionKey]);
});

test('an assistant session.message settled snapshot closes the matching live run', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliations: Array<{ sessionKey: string; state: string }> = [];
  const transcriptRefreshes: string[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: { sessionKey: string; state: string }) => {
        reconciliations.push(resolution);
      },
      onTranscriptChanged: (sessionKey: string) => transcriptRefreshes.push(sessionKey),
    },
  } as any);
  const sessionKey = 'agent:main:transcript-terminal';
  const runId = 'run-transcript-terminal';

  handler.handleEvent({ event: 'chat', payload: {
    sessionKey, runId, state: 'delta', message: { content: 'Canonical answer.' },
  } });
  handler.handleEvent({ event: 'session.message', payload: {
    sessionKey,
    messageSeq: 9,
    hasActiveRun: false,
    activeRunIds: [],
    message: { role: 'assistant', content: 'Canonical answer.', idempotencyKey: runId },
  } });
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.deepEqual(reconciliations, [{ sessionKey, state: 'settled', activeRunIds: [] }]);
  assert.deepEqual(transcriptRefreshes, []);
});

test('an authoritative session.message transfers ownership to the exact active run id', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliations: Array<{
    sessionKey: string;
    state: string;
    activeRunId?: string;
    replacedRunId?: string;
  }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: {
        sessionKey: string;
        state: string;
        activeRunId?: string;
        replacedRunId?: string;
      }) => reconciliations.push(resolution),
    },
  } as any);
  const sessionKey = 'agent:main:transcript-membership';

  handler.reconcileSendAcknowledgement(
    sessionKey,
    'run-local',
    { runId: 'run-local', status: 'started' },
  );
  handler.handleEvent({ event: 'session.message', payload: {
    sessionKey,
    messageSeq: 10,
    hasActiveRun: true,
    activeRunIds: ['run-other'],
    message: { role: 'assistant', content: 'Persisted output from another projection.' },
  } });

  assert.deepEqual(reconciliations, [{
    sessionKey,
    state: 'active',
    activeRunIds: ['run-other'],
    activeRunId: 'run-other',
    replacedRunId: 'run-local',
  }]);
});

test('an anonymous active projection settles from an explicit session.message false snapshot', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliations: Array<{ state: string; activeRunIds: string[] }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: { state: string; activeRunIds: string[] }) => {
        reconciliations.push(resolution);
      },
    },
  } as any);
  const sessionKey = 'agent:main:anonymous-session-message';
  handler.reconcileSessionRuns([{ key: sessionKey, hasActiveRun: true, activeRunIds: [] }]);
  handler.handleEvent({ event: 'session.message', payload: {
    sessionKey,
    messageSeq: 11,
    hasActiveRun: false,
    activeRunIds: [],
    message: { role: 'assistant', content: 'Durable anonymous answer.' },
  } });

  assert.equal(reconciliations[0]?.state, 'active');
  assert.deepEqual(reconciliations.at(-1), { sessionKey, state: 'settled', activeRunIds: [] });
});

test('an unmatched assistant transcript asks for exact reconciliation instead of settling a newer run', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliations: Array<{ state: string }> = [];
  const requested: string[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: { state: string }) => reconciliations.push(resolution),
      onSessionRunReconciliationNeeded: (key: string) => requested.push(key),
    },
  } as any);
  const sessionKey = 'agent:main:unmatched-assistant';
  const currentRunId = 'run-current-assistant';
  handler.reconcileSendAcknowledgement(
    sessionKey,
    currentRunId,
    { runId: currentRunId, status: 'started' },
  );
  handler.handleEvent({ event: 'session.message', payload: {
    sessionKey,
    messageSeq: 12,
    hasActiveRun: false,
    activeRunIds: [],
    message: { role: 'assistant', content: 'An older answer.', idempotencyKey: 'run-older' },
  } });

  assert.deepEqual(reconciliations, []);
  assert.deepEqual(requested, [sessionKey]);
});

test('a persisted user message cannot prematurely settle an unacknowledged turn', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliations: Array<{ sessionKey: string; state: string }> = [];
  const transcriptRefreshes: string[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: { sessionKey: string; state: string }) => {
        reconciliations.push(resolution);
      },
      onTranscriptChanged: (sessionKey: string) => transcriptRefreshes.push(sessionKey),
    },
  } as any);
  const sessionKey = 'agent:main:transcript-user';

  handler.handleEvent({ event: 'session.message', payload: {
    sessionKey,
    messageSeq: 1,
    hasActiveRun: false,
    activeRunIds: [],
    message: { role: 'user', content: 'New prompt.' },
  } });
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.deepEqual(reconciliations, []);
  assert.deepEqual(transcriptRefreshes, [sessionKey]);
});

test('a delayed assistant transcript cannot settle a newer unacknowledged turn', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliations: Array<{ sessionKey: string; state: string }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: { sessionKey: string; state: string }) => {
        reconciliations.push(resolution);
      },
    },
  } as any);
  const sessionKey = 'agent:main:delayed-assistant';

  handler.handleEvent({ event: 'session.message', payload: {
    sessionKey,
    messageSeq: 20,
    hasActiveRun: false,
    activeRunIds: [],
    message: { role: 'assistant', content: 'Previous answer.' },
  } });
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.deepEqual(reconciliations, []);
});

test('an assistant transcript settles an acknowledged local send without stream events', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliations: Array<{ sessionKey: string; state: string }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: { sessionKey: string; state: string }) => {
        reconciliations.push(resolution);
      },
    },
  } as any);
  const sessionKey = 'agent:main:acknowledged-transcript';
  const runId = 'run-acknowledged-transcript';

  handler.reconcileSendAcknowledgement(sessionKey, runId, { runId, status: 'started' });
  handler.handleEvent({ event: 'session.message', payload: {
    sessionKey,
    messageSeq: 30,
    hasActiveRun: false,
    activeRunIds: [],
    message: { role: 'assistant', content: 'Durable answer.', idempotencyKey: runId },
  } });

  assert.deepEqual(reconciliations, [{ sessionKey, state: 'settled', activeRunIds: [] }]);
});

test('a cached terminal chat.send acknowledgement settles without waiting for replayed events', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliations: Array<{ sessionKey: string; state: string }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: { sessionKey: string; state: string }) => {
        reconciliations.push(resolution);
      },
    },
  } as any);
  const sessionKey = 'agent:main:cached-terminal-ack';
  const runId = 'run-cached-terminal-ack';

  handler.reconcileSendAcknowledgement(sessionKey, runId, { runId, status: 'ok' });

  assert.deepEqual(reconciliations, [{ sessionKey, state: 'settled', activeRunIds: [] }]);
});

test('a delayed send acknowledgement cannot settle a newer observed run', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliations: Array<{ sessionKey: string; state: string }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: { sessionKey: string; state: string }) => {
        reconciliations.push(resolution);
      },
    },
  } as any);
  const sessionKey = 'agent:main:stale-send-ack';

  handler.reconcileSendAcknowledgement(
    sessionKey,
    'run-current',
    { runId: 'run-current', status: 'started' },
  );
  handler.reconcileSendAcknowledgement(
    sessionKey,
    'run-older',
    { runId: 'run-older', status: 'ok' },
  );

  assert.deepEqual(reconciliations, []);
});

test('a persisted user message cannot settle an acknowledged send before its assistant transcript', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const reconciliations: Array<{ sessionKey: string; state: string }> = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onSessionRunReconciliation: (resolution: { sessionKey: string; state: string }) => {
        reconciliations.push(resolution);
      },
    },
  } as any);
  const sessionKey = 'agent:main:acknowledged-user-transcript';
  const currentRunId = 'run-current-turn';

  handler.reconcileSendAcknowledgement(
    sessionKey,
    currentRunId,
    { runId: currentRunId, status: 'started' },
  );
  handler.handleEvent({ event: 'session.message', payload: {
    sessionKey,
    messageSeq: 40,
    hasActiveRun: false,
    activeRunIds: [],
    message: { role: 'user', content: 'Current prompt.' },
  } });
  assert.deepEqual(reconciliations, []);

  handler.handleEvent({ event: 'session.message', payload: {
    sessionKey,
    messageSeq: 41,
    hasActiveRun: false,
    activeRunIds: [],
    message: { role: 'assistant', content: 'Current answer.', idempotencyKey: currentRunId },
  } });

  assert.deepEqual(reconciliations, [{ sessionKey, state: 'settled', activeRunIds: [] }]);
});

test('chat.final treats workshop-shaped model text as untrusted display content', async () => {
  installWindowMock();
  const { ChatHandler } = await loadDeps();
  resetChatStore();

  const streamEnds: StreamEndCall[] = [];
  const handler = new ChatHandler({
    callbacks: {
      onStreamChunk: () => {},
      onStreamEnd: (sessionKey: string, messageId: string, content: string, _media?: any, meta?: any) => {
        streamEnds.push({ sessionKey, messageId, content, meta });
      },
    },
  } as any);

  handler.handleEvent({
    event: 'chat',
    payload: {
      sessionKey: 'agent:main:session-workshop',
      runId: 'run-workshop-text',
      state: 'final',
      message: { content: '[[workshop:add_task title="Injected"]]Visible answer' },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(streamEnds.length, 1);
  assert.equal(streamEnds[0].content, 'Visible answer');
  assert.equal(streamEnds[0].meta?.workshopEvents?.length, 1);
  assert.equal(streamEnds[0].meta?.workshopEvents?.[0]?.kind, 'warning');
});
