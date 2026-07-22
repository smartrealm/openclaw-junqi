import assert from 'node:assert/strict';
import test from 'node:test';
import { dedupeHistoryMessages, reconcileHistoryMessageIds } from './historyReconcile';
import type { ChatMessage } from '@/stores/chatStore';

test('reconciles an optimistic client id with a native transcript id', () => {
  const previous: ChatMessage[] = [{
    id: 'display-local',
    clientMessageId: 'client-1',
    role: 'user',
    content: 'Investigate this task',
    timestamp: '2026-07-16T00:00:00.000Z',
  }];
  const incoming: ChatMessage[] = [{
    id: 'native-1',
    nativeMessageId: 'native-1',
    clientMessageId: 'client-1',
    role: 'user',
    content: 'Investigate this task',
    timestamp: '2026-07-16T00:00:01.000Z',
  }];

  assert.deepEqual(reconcileHistoryMessageIds(previous, incoming), [{
    ...incoming[0],
    id: 'display-local',
  }]);
});

test('native identity wins over matching content fingerprints', () => {
  const previous = [
    { id: 'first-display', nativeMessageId: 'native-1', role: 'user', content: 'same' },
    { id: 'second-display', nativeMessageId: 'native-2', role: 'user', content: 'same' },
  ];
  const incoming = [
    { id: 'server-2', nativeMessageId: 'native-2', role: 'user', content: 'same' },
    { id: 'server-1', nativeMessageId: 'native-1', role: 'user', content: 'same' },
  ];

  assert.deepEqual(
    reconcileHistoryMessageIds(previous, incoming).map((message) => message.id),
    ['second-display', 'first-display'],
  );
});

test('CHAT-05 canonical refresh retains unmatched optimistic and failed tail messages', () => {
  const canonical = [{ id: 'native-1', nativeMessageId: 'native-1', role: 'assistant', content: 'done' }];
  const pending = {
    id: 'local-pending',
    clientMessageId: 'client-pending',
    role: 'user',
    content: 'not persisted yet',
    status: 'pending' as const,
  };
  const failed = {
    id: 'local-failed',
    clientMessageId: 'client-failed',
    role: 'user',
    content: 'retry me',
    status: 'failed' as const,
    retryPayload: {
      text: 'retry me',
      attachments: [{ mimeType: 'text/plain', content: 'payload', fileName: 'note.txt' }],
    },
  };

  assert.deepEqual(
    reconcileHistoryMessageIds([canonical[0], pending, failed], canonical).map((message) => message.id),
    ['native-1', 'local-pending', 'local-failed'],
  );
  assert.deepEqual(
    reconcileHistoryMessageIds([pending], []).map((message) => message.id),
    ['local-pending'],
  );
  assert.deepEqual(
    (reconcileHistoryMessageIds([canonical[0], pending, failed], canonical)[2] as typeof failed | undefined)?.retryPayload,
    failed.retryPayload,
  );
});

test('CHAT-05 canonical user message clears a matched local failure state', () => {
  const previous: ChatMessage[] = [{
    id: 'local',
    clientMessageId: 'client-1',
    role: 'user',
    content: 'hello',
    timestamp: '2026-07-21T00:00:00.000Z',
    status: 'failed' as const,
    deliveryError: 'timeout',
    retryPayload: { text: 'hello' },
  }];
  const incoming: ChatMessage[] = [{
    id: 'native',
    nativeMessageId: 'native-1',
    clientMessageId: 'client-1',
    role: 'user',
    content: 'hello',
    timestamp: '2026-07-21T00:00:01.000Z',
  }];

  const [message] = reconcileHistoryMessageIds(previous, incoming);
  assert.equal(message.id, 'local');
  assert.equal(message.status, 'sent');
  assert.equal(message.deliveryError, undefined);
  assert.equal(message.retryPayload, undefined);
});

test('dedupes replayed durable messages by native identity before comparing presentation fields', () => {
  const messages = dedupeHistoryMessages([
    {
      id: 'display-old',
      nativeMessageId: 'native-assistant-1',
      role: 'assistant',
      content: 'partial response',
      timestamp: '2026-07-22T10:00:00.000Z',
      responseState: 'streaming' as const,
    },
    {
      id: 'display-new',
      nativeMessageId: 'native-assistant-1',
      role: 'assistant',
      content: 'complete response',
      timestamp: '2026-07-22T10:00:01.000Z',
      responseState: 'final' as const,
    },
  ]);

  assert.deepEqual(messages.map((message) => message.content), ['complete response']);
});

