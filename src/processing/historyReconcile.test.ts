import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileHistoryMessageIds } from './historyReconcile';
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
