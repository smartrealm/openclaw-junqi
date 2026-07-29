import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '@/stores/chatStore';
import {
  editFailedUserMessage,
  localUserMessageCapabilities,
  removeLocalUserMessage,
} from './localUserMessageMutations';

function message(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'local-1',
    clientMessageId: 'local-1',
    role: 'user',
    content: 'original',
    timestamp: '2026-07-29T00:00:00.000Z',
    ...patch,
  };
}

test('failed local messages can be edited in place and retried without losing attachments', () => {
  const original = message({
    status: 'failed',
    retryPayload: {
      text: 'original',
      sessionId: 'session-1',
      attachments: [{ mimeType: 'text/plain', content: 'data', fileName: 'note.txt' }],
    },
  });

  assert.deepEqual(localUserMessageCapabilities(original), {
    canDelete: true,
    canEditAndRetry: true,
  });
  const edited = editFailedUserMessage(original, '  replacement  ');
  assert.equal(edited.content, 'replacement');
  assert.equal(edited.retryPayload?.text, 'replacement');
  assert.deepEqual(edited.retryPayload?.attachments, original.retryPayload?.attachments);
  assert.equal(original.content, 'original');
});

test('an unchanged failed message remains a valid retry payload', () => {
  const source = message({ status: 'failed', retryPayload: { text: 'original' } });
  const edited = editFailedUserMessage(source, `  ${source.content}  `);

  assert.equal(edited.content, source.content);
  assert.equal(edited.retryPayload?.text, source.content);
});

test('durable transcript messages cannot be locally edited or deleted', () => {
  const durable = message({
    nativeMessageId: 'native-1',
    status: 'sent',
    retryPayload: { text: 'original' },
  });
  assert.deepEqual(localUserMessageCapabilities(durable), {
    canDelete: false,
    canEditAndRetry: false,
  });
  assert.throws(() => editFailedUserMessage(durable, 'replacement'));
  assert.deepEqual(removeLocalUserMessage([durable], durable.id), [durable]);
});

test('failed and cancelled local messages can be discarded without touching siblings', () => {
  const failed = message({ status: 'failed', retryPayload: { text: 'original' } });
  const cancelled = message({ id: 'local-2', status: 'cancelled' });
  const durable = message({ id: 'native-1', nativeMessageId: 'native-1', status: 'sent' });
  assert.deepEqual(
    removeLocalUserMessage([failed, cancelled, durable], failed.id).map((item) => item.id),
    ['local-2', 'native-1'],
  );
  assert.deepEqual(
    removeLocalUserMessage([failed, cancelled, durable], cancelled.id).map((item) => item.id),
    ['local-1', 'native-1'],
  );
});