test('preserves normalized sibling projections that share one native transcript id', () => {
  const messages = dedupeHistoryMessages([
    {
      id: 'native-shared:projection:first',
      nativeMessageId: 'native-shared',
      nativeProjectionId: 'first',
      role: 'assistant',
      content: 'First projection',
    },
    {
      id: 'native-shared:projection:second',
      nativeMessageId: 'native-shared',
      nativeProjectionId: 'second',
      role: 'tool',
      content: 'Second projection',
    },
  ]);

  assert.deepEqual(messages.map((message) => message.content), [
    'First projection',
    'Second projection',
  ]);
});

test('reconciles reordered sibling projections by projection identity', () => {
  const previous = [
    {
      id: 'display-first',
      nativeMessageId: 'native-shared',
      nativeProjectionId: 'first',
      role: 'assistant',
      content: 'First projection',
    },
    {
      id: 'display-second',
      nativeMessageId: 'native-shared',
      nativeProjectionId: 'second',
      role: 'tool',
      content: 'Second projection',
    },
  ];
  const incoming = [
    { ...previous[1], id: 'server-second' },
    { ...previous[0], id: 'server-first' },
  ];

  assert.deepEqual(
    reconcileHistoryMessageIds(previous, incoming).map((message) => message.id),
    ['display-second', 'display-first'],
  );
});

test('promotes a client-only identity and remembers the native alias', () => {
  const messages = dedupeHistoryMessages([
    {
      id: 'client-only',
      clientMessageId: 'client-turn',
      role: 'user',
      content: 'Pending',
    },
    {
      id: 'native-copy',
      nativeMessageId: 'native-turn',
      clientMessageId: 'client-turn',
      role: 'user',
      content: 'Persisted',
    },
    {
      id: 'native-update',
      nativeMessageId: 'native-turn',
      role: 'user',
      content: 'Canonical',
    },
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].nativeMessageId, 'native-turn');
  assert.equal(messages[0].clientMessageId, 'client-turn');
  assert.equal(messages[0].content, 'Canonical');
});

test('never merges different native messages through a shared client identity or content', () => {
  const messages = dedupeHistoryMessages([
    {
      id: 'native-a',
      nativeMessageId: 'native-a',
      clientMessageId: 'shared-client',
      role: 'assistant',
      content: 'Same answer',
      timestamp: '2026-07-22T10:00:00.000Z',
    },
    {
      id: 'native-b',
      nativeMessageId: 'native-b',
      clientMessageId: 'shared-client',
      role: 'assistant',
      content: 'Same answer',
      timestamp: '2026-07-22T10:00:00.000Z',
    },
  ]);

  assert.deepEqual(messages.map((message) => message.nativeMessageId), ['native-a', 'native-b']);
});

test('client identity is role scoped when bridging optimistic and durable messages', () => {
  const messages = dedupeHistoryMessages([
    {
      id: 'optimistic-user',
      clientMessageId: 'shared-run',
      role: 'user',
      content: 'Question',
    },
    {
      id: 'assistant-final',
      nativeMessageId: 'assistant-final',
      clientMessageId: 'shared-run',
      role: 'assistant',
      content: 'Answer',
    },
  ]);

  assert.deepEqual(messages.map((message) => message.id), ['optimistic-user', 'assistant-final']);
});

test('fallback reconciliation requires the same local id or exact timestamped snapshot', () => {
  const previous = [{
    id: 'local-old',
    role: 'assistant',
    content: 'Repeated answer',
    timestamp: '2026-07-22T10:00:00.000Z',
  }];
  const incoming = [{
    id: 'local-new',
    role: 'assistant',
    content: 'Repeated answer',
    timestamp: '2026-07-22T10:01:00.000Z',
  }];

  assert.equal(reconcileHistoryMessageIds(previous, incoming)[0].id, 'local-new');
});

