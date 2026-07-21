export const COLLABORATION_ERROR_CODES = [
  "INVALID_REQUEST",
  "INVALID_RESPONSE",
  "CAPACITY_EXCEEDED",
  "NOT_FOUND",
  "REVISION_CONFLICT",
  "INVALID_TRANSITION",
  "IDEMPOTENCY_CONFLICT",
  "ACTIVE_RUN_EXISTS",
  "ACTIVE_ATTEMPT_EXISTS",
  "CAPABILITY_CHANGED",
  "RUNTIME_NOT_DURABLE",
  "RUNTIME_TIMEOUT",
  "INSTANCE_MISMATCH",
  "ORIGIN_NOT_DURABLE",
  "SESSION_IDENTITY_MISMATCH",
  "PARTIAL_CLOSURE_REQUIRED",
  "DELIVERY_UNKNOWN",
  "SESSION_MUTATION_ACTIVE",
  "DELETE_REQUIRES_TERMINAL",
  "FLOW_RECONCILIATION_REQUIRED",
  "MAINTENANCE_ACTIVE",
  "PLUGIN_NOT_CONFIGURED",
] as const;

export type CollaborationErrorCode = (typeof COLLABORATION_ERROR_CODES)[number];

/**
 * Marks malformed, untrusted input that is safe to report to the RPC caller.
 *
 * Keep this separate from TypeError: TypeError can also originate in adapters
 * and other internal code, whose diagnostics must remain redacted at the RPC
 * boundary.
 */
export class RequestValidationError extends Error {
  readonly code = "INVALID_REQUEST" as const;

  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

export class CollaborationError extends Error {
  constructor(
    public readonly code: CollaborationErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CollaborationError";
  }
}

export function assertCondition(
  condition: unknown,
  code: CollaborationErrorCode,
  message: string,
  details?: Record<string, unknown>,
): asserts condition {
  if (!condition) throw new CollaborationError(code, message, details);
}
