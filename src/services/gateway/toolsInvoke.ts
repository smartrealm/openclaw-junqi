export interface ToolsInvokeParams {
  name: string;
  args?: Record<string, unknown>;
  sessionKey?: string;
  agentId?: string;
  confirm?: boolean;
  idempotencyKey?: string;
}

export interface ToolsInvokeError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ToolsInvokeResult {
  ok: boolean;
  toolName: string;
  output?: unknown;
  requiresApproval?: boolean;
  approvalId?: string;
  source?: string;
  error?: ToolsInvokeError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`tools.invoke requires a non-empty ${field}`);
  return normalized;
}

function optionalString(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function optionalBoolean(value: boolean | undefined, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`tools.invoke ${field} must be a boolean`);
  return value;
}

export function buildToolsInvokeParams(params: ToolsInvokeParams): ToolsInvokeParams {
  const name = requiredString(params.name, 'tool name');
  if (params.args !== undefined && !isRecord(params.args)) {
    throw new Error('tools.invoke args must be a JSON object');
  }
  const sessionKey = optionalString(params.sessionKey, 'session key');
  const agentId = optionalString(params.agentId, 'agent id');
  const idempotencyKey = optionalString(params.idempotencyKey, 'idempotency key');
  const confirm = optionalBoolean(params.confirm, 'confirm');
  return {
    name,
    ...(params.args !== undefined ? { args: params.args } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(agentId ? { agentId } : {}),
    ...(confirm !== undefined ? { confirm } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

function parseError(value: unknown): ToolsInvokeError {
  if (!isRecord(value)) throw new Error('tools.invoke returned an invalid error');
  return {
    code: requiredString(typeof value.code === 'string' ? value.code : '', 'error code'),
    message: requiredString(typeof value.message === 'string' ? value.message : '', 'error message'),
    ...(value.details !== undefined ? { details: value.details } : {}),
  };
}

export function parseToolsInvokeResult(value: unknown): ToolsInvokeResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new Error('tools.invoke returned an invalid result');
  }
  const toolName = typeof value.toolName === 'string'
    ? requiredString(value.toolName, 'tool name')
    : '';
  if (!toolName) throw new Error('tools.invoke returned an invalid tool name');
  if (value.requiresApproval !== undefined && typeof value.requiresApproval !== 'boolean') {
    throw new Error('tools.invoke returned an invalid requiresApproval');
  }
  if (value.approvalId !== undefined && typeof value.approvalId !== 'string') {
    throw new Error('tools.invoke returned an invalid approvalId');
  }
  if (value.source !== undefined && (typeof value.source !== 'string' || !value.source.trim())) {
    throw new Error('tools.invoke returned an invalid source');
  }
  const result: ToolsInvokeResult = {
    ok: value.ok,
    toolName,
    ...(value.output !== undefined ? { output: value.output } : {}),
    ...(value.requiresApproval !== undefined ? { requiresApproval: value.requiresApproval } : {}),
    ...(value.approvalId !== undefined
      ? { approvalId: requiredString(value.approvalId as string, 'approvalId') }
      : {}),
    ...(value.source !== undefined ? { source: (value.source as string).trim() } : {}),
    ...(value.error !== undefined ? { error: parseError(value.error) } : {}),
  };
  return result;
}
