import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '@/stores/chatStore';
import { resolveTraceSourceRecordContent } from './chatTraceSourceMessagePresentation';

function message(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'source-record',
    role: 'assistant',
    content: '',
    timestamp: '2026-07-31T06:52:22.031Z',
    ...partial,
  };
}

test('prefers the normalized tool output over raw transport content', () => {
  const result = resolveTraceSourceRecordContent(message({
    role: 'toolResult',
    content: '{"transport":"envelope"}',
    toolOutput: '{"status":200,"text":"Actual result"}',
  }));

  assert.deepEqual(result, {
    kind: 'tool-output',
    text: '{"status":200,"text":"Actual result"}',
    structured: { status: 200, text: 'Actual result' },
  });
});

test('decodes nested JSON result strings without altering ordinary text fields', () => {
  const result = resolveTraceSourceRecordContent(message({
    role: 'toolResult',
    toolOutput: '[{"type":"text","text":"{\\"status\\":200,\\"text\\":\\"Actual result\\"}","note":"plain text"}]',
  }));

  assert.deepEqual(result?.structured, [{
    type: 'text',
    text: { status: 200, text: 'Actual result' },
    note: 'plain text',
  }]);
});

test('keeps ordinary messages in the markdown presentation path', () => {
  assert.deepEqual(resolveTraceSourceRecordContent(message({ content: 'Gateway response.' })), {
    kind: 'markdown',
    text: 'Gateway response.',
    structured: null,
  });
});

test('does not claim content exists when the loaded record has no displayable fields', () => {
  assert.equal(resolveTraceSourceRecordContent(message({ role: 'tool', content: '  ' })), null);
});