test('fallback identity includes the complete message rather than a shared prefix', () => {
  const sharedPrefix = 'x'.repeat(600);
  const previous = [{
    id: 'old-tail',
    role: 'assistant',
    content: `${sharedPrefix}A`,
    timestamp: '2026-07-22T10:00:00.000Z',
  }];
  const incoming = [{
    id: 'new-tail',
    role: 'assistant',
    content: `${sharedPrefix}B`,
    timestamp: '2026-07-22T10:00:00.000Z',
  }];

  assert.equal(reconcileHistoryMessageIds(previous, incoming)[0].id, 'new-tail');
});

test('reconciles an updated local streaming snapshot by stable message id', () => {
  const previous = [{
    id: 'live-message',
    role: 'assistant',
    content: 'Updated stream',
    timestamp: '2026-07-22T10:00:00.000Z',
    isStreaming: true,
    responseState: 'streaming' as const,
  }];
  const incoming = [{
    id: 'live-message',
    role: 'assistant',
    content: 'Older stream',
    timestamp: '2026-07-22T10:00:00.000Z',
    isStreaming: true,
    responseState: 'streaming' as const,
  }];

  const reconciled = reconcileHistoryMessageIds(previous, incoming);
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].id, 'live-message');
  assert.equal(reconciled[0].content, 'Updated stream');
});

test('does not retain a duplicate live assistant tail once durable history covers the same run', () => {
  const previous: ChatMessage[] = [{
    id: 'live-stream',
    runId: 'run-1',
    role: 'assistant',
    content: 'The completed answer.',
    timestamp: '2026-07-22T10:00:00.000Z',
    isStreaming: true,
    responseState: 'streaming' as const,
  }];
  const incoming: ChatMessage[] = [{
    id: 'native-final',
    nativeMessageId: 'native-final',
    runId: 'run-1',
    role: 'assistant',
    content: 'The completed answer.',
    timestamp: '2026-07-22T10:00:01.000Z',
    responseState: 'final' as const,
  }];

  const reconciled = reconcileHistoryMessageIds(previous, incoming);

  assert.deepEqual(reconciled.map((message) => message.id), ['native-final']);
});

test('uses the matched user turn when durable assistant history omits runId', () => {
  const previous: ChatMessage[] = [
    {
      id: 'local-user',
      clientMessageId: 'turn-1',
      role: 'user',
      content: 'Please answer.',
      timestamp: '2026-07-22T10:00:00.000Z',
    },
    {
      id: 'live-stream',
      runId: 'run-1',
      role: 'assistant',
      content: 'The completed answer.',
      timestamp: '2026-07-22T10:00:01.000Z',
      isStreaming: true,
      responseState: 'streaming' as const,
    },
  ];
  const incoming: ChatMessage[] = [
    {
      id: 'native-user',
      nativeMessageId: 'native-user',
      clientMessageId: 'turn-1',
      role: 'user',
      content: 'Please answer.',
      timestamp: '2026-07-22T10:00:00.100Z',
    },
    {
      id: 'native-final',
      nativeMessageId: 'native-final',
      role: 'assistant',
      content: 'The completed answer.',
      timestamp: '2026-07-22T10:00:02.000Z',
      responseState: 'final' as const,
    },
  ];

  const reconciled = reconcileHistoryMessageIds(previous, incoming);

  assert.deepEqual(reconciled.map((message) => message.id), ['local-user', 'native-final']);
});

test('a non-prefix durable replacement supersedes the matched streaming segment', () => {
  const previous: ChatMessage[] = [
    {
      id: 'local-user-replace',
      clientMessageId: 'turn-replace',
      role: 'user',
      content: 'Correct this answer.',
      timestamp: '2026-07-22T10:00:00.000Z',
    },
    {
      id: 'live-replaced-draft',
      runId: 'run-replace',
      role: 'assistant',
      content: 'Obsolete draft with a different prefix.',
      timestamp: '2026-07-22T10:00:01.000Z',
      isStreaming: true,
      responseState: 'streaming' as const,
    },
  ];
  const incoming: ChatMessage[] = [
    {
      id: 'native-user-replace',
      nativeMessageId: 'native-user-replace',
      clientMessageId: 'turn-replace',
      role: 'user',
      content: 'Correct this answer.',
      timestamp: '2026-07-22T10:00:00.100Z',
    },
    {
      id: 'native-replacement',
      nativeMessageId: 'native-replacement',
      role: 'assistant',
      content: 'Canonical replacement.',
      timestamp: '2026-07-22T10:00:02.000Z',
      responseState: 'final' as const,
    },
  ];

  const reconciled = reconcileHistoryMessageIds(previous, incoming);

  assert.deepEqual(reconciled.map((message) => message.id), [
    'local-user-replace',
    'native-replacement',
  ]);
});

