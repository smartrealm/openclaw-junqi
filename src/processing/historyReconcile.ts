import { normalizeGatewayMessage } from './normalizeGatewayMessage';
import { extractQuickReplies } from './messageParsingShared';
import { stripDirectives } from './TextCleaner';

type HistoryLikeMessage = {
  id: string;
  runId?: string | null;
  clientMessageId?: string;
  nativeMessageId?: string;
  nativeProjectionId?: string;
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

function visibleAssistantText(message: HistoryLikeMessage): string {
  const text = normalizeGatewayMessage(message).text;
  return normalizeWhitespace(extractQuickReplies(stripDirectives(text)).cleanText);
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
  const value = text || normalizeWhitespace(safeStableStringify(message.content));
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
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

function identityValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nativeIdentity(message: HistoryLikeMessage): string | null {
  return identityValue(message.nativeMessageId);
}

function clientIdentity(message: HistoryLikeMessage): string | null {
  const clientId = identityValue(message.clientMessageId);
  const role = identityValue(message.role);
  return clientId && role ? `${role}\u0000${clientId}` : null;
}

function rememberIndex(target: Map<string, number[]>, key: string | null, index: number): void {
  if (!key) return;
  const indexes = target.get(key) ?? [];
  if (!indexes.includes(index)) indexes.push(index);
  target.set(key, indexes);
}

function firstUnconsumed(
  indexes: number[] | undefined,
  consumed: Set<number>,
  predicate: (index: number) => boolean = () => true,
): number | undefined {
  return indexes?.find((index) => !consumed.has(index) && predicate(index));
}

export function dedupeHistoryMessages<T extends HistoryLikeMessage>(messages: T[]): T[] {
  const seenExact = new Set<string>();
  const indexesByNative = new Map<string, number[]>();
  const indexesByClient = new Map<string, number[]>();
  const indexByLocalId = new Map<string, number>();
  const deduped: T[] = [];

  const rememberDurableAliases = (message: T, index: number) => {
    rememberIndex(indexesByNative, nativeIdentity(message), index);
    rememberIndex(indexesByClient, clientIdentity(message), index);
  };

  for (const message of messages) {
    const nativeId = nativeIdentity(message);
    const clientId = clientIdentity(message);
    const nativeCandidates = nativeId ? indexesByNative.get(nativeId) ?? [] : [];
    let existingIndex = nativeCandidates.find((index) => (
      deduped[index]?.id === message.id
      || (
        message.nativeProjectionId !== undefined
        && deduped[index]?.nativeProjectionId === message.nativeProjectionId
      )
    ));
    if (
      existingIndex === undefined
      && nativeCandidates.length > 0
      && message.nativeProjectionId === undefined
      && nativeCandidates.every((index) => deduped[index]?.nativeProjectionId === undefined)
    ) {
      existingIndex = nativeCandidates[0];
    }

    if (existingIndex === undefined && clientId) {
      const candidates = indexesByClient.get(clientId) ?? [];
      const compatible = candidates.filter((index) => {
        const existingNativeId = nativeIdentity(deduped[index]);
        return !nativeId || !existingNativeId || existingNativeId === nativeId;
      });
      if (compatible.length === 1) existingIndex = compatible[0];
    }

    if (existingIndex !== undefined) {
      // The server's later copy is authoritative: it may carry the final
      // response state after an earlier duplicate was streamed or replayed.
      // Never let a client-only replay erase an already known native identity.
      const existing = deduped[existingIndex];
      if (!nativeIdentity(existing) || nativeId) {
        deduped[existingIndex] = {
          ...message,
          nativeMessageId: message.nativeMessageId ?? existing.nativeMessageId,
          clientMessageId: message.clientMessageId ?? existing.clientMessageId,
        };
      }
      rememberDurableAliases(deduped[existingIndex], existingIndex);
      continue;
    }

    if (nativeId || clientId) {
      const index = deduped.length;
      deduped.push(message);
      rememberDurableAliases(message, index);
      continue;
    }

    const localId = identityValue(message.id);
    const localIndex = localId ? indexByLocalId.get(localId) : undefined;
    if (localIndex !== undefined) {
      deduped[localIndex] = message;
      seenExact.add(messageExactKey(message));
      continue;
    }
    const exactKey = messageExactKey(message);
    if (seenExact.has(exactKey)) continue;
    seenExact.add(exactKey);
    if (localId) indexByLocalId.set(localId, deduped.length);
    deduped.push(message);
  }
  return deduped;
}

export function reconcileHistoryMessageIds<T extends HistoryLikeMessage>(
  previous: T[],
  incoming: T[],
): T[] {
  if (previous.length === 0) return incoming;

  const indexesByNative = new Map<string, number[]>();
  const indexesByClient = new Map<string, number[]>();
  const indexesByLocalId = new Map<string, number[]>();
  const indexesByFallback = new Map<string, number[]>();
  for (const [index, message] of previous.entries()) {
    const nativeId = nativeIdentity(message);
    const clientId = clientIdentity(message);
    if (nativeId || clientId) {
      rememberIndex(indexesByNative, nativeId, index);
      rememberIndex(indexesByClient, clientId, index);
    } else {
      rememberIndex(indexesByLocalId, identityValue(message.id), index);
      rememberIndex(indexesByFallback, messageExactKey(message), index);
    }
  }
  const consumedPreviousIndexes = new Set<number>();
  const incomingIndexByPreviousIndex = new Map<number, number>();

  let lastMatchedPreviousIndex = -1;
  const reconciled = incoming.map((message, incomingIndex) => {
    const nativeId = nativeIdentity(message);
    const clientId = clientIdentity(message);
    let matchedByLocalId = false;
    let previousIndex = nativeId && message.nativeProjectionId
      ? firstUnconsumed(
          indexesByNative.get(nativeId),
          consumedPreviousIndexes,
          (index) => previous[index]?.nativeProjectionId === message.nativeProjectionId,
        )
      : undefined;
    if (previousIndex === undefined && nativeId) {
      previousIndex = firstUnconsumed(indexesByNative.get(nativeId), consumedPreviousIndexes);
    }

    if (previousIndex === undefined && clientId) {
      const candidates = (indexesByClient.get(clientId) ?? []).filter((index) => (
        !consumedPreviousIndexes.has(index)
        && (!nativeId || !nativeIdentity(previous[index]) || nativeIdentity(previous[index]) === nativeId)
      ));
      if (candidates.length === 1) previousIndex = candidates[0];
    }

    if (previousIndex === undefined && !nativeId && !clientId) {
      const localIdMatch = firstUnconsumed(
        indexesByLocalId.get(identityValue(message.id) ?? ''),
        consumedPreviousIndexes,
      );
      if (localIdMatch !== undefined) {
        previousIndex = localIdMatch;
        matchedByLocalId = true;
      } else previousIndex = firstUnconsumed(
        indexesByFallback.get(messageExactKey(message)),
        consumedPreviousIndexes,
      );
    }
    if (previousIndex === undefined) return message;
    consumedPreviousIndexes.add(previousIndex);
    incomingIndexByPreviousIndex.set(previousIndex, incomingIndex);
    lastMatchedPreviousIndex = Math.max(lastMatchedPreviousIndex, previousIndex);
    const previousMessage = previous[previousIndex];
    if (!previousMessage) return message;
    // The same local id represents one in-memory stream snapshot. During
    // progressive hydration the `incoming` copy can be one animation frame
    // older, so keep the newest local projection until a durable identity
    // replaces it.
    if (matchedByLocalId) return previousMessage;
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
      && !streamingTailIsCoveredByDurableHistory(
        message,
        index,
        previous,
        incoming,
        incomingIndexByPreviousIndex,
      )
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

function streamingTailIsCoveredByDurableHistory(
  local: HistoryLikeMessage,
  localIndex: number,
  previous: HistoryLikeMessage[],
  incoming: HistoryLikeMessage[],
  incomingIndexByPreviousIndex: Map<number, number>,
): boolean {
  if (
    local.role !== 'assistant'
    || !(local.isStreaming || local.responseState === 'streaming')
  ) {
    return false;
  }
  // A matched durable segment is canonical even when OpenClaw used a
  // non-prefix `replace=true` correction. Text-prefix comparison would retain
  // the superseded streaming draft beside the official transcript message.
  const durableCoversLocal = (candidate: HistoryLikeMessage) => candidate.role === 'assistant';

  // OpenClaw transcript messages commonly omit runId. Anchor the live tail to
  // its preceding user message, whose idempotency key survives in history, and
  // compare the same visible assistant segment from that conversational turn.
  // Tool calls can create several assistant segments under one user message;
  // matching an arbitrary earlier segment would discard a legitimate tail.
  let previousUserIndex = -1;
  for (let index = localIndex - 1; index >= 0; index -= 1) {
    if (previous[index]?.role === 'user') {
      previousUserIndex = index;
      break;
    }
  }
  if (previousUserIndex >= 0) {
    const incomingUserIndex = incomingIndexByPreviousIndex.get(previousUserIndex);
    if (incomingUserIndex !== undefined) {
      const localSegmentOrdinal = previous
        .slice(previousUserIndex + 1, localIndex + 1)
        .filter((message) => (
          message.role === 'assistant'
          && visibleAssistantText(message).length > 0
        )).length;
      const incomingSegments: HistoryLikeMessage[] = [];
      for (let index = incomingUserIndex + 1; index < incoming.length; index += 1) {
        const candidate = incoming[index];
        if (candidate.role === 'user') break;
        if (
          candidate.role === 'assistant'
          && visibleAssistantText(candidate).length > 0
        ) {
          incomingSegments.push(candidate);
        }
      }
      const matchingSegment = incomingSegments[localSegmentOrdinal - 1];
      return matchingSegment ? durableCoversLocal(matchingSegment) : false;
    }
  }

  return Boolean(local.runId && incoming.some((candidate) => (
    candidate.runId === local.runId && durableCoversLocal(candidate)
  )));
}
