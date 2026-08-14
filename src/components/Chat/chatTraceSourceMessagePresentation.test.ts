import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '@/stores/chatStore';
import { normalizeHistoryMessage } from '@/processing/normalizeHistoryMessage';
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
    raw: '{"status":200,"text":"Actual result"}',
    rawIsTruncated: false,
    containsUntrustedExternalContent: false,
  });
});

test('unwraps a nested content block into its structured tool result', () => {
  const result = resolveTraceSourceRecordContent(message({
    role: 'toolResult',
    toolOutput: '[{"type":"text","text":"{\\"status\\":200,\\"text\\":\\"Actual result\\"}","note":"plain text"}]',
  }));

  assert.deepEqual(result?.structured, { status: 200, text: 'Actual result' });
});

test('decodes an escaped transcript content array without rewriting ordinary text', () => {
  const result = resolveTraceSourceRecordContent(message({
    role: 'toolResult',
    toolOutput: '[{\\"type\\":\\"text\\",\\"text\\":\\"{\\\\\\"status\\\\\\":200,\\\\\\"text\\\\\\":\\\\\\"Actual result\\\\\\"}\\"}]',
  }));

  assert.deepEqual(result?.structured, { status: 200, text: 'Actual result' });
});

test('keeps the original structured value for a source record and detects untrusted external content', () => {
  const sourceValue = [{
    type: 'text',
    text: JSON.stringify({
      url: 'https://example.invalid/weather',
      status: 200,
      externalContent: { untrusted: true, source: 'web_fetch' },
      text: 'External data',
    }),
  }];
  const result = resolveTraceSourceRecordContent(message({
    role: 'toolResult',
    toolOutput: 'stale display projection',
    toolOutputValue: sourceValue,
  }));

  assert.deepEqual(result?.structured, {
    url: 'https://example.invalid/weather',
    status: 200,
    externalContent: { untrusted: true, source: 'web_fetch' },
    text: 'External data',
  });
  assert.equal(result?.containsUntrustedExternalContent, true);
  assert.equal(result?.raw, JSON.stringify(sourceValue, null, 2));
});

test('uses the original OpenClaw content blocks when the compact tool projection is truncated', () => {
  const weather = {
    current_condition: [{ temp_C: '26', humidity: '79' }],
    forecast: Array.from({ length: 80 }, (_, index) => ({ hour: index, weatherCode: '113' })),
  };
  const payload = {
    url: 'https://example.invalid/weather',
    status: 200,
    externalContent: { untrusted: true, source: 'runtime-tool' },
    text: [
      'SECURITY NOTICE: External data.',
      '<<<EXTERNAL_UNTRUSTED_CONTENT id="fixture">>>',
      'Source: Runtime Tool',
      '---',
      JSON.stringify(weather),
      '<<<END_EXTERNAL_UNTRUSTED_CONTENT id="fixture">>>',
    ].join('\n'),
  };
  const normalized = normalizeHistoryMessage({
    role: 'toolResult',
    toolName: 'runtime_tool',
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  });

  assert.equal(normalized.toolOutputTruncated, true);
  assert.equal(typeof normalized.toolOutputValue, 'string');
  const result = resolveTraceSourceRecordContent(normalized);
  assert.deepEqual(result?.structured, {
    url: 'https://example.invalid/weather',
    status: 200,
    externalContent: { untrusted: true, source: 'runtime-tool' },
    text: weather,
  });
  assert.equal(result?.containsUntrustedExternalContent, true);
  assert.match(result?.raw ?? '', /"type": "text"/);
});

test('formats a delimited external JSON body while keeping transport metadata', () => {
  const body = { current_condition: [{ temp_C: '33', humidity: '51' }] };
  const result = resolveTraceSourceRecordContent(message({
    role: 'toolResult',
    toolOutputValue: {
      url: 'https://example.invalid/weather',
      status: 200,
      externalContent: { untrusted: true, source: 'web_fetch' },
      text: [
        'SECURITY NOTICE: External data.',
        '<<<EXTERNAL_UNTRUSTED_CONTENT id="fixture">>>',
        'Source: Web Fetch',
        '---',
        JSON.stringify(body),
        '<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>',
      ].join('\n'),
    },
  }));

  assert.deepEqual(result?.structured, {
    url: 'https://example.invalid/weather',
    status: 200,
    externalContent: { untrusted: true, source: 'web_fetch' },
    text: body,
  });
  assert.match(result?.raw ?? '', /SECURITY NOTICE/);
});

test('keeps an incomplete external body readable when the upstream result is truncated', () => {
  const result = resolveTraceSourceRecordContent(message({
    role: 'toolResult',
    toolOutputTruncated: true,
    toolOutputValue: {
      externalContent: { untrusted: true },
      text: [
        '<<<EXTERNAL_UNTRUSTED_CONTENT id="fixture">>>',
        'Source: Web Fetch',
        '---',
        '{"partial": true',
      ].join('\n'),
    },
  }));

  assert.deepEqual(result?.structured, {
    externalContent: { untrusted: true },
    text: '{"partial": true',
  });
  assert.equal(result?.rawIsTruncated, true);
});

test('projects data from an unknown content block type without a tool-specific adapter', () => {
  const result = resolveTraceSourceRecordContent(message({
    role: 'toolResult',
    toolOutputValue: [{
      type: 'plugin_extension_result',
      payload: { version: 2, entries: ['first', 'second'] },
    }],
  }));

  assert.deepEqual(result?.structured, { version: 2, entries: ['first', 'second'] });
});

test('preserves an unknown content block without a conventional result field', () => {
  const result = resolveTraceSourceRecordContent(message({
    role: 'toolResult',
    toolOutputValue: [{ type: 'plugin_extension_notice', severity: 'info', detail: 'Available' }],
  }));

  assert.deepEqual(result?.structured, { type: 'plugin_extension_notice', severity: 'info', detail: 'Available' });
});

test('leaves malformed serialized content as text instead of guessing a repair', () => {
  const malformed = '[{\\"type\\":\\"text\\", this is not JSON]';
  const result = resolveTraceSourceRecordContent(message({ role: 'toolResult', toolOutput: malformed }));

  assert.equal(result?.structured, null);
  assert.equal(result?.text, malformed);
  assert.equal(result?.raw, malformed);
});

test('keeps ordinary messages in the markdown presentation path', () => {
  assert.deepEqual(resolveTraceSourceRecordContent(message({ content: 'Gateway response.' })), {
    kind: 'markdown',
    text: 'Gateway response.',
    structured: null,
    raw: null,
    rawIsTruncated: false,
    containsUntrustedExternalContent: false,
  });
});

test('does not claim content exists when the loaded record has no displayable fields', () => {
  assert.equal(resolveTraceSourceRecordContent(message({ role: 'tool', content: '  ' })), null);
});
