export const OPENCLAW_TOOLS_INVOKE_METHOD = 'tools.invoke' as const;

export interface OpenClawToolsInvokeInput {
  readonly name: string;
  readonly args?: Record<string, unknown>;
  readonly sessionKey?: string;
  readonly agentId?: string;
  readonly confirm?: boolean;
  readonly idempotencyKey?: string;
}

export interface OpenClawToolsInvokeError {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface OpenClawToolsInvokeResult {
  readonly ok: boolean;
  readonly toolName: string;
  readonly output?: unknown;
  readonly requiresApproval?: boolean;
  readonly approvalId?: string;
  readonly source?: string;
  readonly error?: OpenClawToolsInvokeError;
}

export type OpenClawToolsInvokeRequester = <T>(
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

export class OpenClawToolsInvokeResponseError extends Error {
  readonly code = 'OPENCLAW_TOOLS_INVOKE_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid tools.invoke response');
    this.name = 'OpenClawToolsInvokeResponseError';
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

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const normalized = nonEmptyString(value);
  if (!normalized) throw new OpenClawToolsInvokeResponseError();
  return normalized;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const normalized = record(value);
  if (!normalized) throw new OpenClawToolsInvokeResponseError();
  return normalized;
}

/** Decode the official tools.invoke result without inventing output or errors. */
export function parseOpenClawToolsInvokeResult(value: unknown): OpenClawToolsInvokeResult {
  const source = record(value);
  const toolName = source ? nonEmptyString(source.toolName) : null;
  if (!source || typeof source.ok !== 'boolean' || !toolName) {
    throw new OpenClawToolsInvokeResponseError();
  }
  const requiresApproval = source.requiresApproval === undefined
    ? undefined
    : source.requiresApproval;
  if (requiresApproval !== undefined && typeof requiresApproval !== 'boolean') {
    throw new OpenClawToolsInvokeResponseError();
  }
  const approvalId = optionalString(source.approvalId);
  const responseSource = optionalString(source.source);
  let error: OpenClawToolsInvokeError | undefined;
  if (source.error !== undefined) {
    const errorRecord = record(source.error);
    const code = errorRecord ? nonEmptyString(errorRecord.code) : null;
    const message = errorRecord ? nonEmptyString(errorRecord.message) : null;
    if (!errorRecord || !code || !message) throw new OpenClawToolsInvokeResponseError();
    error = {
      code,
      message,
      ...(errorRecord.details !== undefined ? { details: errorRecord.details } : {}),
    };
  }
  return {
    ok: source.ok,
    toolName,
    ...(source.output !== undefined ? { output: source.output } : {}),
    ...(requiresApproval !== undefined ? { requiresApproval } : {}),
    ...(approvalId ? { approvalId } : {}),
    ...(responseSource ? { source: responseSource } : {}),
    ...(error ? { error } : {}),
  };
}

function buildParams(input: OpenClawToolsInvokeInput): Record<string, unknown> {
  const name = nonEmptyString(input.name);
  if (!name) throw new Error('OpenClaw tools.invoke requires a non-empty tool name');

  const args = input.args === undefined ? undefined : optionalRecord(input.args);
  const sessionKey = input.sessionKey === undefined ? undefined : nonEmptyString(input.sessionKey);
  if (input.sessionKey !== undefined && !sessionKey) {
    throw new Error('Invalid OpenClaw tools.invoke sessionKey');
  }
  const agentId = input.agentId === undefined ? undefined : nonEmptyString(input.agentId);
  if (input.agentId !== undefined && !agentId) {
    throw new Error('Invalid OpenClaw tools.invoke agentId');
  }
  const idempotencyKey = input.idempotencyKey === undefined
    ? undefined
    : nonEmptyString(input.idempotencyKey);
  if (input.idempotencyKey !== undefined && !idempotencyKey) {
    throw new Error('Invalid OpenClaw tools.invoke idempotencyKey');
  }
  if (input.confirm !== undefined && typeof input.confirm !== 'boolean') {
    throw new Error('Invalid OpenClaw tools.invoke confirm');
  }

  return {
    name,
    ...(args ? { args } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(agentId ? { agentId } : {}),
    ...(input.confirm !== undefined ? { confirm: input.confirm } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

/** Narrow client for the official operator.write tools.invoke RPC. */
export class OpenClawToolsInvokeClient {
  constructor(private readonly request: OpenClawToolsInvokeRequester) {}

  async invoke(input: OpenClawToolsInvokeInput): Promise<OpenClawToolsInvokeResult> {
    return parseOpenClawToolsInvokeResult(
      await this.request<unknown>(OPENCLAW_TOOLS_INVOKE_METHOD, buildParams(input)),
    );
  }
}
