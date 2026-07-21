import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeCachedChatMessageContent,
  normalizeHistoryMessage,
} from './normalizeHistoryMessage';
import { normalizeGatewayMessage } from './normalizeGatewayMessage';

test('normalizes canonical OpenClaw identity and rich history metadata', () => {
  const message = normalizeHistoryMessage({
    id: 'legacy-wrapper-id',
    __openclaw: { id: 'native-message-1' },
    idempotencyKey: 'client-message-1',
    role: 'tool',
    content: 'done',
    timestamp: '2026-07-17T10:00:00.000Z',
    toolName: 'review',
    toolOutput: { ok: true },
    toolStatus: 'done',
    duration_ms: '42',
    tool_call_id: 'tool-call-1',
  });

  assert.equal(message.id, 'native-message-1');
  assert.equal(message.nativeMessageId, 'native-message-1');
  assert.equal(message.clientMessageId, 'client-message-1');
  assert.equal(message.toolOutput, '{"ok":true}');
  assert.equal(message.toolDurationMs, 42);
  assert.equal(message.toolCallId, 'tool-call-1');
});

test('CHAT-11 preserves OpenClaw sequence and truncation metadata', () => {
  const message = normalizeHistoryMessage({
    role: 'assistant',
    content: 'truncated',
    __openclaw: {
      id: 'native-truncated-1',
      seq: 42,
      truncated: true,
      reason: 'message_too_large',
    },
  });
  assert.equal(message.nativeSequence, 42);
  assert.equal(message.historyTruncated, true);
  assert.equal(message.historyTruncationReason, 'message_too_large');
});

test('normalizes real OpenClaw text blocks without discarding structured content', () => {
  const content = [
    { type: 'thinking', thinking: 'private reasoning' },
    { type: 'text', text: 'visible answer' },
    { type: 'tool_use', name: 'inspect', input: { target: 'workflow' } },
  ];
  const message = normalizeHistoryMessage({
    __openclaw: { id: 'native-message-blocks' },
    role: 'assistant',
    content,
  });

  assert.equal(message.content, 'visible answer');
  assert.equal(message.rawContent, content);
  assert.equal(message.content.trim(), 'visible answer');

  const normalized = normalizeGatewayMessage(message);
  assert.equal(normalized.text, 'visible answer');
  assert.equal(normalized.thinkingContent, 'private reasoning');
  assert.deepEqual(normalized.toolCalls, [{ name: 'inspect', input: { target: 'workflow' } }]);
});

test('upgrades cached block content before chat consumers call string methods', () => {
  const legacy = {
    id: 'cached-message-blocks',
    role: 'user',
    content: [{ type: 'text', text: 'cached question' }],
    timestamp: '2026-07-17T10:00:00.000Z',
  } as unknown as Parameters<typeof normalizeCachedChatMessageContent>[0];

  const upgraded = normalizeCachedChatMessageContent(legacy);
  assert.equal(upgraded.content.trim(), 'cached question');
  assert.deepEqual(upgraded.rawContent, legacy.content);
});
