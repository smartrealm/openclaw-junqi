export interface SessionsSteerParams {
  key: string;
  message: string;
  agentId?: string;
  thinking?: string;
  attachments?: readonly unknown[];
  timeoutMs?: number;
  idempotencyKey?: string;
}

export interface SessionsSteerOptions {
  agentId?: string;
  thinking?: string;
  attachments?: readonly unknown[];
  timeoutMs?: number;
  idempotencyKey?: string;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`sessions.steer requires a non-empty ${field}`);
  return normalized;
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

/** Build the installed OpenClaw sessions.steer request without inventing fields. */
export function buildSessionsSteerParams(
  key: string,
  message: string,
  options: SessionsSteerOptions = {},
): SessionsSteerParams {
  const timeoutMs = options.timeoutMs === undefined
    ? undefined
    : Math.floor(options.timeoutMs);
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0)) {
    throw new Error('sessions.steer timeoutMs must be a non-negative integer');
  }
  const attachments = options.attachments?.map((attachment) => attachment);
  const idempotencyKey = optionalText(options.idempotencyKey);
  return {
    key: requiredText(key, 'session key'),
    message: requiredText(message, 'message'),
    ...(optionalText(options.agentId) ? { agentId: optionalText(options.agentId) } : {}),
    ...(optionalText(options.thinking) ? { thinking: optionalText(options.thinking) } : {}),
    ...(attachments?.length ? { attachments } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}
