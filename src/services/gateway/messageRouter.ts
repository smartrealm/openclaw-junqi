// ═══════════════════════════════════════════════════════════
// messageRouter — Handler registry for WebSocket message dispatch
// Replaces if-else type chains in Connection.handleMessage.
// ═══════════════════════════════════════════════════════════

/** Structured auth/scope error detection — replaces fragile includes() chains. */
const AUTH_ERROR_PATTERNS: readonly RegExp[] = [
  /missing\s+scope/i,
  /unauthorized/i,
  /invalid\s+token/i,
  /token\s+required/i,
  // Match "auth" only as a whole word to avoid false positives like "batch auth"
  /\bauth(\b|_)|\bauthentication\s+(failed|required)/i,
] as const;

/** Error codes from the gateway that indicate auth/scope issues. */
const AUTH_ERROR_CODES: readonly string[] = [
  'AUTH_REQUIRED',
  'INVALID_TOKEN',
  'MISSING_SCOPE',
  'UNAUTHORIZED',
  'TOKEN_EXPIRED',
  'PAIRING_REQUIRED',
] as const;

export function isAuthError(error: { message?: string; code?: string }): boolean {
  // Structured error code takes priority (deterministic, no false positives)
  if (error.code && AUTH_ERROR_CODES.includes(error.code.toUpperCase())) return true;

  // Fall back to message matching — but with word-boundary regex, not bare includes()
  const msg = error.message;
  if (typeof msg !== 'string') return false;
  return AUTH_ERROR_PATTERNS.some(re => re.test(msg));
}

export type MessageHandler = (msg: any) => void;

/**
 * Registry-based message dispatcher. Register handlers by (type, event?).
 * Unknown message types fall through to the default handler.
 */
export class MessageRouter {
  private handlers = new Map<string, MessageHandler>();
  private defaultHandler: MessageHandler | null = null;

  /** Register a handler for a specific message type (+ optional event name). */
  on(type: string, handler: MessageHandler, event?: string): this {
    const key = event ? `${type}:${event}` : type;
    this.handlers.set(key, handler);
    return this;
  }

  /** Set a fallback handler for unregistered message types. */
  onDefault(handler: MessageHandler): this {
    this.defaultHandler = handler;
    return this;
  }

  /** Dispatch a message to the appropriate handler. */
  route(msg: any): void {
    if (!msg || typeof msg.type !== 'string') return;

    // Try specific handler: type:event (e.g. "event:connect.challenge")
    if (msg.event) {
      const specific = this.handlers.get(`${msg.type}:${msg.event}`);
      if (specific) { specific(msg); return; }
    }

    // Try generic handler: type only (e.g. "res", "event")
    const generic = this.handlers.get(msg.type);
    if (generic) { generic(msg); return; }

    // Fall through to default
    if (this.defaultHandler) this.defaultHandler(msg);
  }
}
