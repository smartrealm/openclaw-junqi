import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeCachedChatMessageContent,
  normalizeHistoryMessage,
  normalizeHistoryMessages,
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

test('keeps every display projection emitted from one OpenClaw transcript record', () => {
  const messages = normalizeHistoryMessages([
    { role: 'assistant', content: 'Before the tool', __openclaw: { id: 'native-shared', seq: 8 } },
    { role: 'tool', content: 'Tool result', __openclaw: { id: 'native-shared', seq: 8 } },
    { role: 'assistant', content: 'After the tool', __openclaw: { id: 'native-shared', seq: 8 } },
  ]);

  assert.equal(new Set(messages.map((message) => message.id)).size, 3);
  assert.deepEqual(messages.map((message) => message.nativeMessageId), [
    'native-shared',
    'native-shared',
    'native-shared',
  ]);
  assert.deepEqual(messages.map((message) => message.content), [
    'Before the tool',
    'Tool result',
    'After the tool',
  ]);
});

test('restores OpenClaw persisted Media fields with their index-aligned types', () => {
  const message = normalizeHistoryMessage({
    role: 'user',
    content: 'Inspect these files.',
    MediaPaths: [
      'C:\\Users\\Test\\.openclaw\\media\\screen shot.png',
      'C:\\Users\\Test\\.openclaw\\media\\report.pdf',
      'C:\\Users\\Test\\.openclaw\\media\\voice.ogg',
    ],
    MediaTypes: ['image/png', 'application/pdf', 'audio/ogg'],
  });

  assert.deepEqual(message.attachments, [{
    mimeType: 'image/png',
    content: 'aegis-media:C:\\Users\\Test\\.openclaw\\media\\screen shot.png',
    fileName: 'screen shot.png',
  }]);
  assert.deepEqual(message.fileRefs, [{
    path: 'C:\\Users\\Test\\.openclaw\\media\\report.pdf',
    meta: 'application/pdf',
    kind: 'file',
  }]);
  assert.equal(message.mediaUrl, 'aegis-media:C:\\Users\\Test\\.openclaw\\media\\voice.ogg');
  assert.equal(message.mediaType, 'audio/ogg');
  assert.deepEqual(message.outboundAttachments, [
    { fileName: 'screen shot.png', mimeType: 'image/png' },
    { fileName: 'report.pdf', mimeType: 'application/pdf' },
    { fileName: 'voice.ogg', mimeType: 'audio/ogg' },
  ]);
});

test('prefers OpenClaw MediaUrls while preserving sparse Media arrays', () => {
  const message = normalizeHistoryMessage({
    role: 'user',
    content: '',
    MediaPaths: ['ignored-local.png', '', 'local-third.png'],
    MediaUrls: ['https://gateway.invalid/media/image.png', '', 'https://gateway.invalid/media/third.png'],
    MediaTypes: ['image/png', '', 'image/png'],
  });

  assert.deepEqual(message.attachments?.map((item) => item.content), [
    'https://gateway.invalid/media/image.png',
    'https://gateway.invalid/media/third.png',
  ]);
});
