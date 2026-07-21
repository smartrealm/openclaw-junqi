export function createClientMessageId(): string {
  return `junqi-${globalThis.crypto.randomUUID()}`;
}

export interface GatewayMessageIdentity {
  nativeMessageId?: string;
  clientMessageId?: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function identityValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => (
    typeof value === 'string'
    && value.length <= 512
    && value.trim().length > 0
    && !/[\u0000-\u001f\u007f]/.test(value)
  ));
}

export function normalizeTranscriptClientMessageId(value: string, role?: unknown): string {
  if (role === 'user' && value.endsWith(':user')) {
    return value.slice(0, -':user'.length);
  }
  return value;
}

/**
 * Adapts OpenClaw transcript messages across wire versions. OpenClaw 2026.7.1
 * exposes its canonical history id under `__openclaw.id`; older payloads used
 * top-level `id` or `messageId` fields.
 */
export function readGatewayMessageIdentity(value: unknown): GatewayMessageIdentity {
  const message = record(value);
  if (!message) return {};
  const metadata = record(message.__openclaw);
  const nativeMessageId = identityValue(
    metadata?.id,
    message.id,
    message.messageId,
  );
  const rawClientMessageId = identityValue(
    message.clientMessageId,
    message.idempotencyKey,
    metadata?.clientMessageId,
    metadata?.idempotencyKey,
  );
  const clientMessageId = rawClientMessageId
    ? normalizeTranscriptClientMessageId(rawClientMessageId, message.role)
    : undefined;
  return {
    ...(nativeMessageId ? { nativeMessageId } : {}),
    ...(clientMessageId ? { clientMessageId } : {}),
  };
}
