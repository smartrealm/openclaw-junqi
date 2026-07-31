export type ToolExecutionStatus = 'running' | 'done' | 'error';

export interface ToolOutputProjection {
  text: string;
  truncated: boolean;
  originalLength: number;
}

export interface ToolOutputProjectionOptions {
  maxLength?: number;
  truncated?: unknown;
  originalLength?: unknown;
}

export interface GatewayToolLifecycleEvent {
  sessionKey?: string;
  runId?: string;
  sourceSequence?: number;
  timestamp: string;
  phase: 'start' | 'update' | 'result';
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
  output?: unknown;
  status: ToolExecutionStatus;
  isError: boolean;
  error?: string;
  durationMs?: number;
}

export type GatewayToolEventSource = 'tool' | 'item';

export const TOOL_OUTPUT_DISPLAY_LIMIT = 2_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function nonNegativeSafeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function timestampIso(value: number): string | undefined {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

/** Convert the Gateway's ISO or epoch-millisecond timestamps to one UI contract. */
export function normalizeGatewayTimestamp(value: unknown, fallback = new Date().toISOString()): string {
  const numeric = finiteNumber(value);
  if (numeric !== undefined) return timestampIso(numeric) ?? fallback;

  if (typeof value !== 'string' || !value.trim()) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

export function normalizeToolExecutionStatus(
  value: unknown,
  isError: unknown = false,
): ToolExecutionStatus | undefined {
  if (isError === true) return 'error';
  if (typeof value !== 'string') return undefined;
  switch (value.trim().toLowerCase()) {
    case 'running':
    case 'start':
    case 'update':
      return 'running';
    case 'done':
    case 'success':
    case 'completed':
    case 'complete':
      return 'done';
    case 'error':
    case 'failed':
    case 'failure':
    case 'blocked':
      return 'error';
    default:
      return undefined;
  }
}

function serializeToolError(value: unknown, seen: WeakSet<object>): string | undefined {
  const text = nonEmptyText(value);
  if (text) return text;
  if (value instanceof Error) return nonEmptyText(value.message) ?? value.name;
  const record = asRecord(value);
  if (!record || seen.has(record)) return undefined;
  seen.add(record);
  for (const key of ['toolErrorSummary', 'error', 'message', 'reason'] as const) {
    const nested = serializeToolError(record[key], seen);
    if (nested) return nested;
  }
  return undefined;
}

/** Preserve a Gateway-provided tool error without inferring errors from ordinary output. */
export function extractToolExecutionError(value: unknown): string | undefined {
  return serializeToolError(value, new WeakSet<object>());
}

function toolOutputReplacer() {
  const seen = new WeakSet<object>();
  return (_key: string, value: unknown): unknown => {
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Error) {
      return { name: value.name, message: value.message };
    }
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}

/** Serialize structured tool results before they cross the string-only chat surface. */
export function serializeToolOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value === null) return 'null';
  if (value === undefined) return '';
  try {
    const serialized = JSON.stringify(value, toolOutputReplacer());
    if (typeof serialized === 'string') return serialized;
  } catch {
    // Fall through to a conservative string representation below.
  }
  try {
    return String(value);
  } catch {
    return '';
  }
}

/** Apply a bounded display projection while retaining the fact and size of truncation. */
export function projectToolOutput(
  value: unknown,
  options: ToolOutputProjectionOptions = {},
): ToolOutputProjection | undefined {
  if (value === undefined) return undefined;
  const maxLength = options.maxLength ?? TOOL_OUTPUT_DISPLAY_LIMIT;
  const text = serializeToolOutput(value);
  const reportedLength = finiteNumber(options.originalLength);
  const originalLength = reportedLength !== undefined && reportedLength >= text.length
    ? Math.floor(reportedLength)
    : text.length;
  const locallyTruncated = text.length > maxLength;
  return {
    text: locallyTruncated ? text.slice(0, maxLength) : text,
    truncated: options.truncated === true || locallyTruncated,
    originalLength,
  };
}

