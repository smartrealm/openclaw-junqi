import type { ChatMessage } from '@/stores/chatStore';

export interface TraceSourceRecordContent {
  readonly kind: 'markdown' | 'tool-output';
  readonly text: string;
  readonly structured: unknown | null;
}

function nonEmptyText(value: string | undefined): string | null {
  const text = value?.trim();
  return text || null;
}

const MAX_STRUCTURED_DECODE_DEPTH = 6;

function decodeNestedStructuredValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_STRUCTURED_DECODE_DEPTH) return value;

  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === 'object'
        ? decodeNestedStructuredValue(parsed, depth + 1)
        : value;
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => decodeNestedStructuredValue(item, depth + 1));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, decodeNestedStructuredValue(item, depth + 1)]),
    );
  }

  return value;
}

function parseStructuredContent(text: string): unknown | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object'
      ? decodeNestedStructuredValue(value)
      : null;
  } catch {
    return null;
  }
}

/**
 * Tool records have a normalized output projection. Prefer it over the raw
 * transcript text so transport envelopes never become the user-facing result.
 */
export function resolveTraceSourceRecordContent(
  message: ChatMessage | undefined,
): TraceSourceRecordContent | null {
  if (!message) return null;

  const isToolRecord = message.role === 'tool' || message.role === 'toolResult';
  if (isToolRecord) {
    const output = nonEmptyText(message.toolOutput) ?? nonEmptyText(message.content);
    if (!output) return null;
    return {
      kind: 'tool-output',
      text: output,
      structured: parseStructuredContent(output),
    };
  }

  const text = nonEmptyText(message.content) ?? nonEmptyText(message.thinkingContent);
  return text ? { kind: 'markdown', text, structured: null } : null;
}
