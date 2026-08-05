import {
  classifyOpenClawChatSendAcknowledgement,
  type OpenClawChatSendAcknowledgement,
} from './OpenClawChatRunProjection';

export interface OpenClawSessionSteerInput {
  readonly key: string;
  readonly message: string;
  readonly agentId?: string;
  readonly thinking?: string;
  readonly attachments?: readonly unknown[];
  readonly timeoutMs?: number;
  readonly idempotencyKey: string;
}

export interface OpenClawSessionSteerResult {
  readonly response: Record<string, unknown>;
  readonly acknowledgement: OpenClawChatSendAcknowledgement;
  readonly interruptedActiveRun: boolean | null;
}

export type OpenClawSessionSteerRequester = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export class OpenClawSessionSteerResponseError extends Error {
  constructor() {
    super('OPENCLAW_SESSION_STEER_RESPONSE_INVALID');
    this.name = 'OpenClawSessionSteerResponseError';
  }
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Invalid OpenClaw sessions.steer ${field}`);
  return normalized;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function buildParams(input: OpenClawSessionSteerInput): Record<string, unknown> {
  const key = requiredText(input.key, 'key');
  if (typeof input.message !== 'string' || !input.message.trim()) {
    throw new Error('Invalid OpenClaw sessions.steer message');
  }
  const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey');
  if (input.agentId !== undefined && !input.agentId.trim()) {
    throw new Error('Invalid OpenClaw sessions.steer agentId');
  }
  if (input.timeoutMs !== undefined && (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 0)) {
    throw new Error('Invalid OpenClaw sessions.steer timeoutMs');
  }
  return {
    key,
    message: input.message,
    ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
    ...(input.thinking !== undefined ? { thinking: input.thinking } : {}),
    ...(input.attachments ? { attachments: [...input.attachments] } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    idempotencyKey,
  };
}

export class OpenClawSessionSteerClient {
  constructor(private readonly request: OpenClawSessionSteerRequester) {}

  async steer(input: OpenClawSessionSteerInput): Promise<OpenClawSessionSteerResult> {
    const params = buildParams(input);
    const response = record(await this.request('sessions.steer', params));
    const expectedRunId = String(params.idempotencyKey);
    const acknowledgement = classifyOpenClawChatSendAcknowledgement(response, expectedRunId);
    if (!response || acknowledgement.state === 'unknown') {
      throw new OpenClawSessionSteerResponseError();
    }
    const interruptedActiveRun = typeof response.interruptedActiveRun === 'boolean'
      ? response.interruptedActiveRun
      : null;
    return { response, acknowledgement, interruptedActiveRun };
  }
}
