// Normalize raw gateway history messages into the ChatMessage shape used by
// the rest of the app. Extracted from the initial `loadHistory` call in
// ChatView so both the WebSocket initial-load path and the HTTP older-page
// path apply identical field coercion.
import type { ChatMessage } from '@/stores/chatStore';
import type { FileRef, DecisionOption, WorkshopEvent, SessionEvent } from '@/types/RenderBlock';
import { readGatewayMessageIdentity } from '@/services/gateway/messageIdentity';
import { extractGatewayMessageText } from './normalizeGatewayMessage';

/** Loose input shape — the gateway may emit slightly different keys across versions. */
export interface RawGatewayMessage {
  id?: string;
  messageId?: string;
  clientMessageId?: string;
  idempotencyKey?: string;
  __openclaw?: {
    id?: unknown;
    clientMessageId?: unknown;
    idempotencyKey?: unknown;
    seq?: unknown;
    truncated?: unknown;
    reason?: unknown;
  };
  runId?: string | null;
  run_id?: string | null;
  role?: string;
  content?: unknown;
  timestamp?: string;
  createdAt?: string;
  state?: string;
  mediaUrl?: string;
  mediaType?: string;
  attachments?: ChatMessage['attachments'];
  toolName?: string;
  name?: string;
  toolInput?: Record<string, unknown>;
  input?: Record<string, unknown>;
  toolOutput?: unknown;
  output?: unknown;
  result?: unknown;
  toolStatus?: ChatMessage['toolStatus'];
  status?: ChatMessage['toolStatus'];
  toolDurationMs?: number | string;
  durationMs?: number | string;
  duration_ms?: number | string;
  tool_duration_ms?: number | string;
  toolCallId?: string;
  tool_call_id?: string;
  thinkingContent?: string;
  fileRefs?: FileRef[];
  decisionOptions?: DecisionOption[];
  workshopEvents?: WorkshopEvent[];
  sessionEvents?: SessionEvent[];
  usage?: Record<string, number>;
  model?: string | null;
}

/**
 * Coerce a raw gateway message into the ChatMessage shape used downstream.
 */
export function normalizeHistoryMessage(raw: RawGatewayMessage): ChatMessage {
  const identity = readGatewayMessageIdentity(raw);
  const metadata = raw.__openclaw;
  const id = identity.nativeMessageId || `hist-${cryptoRandomId()}`;
  const responseState: ChatMessage['responseState'] =
    raw.state === 'error' || raw.state === 'aborted' ? raw.state : 'final';

  return {
    id,
    ...identity,
    runId: raw.runId ?? raw.run_id ?? null,
    role: (raw.role as ChatMessage['role']) ?? 'unknown',
    content: extractGatewayMessageText(raw.content),
    ...(Array.isArray(raw.content) ? { rawContent: raw.content } : {}),
    timestamp: raw.timestamp || raw.createdAt || new Date().toISOString(),
    responseState,
    mediaUrl: raw.mediaUrl || undefined,
    mediaType: raw.mediaType || undefined,
    attachments: raw.attachments,
    toolName: raw.toolName || raw.name,
    toolInput: raw.toolInput || raw.input,
    toolOutput: textValue(raw.toolOutput ?? raw.output ?? raw.result),
    toolStatus: raw.toolStatus || raw.status,
    toolDurationMs: numberValue(
      raw.toolDurationMs ?? raw.durationMs ?? raw.duration_ms ?? raw.tool_duration_ms,
    ),
    toolCallId: raw.toolCallId || raw.tool_call_id,
    thinkingContent: raw.thinkingContent,
    fileRefs: Array.isArray(raw.fileRefs) ? raw.fileRefs : undefined,
    decisionOptions: Array.isArray(raw.decisionOptions) ? raw.decisionOptions : undefined,
    workshopEvents: Array.isArray(raw.workshopEvents) ? raw.workshopEvents : undefined,
    sessionEvents: Array.isArray(raw.sessionEvents) ? raw.sessionEvents : undefined,
    usage: raw.usage && typeof raw.usage === 'object' ? raw.usage : undefined,
    model: raw.model ?? null,
    nativeSequence: positiveInteger(metadata?.seq),
    historyTruncated: metadata?.truncated === true || undefined,
    historyTruncationReason: typeof metadata?.reason === 'string' ? metadata.reason : undefined,
  };
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value == null) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Batch normalize; preserves input order. */
export function normalizeHistoryMessages(rawList: readonly unknown[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const raw of rawList) {
    if (raw && typeof raw === 'object') {
      out.push(normalizeHistoryMessage(raw as RawGatewayMessage));
    }
  }
  return out;
}

/** Upgrade cached messages written before ChatMessage.content became string-only. */
export function normalizeCachedChatMessageContent(message: ChatMessage): ChatMessage {
  const rawContent = (message as ChatMessage & { content: unknown }).content;
  if (typeof rawContent === 'string') return message;
  return {
    ...message,
    content: extractGatewayMessageText(rawContent),
    rawContent,
  };
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
