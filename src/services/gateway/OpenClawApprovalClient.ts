import { GatewayRpcError } from './Connection';

export const OPENCLAW_EXEC_APPROVAL_LIST_METHOD = 'exec.approval.list' as const;
export const OPENCLAW_EXEC_APPROVAL_RESOLVE_METHOD = 'exec.approval.resolve' as const;
export const OPENCLAW_PLUGIN_APPROVAL_LIST_METHOD = 'plugin.approval.list' as const;
export const OPENCLAW_PLUGIN_APPROVAL_RESOLVE_METHOD = 'plugin.approval.resolve' as const;

const OPENCLAW_PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH = 512;

export type OpenClawApprovalDecision = 'allow-once' | 'allow-always' | 'deny';
export type OpenClawApprovalKind = 'exec' | 'plugin';
export type OpenClawApprovalAvailability = 'available' | 'unavailable';

export interface OpenClawApprovalCommonRequest {
  readonly allowedDecisions?: readonly OpenClawApprovalDecision[];
  readonly agentId?: string;
  readonly sessionKey?: string;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly toolCallId?: string;
  readonly turnSourceChannel?: string;
  readonly turnSourceTo?: string;
  readonly turnSourceAccountId?: string;
  readonly turnSourceThreadId?: string | number;
}

export interface OpenClawExecApprovalRequest extends OpenClawApprovalCommonRequest {
  readonly command: string;
  readonly commandPreview?: string;
  readonly commandArgv?: readonly string[];
  readonly envKeys?: readonly string[];
  readonly cwd?: string;
  readonly nodeId?: string;
  readonly host?: string;
  readonly security?: string;
  readonly ask?: string;
  readonly warningText?: string;
  readonly resolvedPath?: string;
}

export interface OpenClawPluginApprovalRequest extends OpenClawApprovalCommonRequest {
  readonly pluginId?: string;
  readonly title: string;
  readonly description: string;
  readonly severity?: 'info' | 'warning' | 'critical';
  readonly toolName?: string;
}

export interface OpenClawExecApproval {
  readonly kind: 'exec';
  readonly id: string;
  readonly request: OpenClawExecApprovalRequest;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export interface OpenClawPluginApproval {
  readonly kind: 'plugin';
  readonly id: string;
  readonly request: OpenClawPluginApprovalRequest;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export type OpenClawApproval = OpenClawExecApproval | OpenClawPluginApproval;

export interface OpenClawApprovalListResult {
  readonly approvals: readonly OpenClawApproval[];
  readonly availability: Readonly<{
    exec: OpenClawApprovalAvailability;
    plugin: OpenClawApprovalAvailability;
  }>;
}

export type OpenClawApprovalRequester = <T>(
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

export type OpenClawApprovalAdvertisedMethodLookup = (method: string) => boolean | null;

export class OpenClawApprovalResponseError extends Error {
  readonly code = 'OPENCLAW_APPROVAL_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid approval response');
    this.name = 'OpenClawApprovalResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredText(value: unknown, max = 2_048): string {
  if (typeof value !== 'string') throw new OpenClawApprovalResponseError();
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new OpenClawApprovalResponseError();
  return normalized;
}

function optionalText(value: unknown, max = 2_048): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredText(value, max);
}

function optionalThreadId(value: unknown): string | number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return requiredText(value, 2_048);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  throw new OpenClawApprovalResponseError();
}

function optionalStringArray(value: unknown): readonly string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new OpenClawApprovalResponseError();
  return value.map((item) => requiredText(item, 2_048));
}

const APPROVAL_DECISIONS: readonly OpenClawApprovalDecision[] = [
  'allow-once',
  'allow-always',
  'deny',
];

function optionalDecisions(value: unknown): readonly OpenClawApprovalDecision[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > APPROVAL_DECISIONS.length) {
    throw new OpenClawApprovalResponseError();
  }
  const decisions = value.map((item) => {
    if (typeof item !== 'string' || !APPROVAL_DECISIONS.includes(item as OpenClawApprovalDecision)) {
      throw new OpenClawApprovalResponseError();
    }
    return item as OpenClawApprovalDecision;
  });
  return [...new Set(decisions)];
}

function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new OpenClawApprovalResponseError();
  }
  return value;
}

