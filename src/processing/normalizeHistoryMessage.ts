// Normalize raw gateway history messages into the ChatMessage shape used by
// the rest of the app. Extracted from the initial `loadHistory` call in
// ChatView so both the WebSocket initial-load path and the HTTP older-page
// path apply identical field coercion.
import type { ChatMessage } from '@/stores/chatStore';
import type { FileRef, DecisionOption, WorkshopEvent, SessionEvent } from '@/types/RenderBlock';

/** Loose input shape — the gateway may emit slightly different keys across versions. */
export interface RawGatewayMessage {
  id?: string;
  messageId?: string;
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
  const id = raw.id || raw.messageId || `hist-${cryptoRandomId()}`;
  const responseState: ChatMessage['responseState'] =
    raw.state === 'error' || raw.state === 'aborted' ? raw.state : 'final';

  return {
    id,
    runId: raw.runId ?? raw.run_id ?? null,
    role: (raw.role as ChatMessage['role']) ?? 'unknown',
    content: (raw.content as string) ?? '',
    timestamp: raw.timestamp || raw.createdAt || new Date().toISOString(),
    responseState,
    mediaUrl: raw.mediaUrl || undefined,
    mediaType: raw.mediaType || undefined,
    attachments: raw.attachments,
    toolName: raw.toolName || raw.name,
    toolInput: raw.toolInput || raw.input,
    thinkingContent: raw.thinkingContent,
    fileRefs: Array.isArray(raw.fileRefs) ? raw.fileRefs : undefined,
    decisionOptions: Array.isArray(raw.decisionOptions) ? raw.decisionOptions : undefined,
    workshopEvents: Array.isArray(raw.workshopEvents) ? raw.workshopEvents : undefined,
    sessionEvents: Array.isArray(raw.sessionEvents) ? raw.sessionEvents : undefined,
    usage: raw.usage && typeof raw.usage === 'object' ? raw.usage : undefined,
    model: raw.model ?? null,
  };
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

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
