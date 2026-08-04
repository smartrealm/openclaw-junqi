import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '@/stores/chatStore';
import { ChatSendCoordinator } from './sendTransaction';
import { sessionMutationGate } from './sessionMutationGate';
import { OpenClawSessionTargetError } from '@/services/gateway/OpenClawSessionTarget';

test('空会话目标会在写入本地状态、任务检查点和 Gateway 请求前失败', async () => {
  let stateReads = 0;
  let gatewayCalls = 0;
  let checkpointCalls = 0;
  const coordinator = new ChatSendCoordinator(
    { sendMessage: async () => { gatewayCalls += 1; } },
    () => {
      stateReads += 1;
      return {
        addMessage() {},
        updateMessage() {},
        setIsTyping() {},
        typingBySession: {},
        enqueueMessage() {},
      };
    },
    {
      prepareSend: async () => { checkpointCalls += 1; return { runId: 'empty-session', created: true }; },
      prepareSteer: async () => { checkpointCalls += 1; return { supersededRunId: null, created: true }; },
      isRunStopRequested: async () => false,
      settleRun: async () => {},
      reportPersistenceFailure() {},
    },
  );

  await assert.rejects(
    coordinator.send({ sessionKey: '   ', message: '不能发送', clientMessageId: 'empty-session' }),
    OpenClawSessionTargetError,
  );
  assert.equal(stateReads, 0);
  assert.equal(checkpointCalls, 0);
  assert.equal(gatewayCalls, 0);
});

test('STOP-04 a checkpointed Stop prevents normal and steer sends from reaching the Gateway', async () => {
  const messages = new Map<string, ChatMessage>();
  const typing: boolean[] = [];
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
      typingBySession: {},
      enqueueMessage() {},
    }),
    {
      prepareSend: async ({ runId }) => ({ runId, created: true }),
      prepareSteer: async () => ({ supersededRunId: null, created: true }),
      isRunStopRequested: async () => true,
      settleRun: async () => {},
      reportPersistenceFailure() {},
    },
  );

  const normal = await coordinator.send({
    sessionKey: 'session-a', message: 'do not dispatch', clientMessageId: 'stop-normal',
  });
  const steer = await coordinator.send({
    sessionKey: 'session-a', message: 'do not steer', clientMessageId: 'stop-steer', delivery: 'steer',
  });

  assert.deepEqual(normal, { cancelled: true, clientMessageId: 'stop-normal' });
  assert.deepEqual(steer, { cancelled: true, clientMessageId: 'stop-steer' });
  assert.equal(transportCalls, 0);
  assert.equal(messages.get('stop-normal')?.status, 'cancelled');
  assert.equal(messages.get('stop-steer')?.status, 'cancelled');
  assert.deepEqual(messages.get('stop-normal')?.retryPayload, { text: 'do not dispatch' });
  assert.deepEqual(typing, [true, false, true, false]);
});

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

test('an ambiguous transport result stays pending until official reconciliation', async () => {
  const messages = new Map<string, ChatMessage>();
  const typing: boolean[] = [];
  const coordinator = new ChatSendCoordinator(
    { sendMessage: async () => ({ deliveryUncertain: true as const, runId: 'client-uncertain' }) },
    () => ({
      addMessage(message) { messages.set(message.id, message); },
      updateMessage(_sessionKey, id, patch) {
        const current = messages.get(id);
        if (current) messages.set(id, { ...current, ...patch });
      },
      setIsTyping(value) { typing.push(value); },
      typingBySession: {},
      enqueueMessage() {},
    }),
  );

  await coordinator.send({
    sessionKey: 'session-a',
    message: 'maybe delivered',
    clientMessageId: 'client-uncertain',
  });

  assert.equal(messages.get('client-uncertain')?.status, 'pending');
  assert.deepEqual(messages.get('client-uncertain')?.retryPayload, { text: 'maybe delivered' });
  assert.deepEqual(typing, [true]);
});

