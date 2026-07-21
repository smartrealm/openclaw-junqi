import { normalizeGatewayMessage } from './normalizeGatewayMessage';

type HistoryLikeMessage = {
  id: string;
  clientMessageId?: string;
  nativeMessageId?: string;
  role?: string;
  content?: unknown;
  timestamp?: string;
  mediaUrl?: string;
  toolName?: string;
  toolCallId?: string;
  thinkingContent?: string;
  status?: 'pending' | 'sent' | 'queued' | 'failed' | 'cancelled';
  deliveryError?: string;
  isStreaming?: boolean;
  responseState?: 'streaming' | 'final' | 'error' | 'aborted';
  attachments?: unknown[];
  outboundAttachments?: Array<{ fileName: string; mimeType: string }>;
  retryPayload?: unknown;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function safeStableStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => safeStableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${key}:${safeStableStringify(record[key])}`).join(',')}}`;
  }
  return String(value);
}

function contentFingerprint(message: HistoryLikeMessage): string {
  const text = normalizeWhitespace(normalizeGatewayMessage(message).text);
  if (text) return text.slice(0, 500);
  return normalizeWhitespace(safeStableStringify(message.content)).slice(0, 500);
}

function messageExactKey(message: HistoryLikeMessage): string {
  return [
    message.role ?? '',
    message.toolCallId ?? '',
    message.toolName ?? '',
    contentFingerprint(message),
    message.timestamp ?? '',
    message.mediaUrl ?? '',
    normalizeWhitespace(message.thinkingContent ?? ''),
  ].join('|');
}

function messageIdentityKeys(message: HistoryLikeMessage): string[] {
  const explicitKeys = [
    message.nativeMessageId ? `native:${message.nativeMessageId}` : null,
    message.clientMessageId ? `client:${message.clientMessageId}` : null,
  ].filter((key): key is string => Boolean(key));
  if (explicitKeys.length > 0) return explicitKeys;

  const role = message.role ?? '';
  const toolCallId = message.toolCallId ?? '';
  const toolName = message.toolName ?? '';
  const content = contentFingerprint(message);
  const mediaUrl = message.mediaUrl ?? '';
  const thinking = normalizeWhitespace(message.thinkingContent ?? '');

  if (!role && !toolCallId && !toolName && !content && !mediaUrl && !thinking) {
    return [];
  }

  return [[role, toolCallId, toolName, content, mediaUrl, thinking].join('|')];
}

export function dedupeHistoryMessages<T extends HistoryLikeMessage>(messages: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const message of messages) {
    const key = messageExactKey(message);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(message);
  }
  return deduped;
}

export function reconcileHistoryMessageIds<T extends HistoryLikeMessage>(
  previous: T[],
  incoming: T[],
): T[] {
  if (previous.length === 0) return incoming;

  const indexesByIdentity = new Map<string, number[]>();
  for (const [index, message] of previous.entries()) {
    for (const key of messageIdentityKeys(message)) {
      const matches = indexesByIdentity.get(key) ?? [];
      matches.push(index);
      indexesByIdentity.set(key, matches);
    }
  }
  const consumedPreviousIndexes = new Set<number>();

  let lastMatchedPreviousIndex = -1;
  const reconciled = incoming.map((message) => {
    let previousIndex: number | undefined;
    for (const key of messageIdentityKeys(message)) {
      previousIndex = indexesByIdentity.get(key)?.find((index) => !consumedPreviousIndexes.has(index));
      if (previousIndex !== undefined) break;
    }
    if (previousIndex === undefined) return message;
    consumedPreviousIndexes.add(previousIndex);
    lastMatchedPreviousIndex = Math.max(lastMatchedPreviousIndex, previousIndex);
    const previousMessage = previous[previousIndex];
    if (!previousMessage) return message;
    const attachments = message.attachments ?? previousMessage.attachments;
    const outboundAttachments = message.outboundAttachments ?? previousMessage.outboundAttachments;
    const status = message.status ?? (previousMessage.status ? 'sent' : undefined);
    return {
      ...message,
      id: previousMessage.id,
      clientMessageId: message.clientMessageId ?? previousMessage.clientMessageId,
      nativeMessageId: message.nativeMessageId ?? previousMessage.nativeMessageId,
      ...(attachments !== undefined ? { attachments } : {}),
      ...(outboundAttachments !== undefined ? { outboundAttachments } : {}),
      ...(previousMessage.retryPayload !== undefined && status !== 'sent'
        ? { retryPayload: previousMessage.retryPayload }
        : {}),
      ...(status !== undefined ? { status } : {}),
      ...(previousMessage.deliveryError !== undefined ? { deliveryError: undefined } : {}),
    };
  });

  const localTail = previous
    .map((message, index) => ({ message, index }))
    .filter(({ message, index }) => (
      !consumedPreviousIndexes.has(index)
      && index > lastMatchedPreviousIndex
      && isLocalTailMessage(message)
    ))
    .slice(-20)
    .map(({ message }) => message);

  return [...reconciled, ...localTail];
}

function isLocalTailMessage(message: HistoryLikeMessage): boolean {
  if (message.status === 'pending' || message.status === 'queued' || message.status === 'failed') return true;
  if (message.isStreaming || message.responseState === 'streaming') return true;
  return Boolean(message.clientMessageId && !message.nativeMessageId);
}
