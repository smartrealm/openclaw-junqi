import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '@/stores/chatStore';
import { findNewUserMessage, hasAssistantResponseAfter } from './completion';

const message = (id: string, role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role,
  content,
  timestamp: '2026-08-14T00:00:00.000Z',
  ...extra,
});

test('failed optimistic messages do not complete the send step', () => {
  const messages = [
    message('old', 'user', '旧消息'),
    message('failed', 'user', '发送失败', { status: 'failed' }),
  ];
  assert.equal(findNewUserMessage(messages, new Set(['old'])), null);
});

test('only a non-failed assistant message after the guided user message completes the guide', () => {
  const messages = [
    message('before', 'assistant', '旧回复'),
    message('guided', 'user', '你好'),
    message('error', 'assistant', '请求失败', { responseState: 'error' }),
  ];
  assert.equal(hasAssistantResponseAfter(messages, 'guided'), false);
  assert.equal(
    hasAssistantResponseAfter([...messages, message('answer', 'assistant', '你好，我在。')], 'guided'),
    true,
  );
});
