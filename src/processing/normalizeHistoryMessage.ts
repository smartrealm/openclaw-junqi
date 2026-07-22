// Normalize raw gateway history messages into the ChatMessage shape used by
// the rest of the app. Extracted from the initial `loadHistory` call in
// ChatView so both the WebSocket initial-load path and the HTTP older-page
// path apply identical field coercion.
import type { ChatMessage } from '@/stores/chatStore';
import type { FileRef, DecisionOption, WorkshopEvent, SessionEvent } from '@/types/RenderBlock';
import { readGatewayMessageIdentity } from '@/services/gateway/messageIdentity';
import { inferMimeType } from '@/services/chat/attachments';
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
  MediaPath?: string | null;
  MediaPaths?: Array<string | null | undefined> | null;
  MediaUrl?: string | null;
  MediaUrls?: Array<string | null | undefined> | null;
  MediaType?: string | null;
  MediaTypes?: Array<string | null | undefined> | null;
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
  const transcriptMedia = normalizeTranscriptMedia(raw);
  const attachments = mergeDisplayAttachments(raw.attachments, transcriptMedia.filter((item) => item.isImage));
  const audio = transcriptMedia.find((item) => item.mimeType.startsWith('audio/'));
  const durableFileRefs = transcriptMedia
    .filter((item) => !item.isImage && !item.mimeType.startsWith('audio/'))
    .map((item): FileRef => ({ path: item.reference, meta: item.mimeType, kind: 'file' }));
  const fileRefs = mergeFileRefs(raw.fileRefs, durableFileRefs);
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
    mediaUrl: raw.mediaUrl || audio?.source || undefined,
    mediaType: raw.mediaType || audio?.mimeType || undefined,
    attachments,
    outboundAttachments: transcriptMedia.length > 0
      ? transcriptMedia.map((item) => ({ fileName: item.fileName, mimeType: item.mimeType }))
      : undefined,
    toolName: raw.toolName || raw.name,
    toolInput: raw.toolInput || raw.input,
    toolOutput: textValue(raw.toolOutput ?? raw.output ?? raw.result),
    toolStatus: raw.toolStatus || raw.status,
    toolDurationMs: numberValue(
      raw.toolDurationMs ?? raw.durationMs ?? raw.duration_ms ?? raw.tool_duration_ms,
    ),
    toolCallId: raw.toolCallId || raw.tool_call_id,
    thinkingContent: raw.thinkingContent,
    fileRefs,
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

interface TranscriptMediaItem {
  source: string;
  reference: string;
  mimeType: string;
  fileName: string;
  isImage: boolean;
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function alignedMediaValues(
  values: Array<string | null | undefined> | null | undefined,
  single: string | null | undefined,
): Array<string | undefined> {
  const aligned = Array.isArray(values) ? values.map(normalizeOptionalText) : [];
  const first = normalizeOptionalText(single);
  if (first && aligned[0] === undefined) aligned[0] = first;
  return aligned;
}

function mediaSource(pathValue: string | undefined, urlValue: string | undefined): string | null {
  if (urlValue) return urlValue;
  if (!pathValue) return null;
  const isWindowsPath = /^[a-z]:[\\/]/i.test(pathValue);
  return !isWindowsPath && /^[a-z][a-z0-9+.-]*:/i.test(pathValue)
    ? pathValue
    : `aegis-media:${pathValue}`;
}

function fileNameFromMediaSource(source: string, index: number): string {
  const withoutScheme = source.replace(/^aegis-media:/, '').split(/[?#]/, 1)[0];
  const segment = withoutScheme.split(/[/\\]/).filter(Boolean).at(-1);
  if (!segment) return `attachment-${index + 1}`;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Normalize OpenClaw's index-aligned persisted Media* transcript fields. */
function normalizeTranscriptMedia(raw: RawGatewayMessage): TranscriptMediaItem[] {
  const paths = alignedMediaValues(raw.MediaPaths, raw.MediaPath);
  const urls = alignedMediaValues(raw.MediaUrls, raw.MediaUrl);
  const types = alignedMediaValues(raw.MediaTypes, raw.MediaType);
  const count = Math.max(paths.length, urls.length, types.length);
  const items: TranscriptMediaItem[] = [];

  for (let index = 0; index < count; index += 1) {
    const source = mediaSource(paths[index], urls[index]);
    if (!source) continue;
    const fileName = fileNameFromMediaSource(source, index);
    const mimeType = inferMimeType(fileName, types[index]);
    items.push({
      source,
      reference: urls[index] ?? paths[index] ?? source,
      mimeType,
      fileName,
      isImage: mimeType.startsWith('image/'),
    });
  }
  return items;
}

function mergeDisplayAttachments(
  current: ChatMessage['attachments'],
  media: readonly TranscriptMediaItem[],
): ChatMessage['attachments'] {
  const merged = [...(Array.isArray(current) ? current : [])];
  const seen = new Set(merged.map((item) => `${item.mimeType}\u0000${item.content}\u0000${item.fileName}`));
  for (const item of media) {
    const key = `${item.mimeType}\u0000${item.source}\u0000${item.fileName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ mimeType: item.mimeType, content: item.source, fileName: item.fileName });
  }
  return merged.length > 0 ? merged : undefined;
}

function mergeFileRefs(current: FileRef[] | undefined, durable: FileRef[]): FileRef[] | undefined {
  const merged = [...(Array.isArray(current) ? current : [])];
  const seen = new Set(merged.map((item) => item.path));
  for (const item of durable) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    merged.push(item);
  }
  return merged.length > 0 ? merged : undefined;
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
  const nativeCounts = new Map<string, number>();
  for (const message of out) {
    if (message.nativeMessageId) {
      nativeCounts.set(message.nativeMessageId, (nativeCounts.get(message.nativeMessageId) ?? 0) + 1);
    }
  }
  const occurrences = new Map<string, number>();
  return out.map((message) => {
    const nativeId = message.nativeMessageId;
    if (!nativeId || (nativeCounts.get(nativeId) ?? 0) < 2) return message;
    const fingerprint = historyProjectionFingerprint(message);
    const key = `${nativeId}\u0000${fingerprint}`;
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    const projectionId = `${fingerprint}:${occurrence}`;
    return {
      ...message,
      id: `${nativeId}:projection:${projectionId}`,
      nativeProjectionId: projectionId,
    };
  });
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

function historyProjectionFingerprint(message: ChatMessage): string {
  const value = stableProjectionValue({
    role: message.role,
    content: message.content,
    rawContent: message.rawContent,
    mediaUrl: message.mediaUrl,
    mediaType: message.mediaType,
    toolName: message.toolName,
    toolCallId: message.toolCallId,
    toolInput: message.toolInput,
    toolOutput: message.toolOutput,
    thinkingContent: message.thinkingContent,
  });
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function stableProjectionValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(stableProjectionValue).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${key}:${stableProjectionValue(record[key])}`
    )).join(',')}}`;
  }
  return String(value);
}
