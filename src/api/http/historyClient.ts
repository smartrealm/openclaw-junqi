// History pagination HTTP client — pure transport layer.
//
// Talks to the gateway's `GET /sessions/:sessionKey/history` endpoint that
// already supports cursor-based pagination server-side (see openclaw's
// `dist/sessions-history-http-*.js`). The WebSocket `chat.history` RPC only
// accepts `{ sessionKey, limit }` and never returns pagination metadata, so
// the WebSocket path stays for the initial load and this HTTP path handles
// "scroll up for older messages".
//
// No store/state coupling — callers compose with normalizers and merge logic.
import type { ChatMessage } from '@/stores/chatStore';

/** Raw HTTP response shape from `/sessions/:sessionKey/history`. */
export interface RawSessionHistoryResponse {
  sessionKey: string;
  items?: unknown[];
  messages?: unknown[];
  hasMore?: boolean;
  nextCursor?: string;
}

/** Normalized page returned to callers. */
export interface SessionHistoryPage {
  sessionKey: string;
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor?: string;
}

/** Hard ceiling mirrors the gateway clamp in `dist/chat-DKi9Erun.js`. */
export const GATEWAY_HISTORY_LIMIT_MAX = 1000;

/** Per-request network timeout for the history endpoint. */
const DEFAULT_TIMEOUT_MS = 12_000;

export class HistoryFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'HistoryFetchError';
  }
}

/**
 * Fetch one page of session history. The endpoint returns messages ordered
 * newest-first when no cursor is supplied, and messages older than `cursor`
 * when one is supplied. Caller is responsible for normalization and merging.
 */
export async function fetchSessionHistoryPage(opts: {
  baseUrl: string;
  token: string;
  sessionKey: string;
  limit: number;
  cursor?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<SessionHistoryPage> {
  const limit = Math.max(
    1,
    Math.min(GATEWAY_HISTORY_LIMIT_MAX, Math.floor(opts.limit)),
  );

  const url = buildHistoryUrl(opts.baseUrl, opts.sessionKey, limit, opts.cursor);

  const timeoutController = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(
    () => timeoutController.abort(new Error('history fetch timeout')),
    timeoutMs,
  );

  // Compose user-provided signal with our internal timeout signal — abort when
  // either fires.
  const externalSignal = opts.signal;
  const onExternalAbort = () => timeoutController.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: 'application/json',
      },
      signal: timeoutController.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HistoryFetchError(
        `history fetch failed: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`,
        res.status,
      );
    }

    const body = (await res.json()) as RawSessionHistoryResponse;
    return {
      sessionKey: body.sessionKey ?? opts.sessionKey,
      // Prefer `messages` (canonical field); fall back to `items` for older
      // gateway builds that only emit that name.
      messages: ((body.messages ?? body.items ?? []) as ChatMessage[]),
      hasMore: Boolean(body.hasMore),
      nextCursor: body.nextCursor || undefined,
    };
  } catch (err) {
    if (err instanceof HistoryFetchError) throw err;
    throw new HistoryFetchError(
      `history fetch error: ${err instanceof Error ? err.message : String(err)}`,
      0,
      err,
    );
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

function buildHistoryUrl(
  baseUrl: string,
  sessionKey: string,
  limit: number,
  cursor?: string,
): URL {
  // Session keys look like `agent:main:main` — encode each segment so the
  // gateway's `decodeURIComponent` round-trip recovers the original value.
  const encodedKey = sessionKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const url = new URL(`/sessions/${encodedKey}/history`, ensureHttpBase(baseUrl));
  url.searchParams.set('limit', String(limit));
  if (cursor) url.searchParams.set('cursor', cursor);
  return url;
}

function ensureHttpBase(baseUrl: string): string {
  if (!baseUrl) {
    throw new HistoryFetchError('gateway http base url is empty', 0);
  }
  // Defend against `ws://127.0.0.1:18789` leaking into an HTTP context — the
  // gateway exposes both, but the history endpoint is HTTP-only.
  if (baseUrl.startsWith('ws://')) return 'http://' + baseUrl.slice('ws://'.length);
  if (baseUrl.startsWith('wss://')) return 'https://' + baseUrl.slice('wss://'.length);
  return baseUrl;
}
