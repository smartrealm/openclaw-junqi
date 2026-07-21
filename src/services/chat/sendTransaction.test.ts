import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '@/stores/chatStore';
import { ChatSendCoordinator } from './sendTransaction';

test('CHAT-02 rejected send records a retryable failure and releases typing', async () => {
  const messages = new Map<string, ChatMessage>();
  const typing: boolean[] = [];
  const coordinator = new ChatSendCoordinator(
    { sendMessage: async () => { throw new Error('transport rejected'); } },
    () => ({
      addMessage(message) { messages.set(message.id, message); },
      updateMessage(_sessionKey, id, patch) {
        const current = messages.get(id);
        if (current) messages.set(id, { ...current, ...patch });
      },
      setIsTyping(value) { typing.push(value); },
    }),
  );

  await assert.rejects(
    coordinator.send({ sessionKey: 'session-a', message: 'hello', clientMessageId: 'client-1' }),
    /transport rejected/,
  );
  assert.equal(messages.get('client-1')?.status, 'failed');
  assert.equal(messages.get('client-1')?.deliveryError, 'transport rejected');
  assert.deepEqual(typing, [true, false]);
});

test('CHAT-02 disconnected acknowledgement commits queued state without leaving typing active', async () => {
  const messages = new Map<string, ChatMessage>();
  const typing: boolean[] = [];
  const coordinator = new ChatSendCoordinator(
    { sendMessage: async () => ({ queued: true }) },
    () => ({
      addMessage(message) { messages.set(message.id, message); },
      updateMessage(_sessionKey, id, patch) {
        const current = messages.get(id);
        if (current) messages.set(id, { ...current, ...patch });
      },
      setIsTyping(value) { typing.push(value); },
    }),
  );

  await coordinator.send({ sessionKey: 'session-a', message: 'hello', clientMessageId: 'client-2' });
  assert.equal(messages.get('client-2')?.status, 'queued');
  assert.deepEqual(typing, [true, false]);
});