test('CHAT-02 active sessions forward normal messages to the Gateway queue authority', async () => {
  const messages = new Map<string, ChatMessage>();
  const typing: boolean[] = [];
  const queued: Array<{ sessionKey: string; message: unknown }> = [];
  let transportCalls = 0;
  const coordinator = new ChatSendCoordinator(
    { sendMessage: async () => { transportCalls += 1; return { runId: 'client-2', status: 'started' }; } },
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

  assert.deepEqual(result, { runId: 'client-2', status: 'started' });
  assert.equal(transportCalls, 1);
  assert.equal(messages.get('client-2')?.status, 'sent');
  assert.deepEqual(typing, [true]);
  assert.deepEqual(queued, []);
});

test('普通发送使用当前 Gateway transcript leaf，steer 不伪造该围栏', async () => {
  const identities: Array<Record<string, unknown> | undefined> = [];
  const coordinator = new ChatSendCoordinator(
    {
      sendMessage: async (_message, _attachments, _sessionKey, identity) => {
        identities.push(identity);
        return { runId: identity?.clientMessageId, status: 'started' };
      },
    },
    () => ({
      addMessage() {},
      updateMessage() {},
      setIsTyping() {},
      typingBySession: {},
      enqueueMessage() {},
      sessions: [{ key: 'session-a', activeLeafEntryId: 'leaf-current' }],
    }),
  );

  await coordinator.send({
    sessionKey: 'session-a', message: 'continue', clientMessageId: 'leaf-normal',
  });
  await coordinator.send({
    sessionKey: 'session-a', message: 'redirect', clientMessageId: 'leaf-steer', delivery: 'steer',
  });

  assert.equal(identities[0]?.expectedLeafEntryId, 'leaf-current');
  assert.equal(identities[1]?.expectedLeafEntryId, undefined);
});

test('CHAT-02 local queue remains opt-in while a Gateway run is active', async () => {
  const queued: Array<{ sessionKey: string; message: unknown }> = [];
  let transportCalls = 0;
  const coordinator = new ChatSendCoordinator(
    { sendMessage: async () => { transportCalls += 1; } },
    () => ({
      addMessage() {},
      updateMessage() {},
      setIsTyping() {},
      typingBySession: { 'session-a': true },
      enqueueMessage(sessionKey, message) { queued.push({ sessionKey, message }); },
    }),
  );

  const result = await coordinator.send({
    sessionKey: 'session-a',
    message: 'keep this local',
    clientMessageId: 'client-local-queue',
    queueIfBusy: true,
  });

  assert.deepEqual(result, {
    queued: true,
    queue: 'session',
    clientMessageId: 'client-local-queue',
  });
  assert.equal(transportCalls, 0);
  assert.equal(queued.length, 1);
});

test('native session steering bypasses the visible queue and calls the interrupt-and-steer lane', async () => {
  const messages = new Map<string, ChatMessage>();
  const typing: boolean[] = [];
  const calls: Array<{
    message: string;
    sessionKey: string;
    clientMessageId?: string;
    delivery?: 'send' | 'steer';
  }> = [];
  const queued: unknown[] = [];
  const coordinator = new ChatSendCoordinator(
    {
      sendMessage: async (message, _attachments, sessionKey, identity) => {
        const clientMessageId = identity?.clientMessageId ?? '';
        calls.push({
          message,
          sessionKey: sessionKey ?? '',
          clientMessageId,
          delivery: identity?.delivery,
        });
        return { runId: clientMessageId, status: 'started', interruptedActiveRun: true };
      },
    },
    () => ({
      addMessage(message) { messages.set(message.id, message); },
      updateMessage(_sessionKey, id, patch) {
        const current = messages.get(id);
        if (current) messages.set(id, { ...current, ...patch });
      },
      setIsTyping(value) { typing.push(value); },
      typingBySession: { 'session-a': true },
      enqueueMessage(_sessionKey, message) { queued.push(message); },
    }),
  );

  await coordinator.send({
    sessionKey: 'session-a',
    message: 'focus on the failing Windows path',
    clientMessageId: 'client-steer',
    delivery: 'steer',
    queueIfBusy: false,
  });

  assert.deepEqual(calls, [{
    message: 'focus on the failing Windows path',
    sessionKey: 'session-a',
    clientMessageId: 'client-steer',
    delivery: 'steer',
  }]);
  assert.equal(messages.get('client-steer')?.status, 'sent');
  assert.deepEqual(queued, []);
  assert.deepEqual(typing, [true]);
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
    queueIfBusy: true,
  }), /queue is full/);
  assert.equal(messages.get('client-overflow')?.status, 'failed');
  assert.deepEqual(messages.get('client-overflow')?.retryPayload, { text: 'keep this text' });
});
