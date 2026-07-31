import assert from 'node:assert/strict';
import test from 'node:test';
import type { MessageBlock } from '@/types/RenderBlock';
import { createChatMessagePreview } from './chatMessagePreview';

function message(overrides: Partial<MessageBlock> = {}): MessageBlock {
  return {
    type: 'message',
    id: 'message-1',
    timestamp: '2026-07-30T00:00:00.000Z',
    isStreaming: false,
    role: 'assistant',
    markdown: '# Result',
    artifacts: [],
    images: [],
    ...overrides,
  };
}

test('creates a preview for a completed assistant message', () => {
  assert.deepEqual(createChatMessagePreview(message()), {
    messageId: 'message-1',
    markdown: '# Result',
  });
});
test('does not preview user, streaming, or empty messages', () => {
  assert.equal(createChatMessagePreview(message({ role: 'user' })), null);
  assert.equal(createChatMessagePreview(message({ isStreaming: true })), null);
  assert.equal(createChatMessagePreview(message({ markdown: '  ' })), null);
});
