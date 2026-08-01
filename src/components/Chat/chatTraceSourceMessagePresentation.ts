import type { ChatMessage } from '@/stores/chatStore';

export interface TraceSourceRecordContent {
  readonly kind: 'markdown' | 'tool-output';
  readonly text: string;
  readonly structured: unknown | null;
  readonly raw: string | null;
  readonly rawIsTruncated: boolean;
  readonly containsUntrustedExternalContent: boolean;
}

const MAX_STRUCTURED_INPUT_LENGTH = 512_000;
const MAX_STRUCTURED_DECODE_DEPTH = 6;
const MAX_STRUCTURED_NODE_COUNT = 2_000;
const EXTERNAL_CONTENT_START = /<<<EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/;
const EXTERNAL_CONTENT_END = /<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>/;

function nonEmptyText(value: string | undefined): string | null {
  const text = value?.trim();
  return text || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safelyParseJson(value: string): unknown | null {
  if (value.length > MAX_STRUCTURED_INPUT_LENGTH) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * Some transcript adapters serialize an already serialized JSON document.
 * A decoded value is accepted only when it proves to be a complete object or
 * array; ordinary tool text remains unchanged.
 */
function decodeEscapedJsonDocument(value: string): unknown | null {
  if (!/^\s*[\[{]/.test(value) || !value.includes('\\"') || value.length > MAX_STRUCTURED_INPUT_LENGTH) {
    return null;
  }

  let quoted = '"';
  let precedingBackslashes = 0;
  for (const character of value) {
    if (character === '"') {
      quoted += precedingBackslashes % 2 === 0 ? '\\"' : '"';
      precedingBackslashes = 0;
    } else if (character === '\n') {
      quoted += '\\n';
      precedingBackslashes = 0;
    } else if (character === '\r') {
      quoted += '\\r';
      precedingBackslashes = 0;
    } else if (character === '\t') {
      quoted += '\\t';
      precedingBackslashes = 0;
    } else {
      quoted += character;
      precedingBackslashes = character === '\\' ? precedingBackslashes + 1 : 0;
    }
  }
  quoted += '"';
  return safelyParseJson(quoted);
}

function parseStructuredDocument(value: string, depth = 0): unknown | null {
  if (depth >= MAX_STRUCTURED_DECODE_DEPTH) return null;
  const parsed = safelyParseJson(value) ?? decodeEscapedJsonDocument(value);
  if (parsed === null) return null;
  if (typeof parsed === 'string') return parseStructuredDocument(parsed, depth + 1);
  return parsed !== null && typeof parsed === 'object' ? parsed : null;
}

function decodeNestedStructuredValue(
  value: unknown,
  state: { nodes: number },
  depth = 0,
): unknown {
  if (depth >= MAX_STRUCTURED_DECODE_DEPTH || state.nodes >= MAX_STRUCTURED_NODE_COUNT) return value;
  state.nodes += 1;

  if (typeof value === 'string') {
    const parsed = parseStructuredDocument(value, depth + 1);
    return parsed === null ? value : decodeNestedStructuredValue(parsed, state, depth + 1);
  }
  if (Array.isArray(value)) {
    return value.map((item) => decodeNestedStructuredValue(item, state, depth + 1));
  }
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, decodeNestedStructuredValue(item, state, depth + 1)]),
  );
}

function decodeStructuredValue(value: unknown): unknown | null {
  if (typeof value === 'string') {
    const parsed = parseStructuredDocument(value);
    return parsed === null ? null : decodeNestedStructuredValue(parsed, { nodes: 0 });
  }
  if (value === null || typeof value !== 'object') return null;
  return decodeNestedStructuredValue(value, { nodes: 0 });
}

const CONTENT_BLOCK_VALUE_KEYS = ['result', 'output', 'content', 'text', 'data', 'payload', 'value'] as const;

function contentBlockValue(value: unknown): unknown | undefined {
  const record = asRecord(value);
  if (!record || typeof record.type !== 'string') return undefined;

  for (const key of CONTENT_BLOCK_VALUE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }

  // The Gateway and plugins may introduce new block types. Preserve an
  // unknown block as structured data rather than discarding it by type name.
  return record;
}

function unwrapContentBlocks(value: unknown): unknown {
  if (!Array.isArray(value) || value.length === 0) return value;
  const parts = value.map(contentBlockValue);
  if (parts.some((part) => part === undefined)) return value;
  return parts.length === 1 ? parts[0] : parts;
}

/**
 * The Gateway marks external tool text with a delimited data envelope. The
 * readable projection removes only that transport wrapper; the untouched
 * envelope remains available through the raw-payload disclosure.
 */
function unwrapExternalContentEnvelope(value: string): unknown | null {
  const start = value.match(EXTERNAL_CONTENT_START);
  if (!start || start.index === undefined) return null;
  const afterStart = start.index + start[0].length;
  const endMatch = value.slice(afterStart).match(EXTERNAL_CONTENT_END);
  const wrapped = endMatch?.index === undefined
    ? value.slice(afterStart)
    : value.slice(afterStart, afterStart + endMatch.index);
  const divider = wrapped.match(/(?:^|\r?\n)---\r?\n/);
  if (!divider || divider.index === undefined) return null;
  const body = wrapped.slice(divider.index + divider[0].length).trim();
  if (!body) return '';
  return decodeStructuredValue(body) ?? body;
}

function projectReadableToolValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_STRUCTURED_DECODE_DEPTH) return value;
  if (typeof value === 'string') {
    const externalBody = unwrapExternalContentEnvelope(value);
    return externalBody === null ? value : projectReadableToolValue(externalBody, depth + 1);
  }
  if (Array.isArray(value)) {
    return value.map((item) => projectReadableToolValue(item, depth + 1));
  }
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, projectReadableToolValue(item, depth + 1)]),
  );
}

