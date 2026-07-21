import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '@/stores/chatStore';
import { ChatSendCoordinator } from './sendTransaction';
import { sessionMutationGate } from './sessionMutationGate';

test('CHAT-02 rejected send records a retryable failure and releases typing', async () => {
  const messages = new Map<string, ChatMessage>();
  const typing: boolean[] = [];
  const queued: unknown[] = [];
  const coordinator = new ChatSendCoordinator(
    { sendMessage: async () => { throw new Error('transport rejected'); } },
    () => ({
      addMessage(message) { messages.set(message.id, message); },
      updateMessage(_sessionKey, id, patch) {
        const current = messages.get(id);
        if (current) messages.set(id, { ...current, ...patch });
      },
      setIsTyping(value) { typing.push(value); },
      typingBySession: {},
      enqueueMessage(_sessionKey, message) { queued.push(message); },
    }),
  );

  await assert.rejects(
    coordinator.send({ sessionKey: 'session-a', message: 'hello', clientMessageId: 'client-1' }),
    /transport rejected/,
  );
  assert.equal(messages.get('client-1')?.status, 'failed');
  assert.equal(messages.get('client-1')?.deliveryError, 'transport rejected');
  assert.deepEqual(messages.get('client-1')?.retryPayload, { text: 'hello' });
  assert.deepEqual(typing, [true, false]);
  assert.deepEqual(queued, []);
});

test('CHAT-02 active sessions use the visible session queue without touching the transport', async () => {
  const messages = new Map<string, ChatMessage>();
  const typing: boolean[] = [];
  const queued: Array<{ sessionKey: string; message: unknown }> = [];
  let transportCalls = 0;
  const coordinator = new ChatSendCoordinator(
    { sendMessage: async () => { transportCalls += 1; } },
    () => ({
      addMessage(message) { messages.set(message.id, message); },
      updateMessage(_sessionKey, id, patch) {
        const current = messages.get(id);
        if (current) messages.set(id, { ...current, ...patch });
      },
      setIsTyping(value) { typing.push(value); },
      typingBySession: { 'session-a': true },
      enqueueMessage(sessionKey, message) { queued.push({ sessionKey, message }); },
    }),
  );

  const result = await coordinator.send({
    sessionKey: 'session-a',
    sessionId: 'native-session-a',
    message: 'hello',
    attachments: [{ mimeType: 'text/plain', content: 'payload', fileName: 'note.txt' }],
    clientMessageId: 'client-2',
  });

  assert.deepEqual(result, {
    queued: true,
    queue: 'session',
    clientMessageId: 'client-2',
  });
  assert.equal(transportCalls, 0);
  assert.equal(messages.size, 0);
  assert.deepEqual(typing, []);
  assert.deepEqual(queued, [{
    sessionKey: 'session-a',
    message: {
      id: 'client-2',
      timestamp: (queued[0]?.message as { timestamp: string }).timestamp,
      text: 'hello',
      sessionId: 'native-session-a',
      attachments: [{ mimeType: 'text/plain', content: 'payload', fileName: 'note.txt' }],
    },
  }]);
});

test('CHAT-02 attachment failures retain the complete payload for lossless retry', async () => {
  const messages = new Map<string, ChatMessage>();
  const attachment = { mimeType: 'application/pdf', content: 'base64-data', fileName: 'brief.pdf' };
  const displayAttachment = { mimeType: 'application/pdf', content: '', fileName: 'brief.pdf' };
  const coordinator = new ChatSendCoordinator(
    { sendMessage: async () => { throw new Error('offline'); } },
    () => ({
      addMessage(message) { messages.set(message.id, message); },
      updateMessage(_sessionKey, id, patch) {
        const current = messages.get(id);
        if (current) messages.set(id, { ...current, ...patch });
      },
      setIsTyping() {},
      typingBySession: {},
      enqueueMessage() {},
    }),
  );

  await assert.rejects(coordinator.send({
    sessionKey: 'session-a',
    sessionId: 'native-session-a',
    message: 'review this',
    attachments: [attachment],
    displayAttachments: [displayAttachment],
    clientMessageId: 'client-3',
  }), /offline/);

  assert.deepEqual(messages.get('client-3')?.retryPayload, {
    text: 'review this',
    sessionId: 'native-session-a',
    attachments: [attachment],
    displayAttachments: [displayAttachment],
  });
  assert.deepEqual(messages.get('client-3')?.outboundAttachments, [
    { mimeType: 'application/pdf', fileName: 'brief.pdf' },
  ]);
});

test('CHAT-10 a destructive session mutation holds new sends in the visible queue', async () => {
  const queued: unknown[] = [];
  let transportCalls = 0;
  let releaseMutation!: () => void;
  const mutation = sessionMutationGate.run(
    'session-a',
    () => new Promise<void>((resolve) => { releaseMutation = resolve; }),
  );
  const coordinator = new ChatSendCoordinator(
    { sendMessage: async () => { transportCalls += 1; } },
    () => ({
      addMessage() {},
      updateMessage() {},
      setIsTyping() {},
      typingBySession: {},
      enqueueMessage(_sessionKey, message) { queued.push(message); },
    }),
  );

  await coordinator.send({
    sessionKey: 'session-a',
    message: 'after reset',
    clientMessageId: 'client-blocked',
  });

  assert.equal(transportCalls, 0);
  assert.equal(queued.length, 1);
  releaseMutation();
  await mutation;
});

test('CHAT-02 queue overflow becomes a visible retryable failure', async () => {
  const messages = new Map<string, ChatMessage>();
  const coordinator = new ChatSendCoordinator(
    { sendMessage: async () => { throw new Error('transport must not run'); } },
    () => ({
      addMessage(message) { messages.set(message.id, message); },
      updateMessage() {},
      setIsTyping() {},
      typingBySession: { 'session-a': true },
      enqueueMessage() { throw new Error('Session message queue is full (50 messages)'); },
    }),
  );

  await assert.rejects(coordinator.send({
    sessionKey: 'session-a',
    message: 'keep this text',
    clientMessageId: 'client-overflow',
  }), /queue is full/);
  assert.equal(messages.get('client-overflow')?.status, 'failed');
  assert.deepEqual(messages.get('client-overflow')?.retryPayload, { text: 'keep this text' });
});