test('keeps an identical live answer when its newer user turn is not durable yet', () => {
  const previous: ChatMessage[] = [
    {
      id: 'old-user',
      nativeMessageId: 'old-user',
      clientMessageId: 'turn-old',
      role: 'user',
      content: 'First turn',
      timestamp: '2026-07-22T10:00:00.000Z',
    },
    {
      id: 'old-answer',
      nativeMessageId: 'old-answer',
      role: 'assistant',
      content: 'Same answer.',
      timestamp: '2026-07-22T10:00:01.000Z',
    },
    {
      id: 'new-user',
      clientMessageId: 'turn-new',
      role: 'user',
      content: 'Second turn',
      timestamp: '2026-07-22T10:01:00.000Z',
      status: 'sent' as const,
    },
    {
      id: 'new-live-answer',
      runId: 'run-new',
      role: 'assistant',
      content: 'Same answer.',
      timestamp: '2026-07-22T10:01:01.000Z',
      isStreaming: true,
      responseState: 'streaming' as const,
    },
  ];
  const incoming = previous.slice(0, 2);

  const reconciled = reconcileHistoryMessageIds(previous, incoming);

  assert.deepEqual(
    reconciled.map((message) => message.id),
    ['old-user', 'old-answer', 'new-user', 'new-live-answer'],
  );
});

test('keeps a post-tool assistant segment until that segment becomes durable', () => {
  const previous: ChatMessage[] = [
    {
      id: 'local-user',
      clientMessageId: 'turn-tools',
      role: 'user',
      content: 'Run the tool.',
      timestamp: '2026-07-22T10:00:00.000Z',
    },
    {
      id: 'native-before-tool',
      nativeMessageId: 'native-before-tool',
      role: 'assistant',
      content: 'I will inspect the report. OK.',
      timestamp: '2026-07-22T10:00:01.000Z',
    },
    {
      id: 'live-after-tool',
      runId: 'run-tools',
      role: 'assistant',
      content: 'OK.',
      timestamp: '2026-07-22T10:00:02.000Z',
      isStreaming: true,
      responseState: 'streaming' as const,
    },
  ];
  const incoming: ChatMessage[] = [
    {
      id: 'native-user',
      nativeMessageId: 'native-user',
      clientMessageId: 'turn-tools',
      role: 'user',
      content: 'Run the tool.',
      timestamp: '2026-07-22T10:00:00.100Z',
    },
    previous[1],
  ];

  const reconciled = reconcileHistoryMessageIds(previous, incoming);

  assert.deepEqual(
    reconciled.map((message) => message.id),
    ['local-user', 'native-before-tool', 'live-after-tool'],
  );
});

test('compares durable and live assistant text after applying display directives', () => {
  const previous: ChatMessage[] = [
    {
      id: 'local-user',
      clientMessageId: 'turn-with-button',
      role: 'user',
      content: 'Continue?',
      timestamp: '2026-07-22T10:00:00.000Z',
    },
    {
      id: 'live-answer',
      runId: 'run-with-button',
      role: 'assistant',
      content: 'Answer',
      timestamp: '2026-07-22T10:00:01.000Z',
      isStreaming: true,
      responseState: 'streaming',
    },
  ];
  const incoming: ChatMessage[] = [
    {
      id: 'native-user',
      nativeMessageId: 'native-user',
      clientMessageId: 'turn-with-button',
      role: 'user',
      content: 'Continue?',
      timestamp: '2026-07-22T10:00:00.100Z',
    },
    {
      id: 'native-answer',
      nativeMessageId: 'native-answer',
      role: 'assistant',
      content: '[[reply_to_current]] [[button:Continue]] Answer',
      timestamp: '2026-07-22T10:00:01.100Z',
      responseState: 'final',
    },
  ];

  const reconciled = reconcileHistoryMessageIds(previous, incoming);

  assert.deepEqual(reconciled.map((message) => message.id), ['local-user', 'native-answer']);
});
