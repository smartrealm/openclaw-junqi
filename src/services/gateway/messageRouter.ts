// ═══════════════════════════════════════════════════════════
// messageRouter — Handler registry for WebSocket message dispatch
// Replaces if-else type chains in Connection.handleMessage.
// ═══════════════════════════════════════════════════════════

export type GatewayAuthorizationIssueKind =
  | 'pairing_required'
  | 'credentials_missing'
  | 'credentials_invalid'
  | 'scope_denied'
  | 'rate_limited'
  | 'device_identity_required';

export interface GatewayAuthorizationIssue {
  kind: GatewayAuthorizationIssueKind;
  code: string;
  message: string;
  requestId?: string;
  reason?: string;
  recommendedNextStep?: string;
  missingScope?: string;
  requiredScopes?: string[];
}

type ErrorRecord = Record<string, unknown>;

const PAIRING_CODES = new Set(['PAIRING_REQUIRED']);
const MISSING_CREDENTIAL_CODES = new Set([
  'AUTH_REQUIRED',
  'AUTH_TOKEN_MISSING',
  'AUTH_PASSWORD_MISSING',
  'AUTH_TOKEN_NOT_CONFIGURED',
  'AUTH_PASSWORD_NOT_CONFIGURED',
  'TOKEN_REQUIRED',
]);
const INVALID_CREDENTIAL_CODES = new Set([
  'AUTH_UNAUTHORIZED',
  'AUTH_TOKEN_MISMATCH',
  'AUTH_BOOTSTRAP_TOKEN_INVALID',
  'AUTH_PASSWORD_MISMATCH',
  'AUTH_DEVICE_TOKEN_MISMATCH',
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  'UNAUTHORIZED',
]);
const SCOPE_CODES = new Set(['AUTH_SCOPE_MISMATCH', 'MISSING_SCOPE']);
const RATE_LIMIT_CODES = new Set(['AUTH_RATE_LIMITED']);
const DEVICE_IDENTITY_CODES = new Set([
  'CONTROL_UI_DEVICE_IDENTITY_REQUIRED',
  'DEVICE_IDENTITY_REQUIRED',
]);

function asRecord(value: unknown): ErrorRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as ErrorRecord
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizedCode(value: unknown): string {
  return nonEmptyString(value)?.toUpperCase() ?? '';
}

/**
 * Normalize the current OpenClaw Gateway authorization contract. Pairing is
 * carried in `error.details.code`; the outer code is often only UNAUTHORIZED.
 * Keeping the categories separate prevents a stale token from being presented
 * to the user as a device-approval request.
 */
export function classifyGatewayAuthorizationError(
  value: unknown,
): GatewayAuthorizationIssue | null {
  const error = asRecord(value);
  const details = asRecord(error?.details);
  const message = nonEmptyString(error?.message)
    ?? (typeof value === 'string' ? value.trim() : '')
    ?? '';
  const outerCode = normalizedCode(error?.code);
  const detailCode = normalizedCode(details?.code);
  const code = detailCode || outerCode;

  let kind: GatewayAuthorizationIssueKind | null = null;
  if (PAIRING_CODES.has(code) || /\bpairing\s+required\b/i.test(message)) {
    kind = 'pairing_required';
  } else if (MISSING_CREDENTIAL_CODES.has(code) || /\b(token|password)\s+(required|missing)\b/i.test(message)) {
    kind = 'credentials_missing';
  } else if (RATE_LIMIT_CODES.has(code) || /too many failed authentication attempts/i.test(message)) {
    kind = 'rate_limited';
  } else if (SCOPE_CODES.has(code) || /\bmissing\s+scope\b/i.test(message)) {
    kind = 'scope_denied';
  } else if (DEVICE_IDENTITY_CODES.has(code) || /\bdevice identity required\b/i.test(message)) {
    kind = 'device_identity_required';
  } else if (
    INVALID_CREDENTIAL_CODES.has(code)
    || /\b(invalid token|unauthorized|authentication failed|token mismatch)\b/i.test(message)
  ) {
    kind = 'credentials_invalid';
  }

  if (!kind) return null;
  return {
    kind,
    code: code || outerCode || 'AUTHORIZATION_ERROR',
    message: message || 'Gateway authorization failed',
    ...(nonEmptyString(details?.requestId) ? { requestId: nonEmptyString(details?.requestId) } : {}),
    ...(nonEmptyString(details?.reason) ? { reason: nonEmptyString(details?.reason) } : {}),
    ...(nonEmptyString(details?.recommendedNextStep)
      ? { recommendedNextStep: nonEmptyString(details?.recommendedNextStep) }
      : {}),
    ...(nonEmptyString(details?.missingScope)
      ? { missingScope: nonEmptyString(details?.missingScope) }
      : {}),
    ...(Array.isArray(details?.requiredScopes)
      ? { requiredScopes: details.requiredScopes.filter((scope): scope is string => typeof scope === 'string' && Boolean(scope.trim())) }
      : {}),
  };
}

/** Backward-compatible predicate for callers that only need a boolean. */
export function isAuthError(error: unknown): boolean {
  return classifyGatewayAuthorizationError(error) !== null;
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