function containsUntrustedExternalContent(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === 'string' && EXTERNAL_CONTENT_START.test(value)) return true;
  const record = asRecord(value);
  if (record) {
    if (seen.has(record)) return false;
    seen.add(record);
    if (record.untrusted === true) return true;
    return Object.values(record).some((item) => containsUntrustedExternalContent(item, seen));
  }
  return Array.isArray(value) && value.some((item) => containsUntrustedExternalContent(item, seen));
}

function formatRawValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const formatted = JSON.stringify(value, null, 2);
    return typeof formatted === 'string' ? formatted : String(value);
  } catch {
    return String(value);
  }
}

/**
 * Tool records keep their raw payload for evidence, while the primary view
 * projects only recognized structured documents or content blocks.
 */
export function resolveTraceSourceRecordContent(
  message: ChatMessage | undefined,
): TraceSourceRecordContent | null {
  if (!message) return null;

  const isToolRecord = message.role === 'tool' || message.role === 'toolResult';
  if (isToolRecord) {
    const rawValue = message.toolOutputValue ?? message.rawContent ?? message.toolOutput ?? message.content;
    const raw = formatRawValue(rawValue);
    const fallbackText = nonEmptyText(message.toolOutput) ?? nonEmptyText(message.content) ?? raw;
    if (!fallbackText.trim()) return null;

    const decoded = decodeStructuredValue(rawValue);
    const structured = decoded === null
      ? null
      : projectReadableToolValue(unwrapContentBlocks(decoded));
    return {
      kind: 'tool-output',
      text: typeof structured === 'string' ? structured : fallbackText,
      structured: structured !== null && typeof structured === 'object' ? structured : null,
      raw,
      rawIsTruncated: message.toolOutputTruncated === true,
      containsUntrustedExternalContent: containsUntrustedExternalContent(structured ?? decoded ?? rawValue),
    };
  }

  const text = nonEmptyText(message.content) ?? nonEmptyText(message.thinkingContent);
  return text
    ? {
        kind: 'markdown',
        text,
        structured: null,
        raw: null,
        rawIsTruncated: false,
        containsUntrustedExternalContent: false,
      }
    : null;
}
