import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '@/stores/chatStore';
import {
  ChatSendCoordinator,
  ChatSessionMutationInProgressError,
} from './sendTransaction';
import { sessionMutationGate } from './sessionMutationGate';
import { OpenClawSessionTargetError } from '@/services/gateway/OpenClawSessionTarget';

test('空会话目标会在写入本地状态和 Gateway 请求前失败', async () => {
  let stateReads = 0;
  let gatewayCalls = 0;
  const coordinator = new ChatSendCoordinator(
    { sendMessage: async () => { gatewayCalls += 1; } },
    () => {
      stateReads += 1;
      return {
        addMessage() {},
        updateMessage() {},
        setIsTyping() {},
        typingBySession: {},
      };
    },
  );

  await assert.rejects(
    coordinator.send({ sessionKey: '   ', message: '不能发送', clientMessageId: 'empty-session' }),
    OpenClawSessionTargetError,
  );
  assert.equal(stateReads, 0);
  assert.equal(gatewayCalls, 0);
});

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
      typingBySession: {},
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

test('CHAT-02 活跃会话的普通消息交给 Gateway', async () => {
  const messages = new Map<string, ChatMessage>();
  const typing: boolean[] = [];
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
  assert.equal('queueMode' in (identities[0] ?? {}), false);
  assert.equal(identities[1]?.expectedLeafEntryId, undefined);
});

test('已确认空 transcript 的首发传递 null leaf，并在 Gateway 受理后失效本地事实', async () => {
  const identities: Array<Record<string, unknown> | undefined> = [];
  const invalidatedLeaves: Array<string | null | undefined> = [];
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
      setSessionActiveLeafEntryId(_sessionKey, activeLeafEntryId) {
        invalidatedLeaves.push(activeLeafEntryId);
      },
      typingBySession: {},
      sessions: [{ key: 'session-a', activeLeafEntryId: null }],
    }),
  );

  await coordinator.send({
    sessionKey: 'session-a', message: 'start', clientMessageId: 'empty-leaf',
  });

  assert.equal(identities[0]?.expectedLeafEntryId, null);
  assert.deepEqual(invalidatedLeaves, [undefined]);
});

test('原生会话转向使用中断并转向通道', async () => {
  const messages = new Map<string, ChatMessage>();
  const typing: boolean[] = [];
  const calls: Array<{
    message: string;
    sessionKey: string;
    clientMessageId?: string;
    delivery?: 'send' | 'steer';
  }> = [];
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
    }),
  );

  await coordinator.send({
    sessionKey: 'session-a',
    message: 'focus on the failing Windows path',
    clientMessageId: 'client-steer',
    delivery: 'steer',
  });

  assert.deepEqual(calls, [{
    message: 'focus on the failing Windows path',
    sessionKey: 'session-a',
    clientMessageId: 'client-steer',
    delivery: 'steer',
  }]);
  assert.equal(messages.get('client-steer')?.status, 'sent');
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

test('会话变更期间拒绝发送，不创建本地消息队列', async () => {
  let releaseMutation!: () => void;
  const mutation = sessionMutationGate.run(
    'session-a',
    () => new Promise<void>((resolve) => { releaseMutation = resolve; }),
  );
  const coordinator = new ChatSendCoordinator(
    { sendMessage: async () => { throw new Error('Gateway must not receive this message'); } },
    () => ({
      addMessage() {},
      updateMessage() {},
      setIsTyping() {},
      typingBySession: {},
    }),
  );

  try {
    await assert.rejects(coordinator.send({
      sessionKey: 'session-a',
      message: 'retry after reset',
      clientMessageId: 'client-held',
    }), ChatSessionMutationInProgressError);
  } finally {
    releaseMutation();
    await mutation;
  }
});

test('已准入发送完成前会话变更等待，后续发送被原子拒绝', async () => {
  const sessionKey = 'session-send-mutation-order';
  let releaseGateway!: () => void;
  let gatewayStarted = false;
  let mutationStarted = false;
  const coordinator = new ChatSendCoordinator(
    {
      sendMessage: async () => {
        gatewayStarted = true;
        await new Promise<void>((resolve) => { releaseGateway = resolve; });
        return { runId: 'first-send', status: 'started' };
      },
    },
    () => ({
      addMessage() {},
      updateMessage() {},
      setIsTyping() {},
      typingBySession: {},
    }),
  );

  const firstSend = coordinator.send({
    sessionKey,
    message: 'first',
    clientMessageId: 'first-send',
  });
  await Promise.resolve();
  assert.equal(gatewayStarted, true);

  const mutation = sessionMutationGate.run(sessionKey, async () => {
    mutationStarted = true;
  });
  await assert.rejects(
    coordinator.send({ sessionKey, message: 'second', clientMessageId: 'second-send' }),
    ChatSessionMutationInProgressError,
  );
  assert.equal(mutationStarted, false);

  releaseGateway();
  await firstSend;
  await mutation;
  assert.equal(mutationStarted, true);
});