function itemToolCallId(data: Record<string, unknown>): string | undefined {
  const direct = nonEmptyText(data.toolCallId);
  if (direct) return direct;
  const itemId = nonEmptyText(data.itemId);
  return itemId?.startsWith('tool:') ? itemId.slice('tool:'.length).trim() || undefined : undefined;
}

function toolPhase(value: unknown): GatewayToolLifecycleEvent['phase'] | undefined {
  if (value === 'start' || value === 'update' || value === 'result') return value;
  return undefined;
}

function itemPhase(value: unknown): GatewayToolLifecycleEvent['phase'] | undefined {
  if (value === 'start' || value === 'update') return value;
  return value === 'end' ? 'result' : undefined;
}

function eventOutput(
  data: Record<string, unknown>,
  phase: GatewayToolLifecycleEvent['phase'],
): unknown {
  if (phase === 'update') {
    if (Object.prototype.hasOwnProperty.call(data, 'partialResult')) return data.partialResult;
    if (Object.prototype.hasOwnProperty.call(data, 'output')) return data.output;
    return data.progressText;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'result')) return data.result;
  if (Object.prototype.hasOwnProperty.call(data, 'output')) return data.output;
  return data.summary;
}

function eventDuration(data: Record<string, unknown>): number | undefined {
  const explicit = finiteNumber(data.durationMs ?? data.duration_ms);
  if (explicit !== undefined && explicit >= 0) return explicit;
  const startedAt = finiteNumber(data.startedAt);
  const endedAt = finiteNumber(data.endedAt);
  return startedAt !== undefined && endedAt !== undefined && endedAt >= startedAt
    ? endedAt - startedAt
    : undefined;
}

/**
 * The only adapter from Gateway tool/item payloads to the chat tool lifecycle.
 * All consumers receive one status, timestamp, error and output contract.
 */
export function normalizeGatewayToolLifecycleEvent(
  payload: unknown,
  source: GatewayToolEventSource = 'tool',
): GatewayToolLifecycleEvent | null {
  const envelope = asRecord(payload);
  const data = envelope ? asRecord(envelope.data) : null;
  if (!envelope || !data) return null;

  const phase = source === 'tool' ? toolPhase(data.phase) : itemPhase(data.phase);
  if (!phase || (source === 'item' && data.kind !== 'tool')) return null;

  const toolCallId = source === 'tool' ? nonEmptyText(data.toolCallId) : itemToolCallId(data);
  if (!toolCallId) return null;

  const upstreamStatus = normalizeToolExecutionStatus(data.status, data.isError);
  const isError = data.isError === true || upstreamStatus === 'error';
  const status = phase === 'result'
    ? (upstreamStatus ?? (isError ? 'error' : 'done'))
    : (upstreamStatus === 'error' ? 'error' : 'running');
  const explicitError = extractToolExecutionError(data.toolErrorSummary ?? data.error);
  const resultError = isError ? extractToolExecutionError(data.result ?? data.output) : undefined;
  const timestampValue = source === 'item'
    ? data.endedAt ?? data.startedAt ?? envelope.ts
    : envelope.ts;
  const input = source === 'tool'
    ? asRecord(data.args) ?? undefined
    : asRecord(data.toolArgs) ?? asRecord(data.args) ?? asRecord(data.input) ?? undefined;
  const durationMs = eventDuration(data);

  return {
    sessionKey: nonEmptyText(envelope.sessionKey),
    runId: nonEmptyText(envelope.runId),
    sourceSequence: nonNegativeSafeInteger(envelope.seq),
    timestamp: normalizeGatewayTimestamp(timestampValue),
    phase,
    toolCallId,
    toolName: nonEmptyText(data.name) ?? nonEmptyText(data.title)?.split(/\s+/)[0] ?? 'tool',
    ...(input ? { input } : {}),
    ...(phase === 'start' ? {} : { output: eventOutput(data, phase) }),
    status,
    isError,
    ...(explicitError ?? resultError ? { error: explicitError ?? resultError } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}