function parseCommonRequest(source: Record<string, unknown>): OpenClawApprovalCommonRequest {
  const allowedDecisions = optionalDecisions(source.allowedDecisions);
  const agentId = optionalText(source.agentId);
  const sessionKey = optionalText(source.sessionKey);
  const sessionId = optionalText(source.sessionId);
  const runId = optionalText(source.runId);
  const toolCallId = optionalText(source.toolCallId);
  const turnSourceChannel = optionalText(source.turnSourceChannel);
  const turnSourceTo = optionalText(source.turnSourceTo);
  const turnSourceAccountId = optionalText(source.turnSourceAccountId);
  const turnSourceThreadId = optionalThreadId(source.turnSourceThreadId);
  return {
    ...(allowedDecisions ? { allowedDecisions } : {}),
    ...(agentId ? { agentId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(runId ? { runId } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(turnSourceChannel ? { turnSourceChannel } : {}),
    ...(turnSourceTo ? { turnSourceTo } : {}),
    ...(turnSourceAccountId ? { turnSourceAccountId } : {}),
    ...(turnSourceThreadId !== undefined ? { turnSourceThreadId } : {}),
  };
}

function parseExecRequest(value: unknown): OpenClawExecApprovalRequest {
  const source = record(value);
  if (!source) throw new OpenClawApprovalResponseError();
  const command = requiredText(source.command, 32_768);
  const commandPreview = optionalText(source.commandPreview, 32_768);
  const commandArgv = optionalStringArray(source.commandArgv);
  const envKeys = optionalStringArray(source.envKeys);
  const cwd = optionalText(source.cwd, 8_192);
  const nodeId = optionalText(source.nodeId);
  const host = optionalText(source.host);
  const security = optionalText(source.security);
  const ask = optionalText(source.ask);
  const warningText = optionalText(source.warningText, 32_768);
  const resolvedPath = optionalText(source.resolvedPath, 8_192);
  return {
    command,
    ...parseCommonRequest(source),
    ...(commandPreview ? { commandPreview } : {}),
    ...(commandArgv ? { commandArgv } : {}),
    ...(envKeys ? { envKeys } : {}),
    ...(cwd ? { cwd } : {}),
    ...(nodeId ? { nodeId } : {}),
    ...(host ? { host } : {}),
    ...(security ? { security } : {}),
    ...(ask ? { ask } : {}),
    ...(warningText ? { warningText } : {}),
    ...(resolvedPath ? { resolvedPath } : {}),
  };
}

function parsePluginRequest(value: unknown): OpenClawPluginApprovalRequest {
  const source = record(value);
  if (!source) throw new OpenClawApprovalResponseError();
  const pluginId = optionalText(source.pluginId);
  const title = requiredText(source.title, 80);
  const description = requiredText(source.description, OPENCLAW_PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH);
  const severity = source.severity === undefined || source.severity === null
    ? undefined
    : source.severity === 'info' || source.severity === 'warning' || source.severity === 'critical'
      ? source.severity
      : (() => { throw new OpenClawApprovalResponseError(); })();
  const toolName = optionalText(source.toolName);
  return {
    title,
    description,
    ...parseCommonRequest(source),
    ...(pluginId ? { pluginId } : {}),
    ...(severity ? { severity } : {}),
    ...(toolName ? { toolName } : {}),
  };
}

function parseEnvelope(value: unknown, kind: OpenClawApprovalKind): OpenClawApproval {
  const source = record(value);
  if (!source) throw new OpenClawApprovalResponseError();
  const id = requiredText(source.id);
  const createdAtMs = timestamp(source.createdAtMs);
  const expiresAtMs = timestamp(source.expiresAtMs);
  if (kind === 'exec') {
    return {
      kind,
      id,
      request: parseExecRequest(source.request),
      createdAtMs,
      expiresAtMs,
    };
  }
  return {
    kind,
    id,
    request: parsePluginRequest(source.request),
    createdAtMs,
    expiresAtMs,
  };
}

function parseList(value: unknown, kind: OpenClawApprovalKind): readonly OpenClawApproval[] {
  if (!Array.isArray(value)) throw new OpenClawApprovalResponseError();
  return value.map((item) => parseEnvelope(item, kind));
}

function isUnsupportedProtocolError(error: unknown): error is GatewayRpcError {
  if (!(error instanceof GatewayRpcError)) return false;
  const code = error.code?.trim().toUpperCase();
  return code === 'METHOD_NOT_FOUND' || code === 'UNKNOWN_METHOD' || code === 'UNKNOWN_COMMAND';
}

function resolveMethod(kind: OpenClawApprovalKind): string {
  return kind === 'exec'
    ? OPENCLAW_EXEC_APPROVAL_RESOLVE_METHOD
    : OPENCLAW_PLUGIN_APPROVAL_RESOLVE_METHOD;
}

function listMethod(kind: OpenClawApprovalKind): string {
  return kind === 'exec'
    ? OPENCLAW_EXEC_APPROVAL_LIST_METHOD
    : OPENCLAW_PLUGIN_APPROVAL_LIST_METHOD;
}

function validateDecision(decision: OpenClawApprovalDecision): void {
  if (!APPROVAL_DECISIONS.includes(decision)) throw new Error('Invalid OpenClaw approval decision');
}

/**
 * Narrow adapter for OpenClaw's native approval queue. The caller owns the
 * operator.approvals authorization lane; this class only speaks and validates
 * the list/resolve protocol.
 */
export class OpenClawApprovalClient {
  constructor(
    private readonly request: OpenClawApprovalRequester,
    private readonly hasAdvertisedMethod: OpenClawApprovalAdvertisedMethodLookup,
  ) {}

  private async listKind(kind: OpenClawApprovalKind): Promise<{
    approvals: readonly OpenClawApproval[];
    availability: OpenClawApprovalAvailability;
  }> {
    const method = listMethod(kind);
    if (this.hasAdvertisedMethod(method) === false) {
      return { approvals: [], availability: 'unavailable' };
    }
    try {
      return {
        approvals: parseList(await this.request<unknown>(method, {}), kind),
        availability: 'available',
      };
    } catch (error) {
      if (isUnsupportedProtocolError(error)) {
        return { approvals: [], availability: 'unavailable' };
      }
      throw error;
    }
  }

  async list(): Promise<OpenClawApprovalListResult> {
    const [exec, plugin] = await Promise.all([
      this.listKind('exec'),
      this.listKind('plugin'),
    ]);
    return {
      approvals: [...exec.approvals, ...plugin.approvals]
        .sort((left, right) => left.expiresAtMs - right.expiresAtMs),
      availability: {
        exec: exec.availability,
        plugin: plugin.availability,
      },
    };
  }

  async resolve(
    approval: OpenClawApproval,
    decision: OpenClawApprovalDecision,
  ): Promise<void> {
    validateDecision(decision);
    if (approval.request.allowedDecisions && !approval.request.allowedDecisions.includes(decision)) {
      throw new Error('The OpenClaw Gateway did not advertise this approval decision');
    }
    const response = await this.request<unknown>(resolveMethod(approval.kind), {
      id: approval.id,
      decision,
    });
    const result = record(response);
    if (!result || result.ok !== true) throw new OpenClawApprovalResponseError();
  }
}
