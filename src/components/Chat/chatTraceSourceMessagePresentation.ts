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

function parseStructuredContent(text: string): unknown | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' ? value : null;
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
