export interface OpenClawSessionAbortInput {
  readonly key?: string;
  readonly runId?: string;
  readonly agentId?: string;
  readonly clearQueued?: boolean;
}

export interface OpenClawSessionAbortResult {
  readonly ok: true;
  readonly abortedRunId: string | null;
  readonly status: 'aborted' | 'no-active-run';
}

export type OpenClawSessionAbortRequester = <T>(
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

export class OpenClawSessionAbortResponseError extends Error {
  constructor() {
    super('OPENCLAW_SESSION_ABORT_RESPONSE_INVALID');
    this.name = 'OpenClawSessionAbortResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildParams(input: OpenClawSessionAbortInput): Record<string, unknown> {
  const key = input.key === undefined ? undefined : nonEmptyString(input.key);
  const runId = input.runId === undefined ? undefined : nonEmptyString(input.runId);
  if (input.key !== undefined && !key) throw new Error('Invalid OpenClaw sessions.abort key');
  if (input.runId !== undefined && !runId) throw new Error('Invalid OpenClaw sessions.abort runId');
  if (!key && !runId) throw new Error('OpenClaw sessions.abort requires key or runId');

  const agentId = input.agentId === undefined ? undefined : nonEmptyString(input.agentId);
  if (input.agentId !== undefined && !agentId) {
    throw new Error('Invalid OpenClaw sessions.abort agentId');
  }
  if (input.clearQueued !== undefined && typeof input.clearQueued !== 'boolean') {
    throw new Error('Invalid OpenClaw sessions.abort clearQueued');
  }
  return {
    ...(key ? { key } : {}),
    ...(runId ? { runId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(input.clearQueued !== undefined ? { clearQueued: input.clearQueued } : {}),
  };
}

/** Decode the stable result fields emitted by OpenClaw's sessions.abort handler. */
export function parseOpenClawSessionAbortResult(value: unknown): OpenClawSessionAbortResult {
  const response = record(value);
  const abortedRunId = response?.abortedRunId;
  if (
    !response
    || response.ok !== true
    || (response.status !== 'aborted' && response.status !== 'no-active-run')
    || (abortedRunId !== null && abortedRunId !== undefined && typeof abortedRunId !== 'string')
  ) {
    throw new OpenClawSessionAbortResponseError();
  }
  return {
    ok: true,
    status: response.status,
    abortedRunId: typeof abortedRunId === 'string' && abortedRunId.trim()
      ? abortedRunId.trim()
      : null,
  };
}

/**
 * Narrow client for the operator.write native session abort RPC. `clearQueued`
 * is opt-in so the ordinary Stop action preserves OpenClaw followup queues.
 */
export class OpenClawSessionAbortClient {
  constructor(private readonly request: OpenClawSessionAbortRequester) {}

  async abort(input: OpenClawSessionAbortInput): Promise<OpenClawSessionAbortResult> {
    const params = buildParams(input);
    return parseOpenClawSessionAbortResult(
      await this.request<unknown>('sessions.abort', params),
    );
  }
}
