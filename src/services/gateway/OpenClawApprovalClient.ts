import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';

export const OPENCLAW_EXEC_APPROVAL_LIST_METHOD = 'exec.approval.list' as const;
export const OPENCLAW_EXEC_APPROVAL_RESOLVE_METHOD = 'exec.approval.resolve' as const;
export const OPENCLAW_PLUGIN_APPROVAL_LIST_METHOD = 'plugin.approval.list' as const;
export const OPENCLAW_PLUGIN_APPROVAL_RESOLVE_METHOD = 'plugin.approval.resolve' as const;
export const OPENCLAW_APPROVAL_HISTORY_METHOD = 'approval.history' as const;
export const OPENCLAW_APPROVAL_GET_METHOD = 'approval.get' as const;
export const OPENCLAW_APPROVAL_RESOLVE_METHOD = 'approval.resolve' as const;

const OPENCLAW_PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH = 512;

export type OpenClawApprovalDecision = 'allow-once' | 'allow-always' | 'deny';
export type OpenClawApprovalKind = 'exec' | 'plugin' | 'system-agent';
export type OpenClawLegacyApprovalKind = Exclude<OpenClawApprovalKind, 'system-agent'>;
export type OpenClawApprovalAvailability = 'available' | 'unavailable';
export type OpenClawApprovalHistoryAvailability = 'available' | 'unavailable';
export type OpenClawApprovalStatus = 'pending' | 'allowed' | 'denied' | 'expired' | 'cancelled';
export type OpenClawApprovalTerminalReason =
  | 'user'
  | 'timeout'
  | 'malformed-verdict'
  | 'no-route'
  | 'run-aborted'
  | 'gateway-restart'
  | 'storage-corrupt';

export interface OpenClawApprovalExecPresentation {
  readonly kind: 'exec';
  readonly commandText: string;
  readonly commandPreview?: string;
  readonly warningText?: string;
  readonly host?: string;
  readonly nodeId?: string;
  readonly agentId?: string;
  readonly allowedDecisions: readonly OpenClawApprovalDecision[];
}

export interface OpenClawApprovalPluginPresentation {
  readonly kind: 'plugin';
  readonly title: string;
  readonly description: string;
  readonly detail?: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly pluginId?: string;
  readonly toolName?: string;
  readonly agentId?: string;
  readonly allowedDecisions: readonly OpenClawApprovalDecision[];
}

export interface OpenClawApprovalSystemAgentPresentation {
  readonly kind: 'system-agent';
  readonly title: string;
  readonly description: string;
  readonly proposalHash: string;
  readonly agentId?: string;
  readonly allowedDecisions: readonly ['allow-once', 'deny'];
}

export type OpenClawApprovalPresentation =
  | OpenClawApprovalExecPresentation
  | OpenClawApprovalPluginPresentation
  | OpenClawApprovalSystemAgentPresentation;

export interface OpenClawApprovalSource {
  readonly agentId?: string;
  readonly sessionKey?: string;
}

export interface OpenClawApprovalResolver {
  readonly kind: 'device' | 'channel' | 'runtime' | 'system';
  readonly id?: string;
}

interface OpenClawApprovalResolutionFields {
  readonly resolvedAtMs: number;
  readonly reason: OpenClawApprovalTerminalReason;
  readonly source?: OpenClawApprovalSource;
  readonly resolver?: OpenClawApprovalResolver;
}

export interface OpenClawPendingApprovalSnapshot {
  readonly id: string;
  readonly urlPath: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly status: 'pending';
  readonly presentation: OpenClawApprovalPresentation;
}

export type OpenClawTerminalApprovalSnapshot = OpenClawApprovalResolutionFields & {
  readonly id: string;
  readonly urlPath: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly presentation: OpenClawApprovalPresentation;
  readonly status: Exclude<OpenClawApprovalStatus, 'pending'>;
  readonly decision?: OpenClawApprovalDecision;
};

export type OpenClawApprovalSnapshot =
  | OpenClawPendingApprovalSnapshot
  | OpenClawTerminalApprovalSnapshot;

export interface OpenClawApprovalHistoryRequest {
  readonly cursor?: string;
  readonly limit?: number;
  readonly kind?: OpenClawApprovalKind;
}

export interface OpenClawApprovalHistoryResult {
  readonly items: readonly OpenClawTerminalApprovalSnapshot[];
  readonly nextCursor?: string;
  readonly availability: OpenClawApprovalHistoryAvailability;
}

export interface OpenClawApprovalGetResult {
  readonly approval: OpenClawApprovalSnapshot | null;
  readonly availability: OpenClawApprovalHistoryAvailability;
}

export interface OpenClawApprovalResolveResult {
  readonly applied: boolean;
  readonly approval: OpenClawTerminalApprovalSnapshot;
}

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

function requiredNonEmptyText(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1) {
    throw new OpenClawApprovalResponseError();
  }
  return value;
}

function requiredBoundedText(value: unknown, max: number): string {
  const text = requiredNonEmptyText(value);
  if (text.length > max) throw new OpenClawApprovalResponseError();
  return text;
}

function optionalStringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new OpenClawApprovalResponseError();
  return value;
}

function optionalBoundedText(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredBoundedText(value, max);
}

function optionalNonEmptyText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredNonEmptyText(value);
}

function optionalNullableNonEmptyText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredNonEmptyText(value);
}

function isWellFormedApprovalId(value: string): boolean {
  if (!value || value === '.' || value === '..') return false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (index + 1 >= value.length
        || nextCodeUnit < 0xdc00
        || nextCodeUnit > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
}

function approvalId(value: unknown): string {
  const id = requiredNonEmptyText(value);
  if (!isWellFormedApprovalId(id)) throw new OpenClawApprovalResponseError();
  return id;
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

const OPENCLAW_APPROVAL_TERMINAL_REASONS: readonly OpenClawApprovalTerminalReason[] = [
  'user',
  'timeout',
  'malformed-verdict',
  'no-route',
  'run-aborted',
  'gateway-restart',
  'storage-corrupt',
];

function parseApprovalKind(value: unknown): OpenClawApprovalKind {
  if (value === 'exec' || value === 'plugin' || value === 'system-agent') return value;
  throw new OpenClawApprovalResponseError();
}

function parseApprovalDecision(value: unknown): OpenClawApprovalDecision {
  if (typeof value === 'string' && APPROVAL_DECISIONS.includes(value as OpenClawApprovalDecision)) {
    return value as OpenClawApprovalDecision;
  }
  throw new OpenClawApprovalResponseError();
}

function parseUnifiedAllowedDecisions(
  value: unknown,
  kind: OpenClawApprovalKind,
): readonly OpenClawApprovalDecision[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > APPROVAL_DECISIONS.length) {
    throw new OpenClawApprovalResponseError();
  }
  const decisions = value.map(parseApprovalDecision);
  if (new Set(decisions).size !== decisions.length || !decisions.includes('deny')) {
    throw new OpenClawApprovalResponseError();
  }
  if (kind === 'system-agent'
    && (decisions.length !== 2 || decisions[0] !== 'allow-once' || decisions[1] !== 'deny')) {
    throw new OpenClawApprovalResponseError();
  }
  return decisions;
}

function parseApprovalSource(value: unknown): OpenClawApprovalSource | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  if (!source) throw new OpenClawApprovalResponseError();
  const agentId = optionalNonEmptyText(source.agentId);
  const sessionKey = optionalNonEmptyText(source.sessionKey);
  return {
    ...(agentId ? { agentId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
  };
}

function parseApprovalResolver(value: unknown): OpenClawApprovalResolver | undefined {
  if (value === undefined) return undefined;
  const resolver = record(value);
  if (!resolver) throw new OpenClawApprovalResponseError();
  if (resolver.kind !== 'device'
    && resolver.kind !== 'channel'
    && resolver.kind !== 'runtime'
    && resolver.kind !== 'system') {
    throw new OpenClawApprovalResponseError();
  }
  const id = optionalNonEmptyText(resolver.id);
  return { kind: resolver.kind, ...(id ? { id } : {}) };
}

function parseUnifiedPresentation(value: unknown): OpenClawApprovalPresentation {
  const source = record(value);
  if (!source) throw new OpenClawApprovalResponseError();
  const kind = parseApprovalKind(source.kind);
  if (kind === 'exec') {
    const commandText = requiredNonEmptyText(source.commandText);
    const commandPreview = optionalStringValue(source.commandPreview);
    const warningText = optionalStringValue(source.warningText);
    const host = optionalStringValue(source.host);
    const nodeId = optionalNullableNonEmptyText(source.nodeId);
    const agentId = optionalNullableNonEmptyText(source.agentId);
    return {
      kind,
      commandText,
      allowedDecisions: parseUnifiedAllowedDecisions(source.allowedDecisions, kind),
      ...(commandPreview !== undefined ? { commandPreview } : {}),
      ...(warningText !== undefined ? { warningText } : {}),
      ...(host !== undefined ? { host } : {}),
      ...(nodeId !== undefined ? { nodeId } : {}),
      ...(agentId !== undefined ? { agentId } : {}),
    };
  }
  if (kind === 'plugin') {
    const title = requiredBoundedText(source.title, 80);
    const description = requiredBoundedText(source.description, 512);
    const detail = optionalBoundedText(source.detail, 16_384);
    const severity = source.severity === 'info'
      || source.severity === 'warning'
      || source.severity === 'critical'
      ? source.severity
      : (() => { throw new OpenClawApprovalResponseError(); })();
    const pluginId = optionalNullableNonEmptyText(source.pluginId);
    const toolName = optionalNullableNonEmptyText(source.toolName);
    const agentId = optionalNullableNonEmptyText(source.agentId);
    return {
      kind,
      title,
      description,
      severity,
      allowedDecisions: parseUnifiedAllowedDecisions(source.allowedDecisions, kind),
      ...(detail !== undefined ? { detail } : {}),
      ...(pluginId !== undefined ? { pluginId } : {}),
      ...(toolName !== undefined ? { toolName } : {}),
      ...(agentId !== undefined ? { agentId } : {}),
    };
  }
  const title = requiredBoundedText(source.title, 80);
  const description = requiredBoundedText(source.description, 512);
  const proposalHash = requiredNonEmptyText(source.proposalHash);
  if (!/^[a-f0-9]{64}$/.test(proposalHash)) throw new OpenClawApprovalResponseError();
  const agentId = optionalNullableNonEmptyText(source.agentId);
  const allowedDecisions = parseUnifiedAllowedDecisions(source.allowedDecisions, kind);
  return {
    kind,
    title,
    description,
    proposalHash,
    allowedDecisions: allowedDecisions as readonly ['allow-once', 'deny'],
    ...(agentId !== undefined ? { agentId } : {}),
  };
}

function parseUnifiedSnapshot(value: unknown): OpenClawApprovalSnapshot {
  const source = record(value);
  if (!source) throw new OpenClawApprovalResponseError();
  const id = approvalId(source.id);
  const urlPath = requiredNonEmptyText(source.urlPath);
  const createdAtMs = timestamp(source.createdAtMs);
  const expiresAtMs = timestamp(source.expiresAtMs);
  const presentation = parseUnifiedPresentation(source.presentation);
  if (source.status === 'pending') {
    return { id, urlPath, createdAtMs, expiresAtMs, status: 'pending', presentation };
  }
  if (source.status !== 'allowed'
    && source.status !== 'denied'
    && source.status !== 'expired'
    && source.status !== 'cancelled') {
    throw new OpenClawApprovalResponseError();
  }
  const resolvedAtMs = timestamp(source.resolvedAtMs);
  if (!OPENCLAW_APPROVAL_TERMINAL_REASONS.includes(source.reason as OpenClawApprovalTerminalReason)) {
    throw new OpenClawApprovalResponseError();
  }
  const reason = source.reason as OpenClawApprovalTerminalReason;
  const approvalSource = parseApprovalSource(source.source);
  const resolver = parseApprovalResolver(source.resolver);
  if (source.status === 'allowed' && reason !== 'user') {
    throw new OpenClawApprovalResponseError();
  }
  if (source.status === 'denied'
    && !['user', 'malformed-verdict', 'no-route', 'storage-corrupt'].includes(reason)) {
    throw new OpenClawApprovalResponseError();
  }
  if (source.status === 'expired' && reason !== 'timeout') {
    throw new OpenClawApprovalResponseError();
  }
  if (source.status === 'cancelled' && reason !== 'run-aborted' && reason !== 'gateway-restart') {
    throw new OpenClawApprovalResponseError();
  }
  if (source.status === 'allowed') {
    const decision = parseApprovalDecision(source.decision);
    if (decision !== 'allow-once' && decision !== 'allow-always') {
      throw new OpenClawApprovalResponseError();
    }
    return {
      id,
      urlPath,
      createdAtMs,
      expiresAtMs,
      status: source.status,
      presentation,
      resolvedAtMs,
      reason,
      ...(approvalSource ? { source: approvalSource } : {}),
      ...(resolver ? { resolver } : {}),
      decision,
    };
  }
  if (source.status === 'denied') {
    if (parseApprovalDecision(source.decision) !== 'deny') throw new OpenClawApprovalResponseError();
    return {
      id,
      urlPath,
      createdAtMs,
      expiresAtMs,
      status: source.status,
      presentation,
      resolvedAtMs,
      reason,
      ...(approvalSource ? { source: approvalSource } : {}),
      ...(resolver ? { resolver } : {}),
      decision: 'deny',
    };
  }
  return {
    id,
    urlPath,
    createdAtMs,
    expiresAtMs,
    status: source.status,
    presentation,
    resolvedAtMs,
    reason,
    ...(approvalSource ? { source: approvalSource } : {}),
    ...(resolver ? { resolver } : {}),
  };
}

function parseApprovalHistory(value: unknown): {
  items: readonly OpenClawTerminalApprovalSnapshot[];
  nextCursor?: string;
} {
  const source = record(value);
  if (!source || !Array.isArray(source.items)) throw new OpenClawApprovalResponseError();
  const items = source.items.map((item) => {
    const snapshot = parseUnifiedSnapshot(item);
    if (snapshot.status === 'pending') throw new OpenClawApprovalResponseError();
    return snapshot;
  });
  const nextCursor = optionalBoundedText(source.nextCursor, 512);
  return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
}

function parseApprovalResolve(value: unknown): OpenClawApprovalResolveResult {
  const source = record(value);
  if (!source || typeof source.applied !== 'boolean') throw new OpenClawApprovalResponseError();
  const approval = parseUnifiedSnapshot(source.approval);
  if (approval.status === 'pending') throw new OpenClawApprovalResponseError();
  return { applied: source.applied, approval };
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

function parseEnvelope(value: unknown, kind: OpenClawLegacyApprovalKind): OpenClawApproval {
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

function parseList(value: unknown, kind: OpenClawLegacyApprovalKind): readonly OpenClawApproval[] {
  if (!Array.isArray(value)) throw new OpenClawApprovalResponseError();
  return value.map((item) => parseEnvelope(item, kind));
}

function resolveMethod(kind: OpenClawLegacyApprovalKind): string {
  return kind === 'exec'
    ? OPENCLAW_EXEC_APPROVAL_RESOLVE_METHOD
    : OPENCLAW_PLUGIN_APPROVAL_RESOLVE_METHOD;
}

function listMethod(kind: OpenClawLegacyApprovalKind): string {
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
  ) {}

  private async listKind(kind: OpenClawLegacyApprovalKind): Promise<{
    approvals: readonly OpenClawApproval[];
    availability: OpenClawApprovalAvailability;
  }> {
    const method = listMethod(kind);
    try {
      return {
        approvals: parseList(await this.request<unknown>(method, {}), kind),
        availability: 'available',
      };
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, method)) {
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

  async history(
    request: OpenClawApprovalHistoryRequest = {},
  ): Promise<OpenClawApprovalHistoryResult> {
    if (request.cursor !== undefined
      && (typeof request.cursor !== 'string'
        || request.cursor.length < 1
        || request.cursor.length > 512)) {
      throw new Error('Invalid OpenClaw approval history cursor');
    }
    if (request.limit !== undefined
      && (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 100)) {
      throw new Error('Invalid OpenClaw approval history limit');
    }
    if (request.kind !== undefined) parseApprovalKind(request.kind);
    const params: Record<string, unknown> = {};
    if (request.cursor !== undefined) params.cursor = request.cursor;
    if (request.limit !== undefined) params.limit = request.limit;
    if (request.kind !== undefined) params.kind = request.kind;
    try {
      return {
        ...parseApprovalHistory(await this.request<unknown>(OPENCLAW_APPROVAL_HISTORY_METHOD, params)),
        availability: 'available',
      };
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, OPENCLAW_APPROVAL_HISTORY_METHOD)) {
        return { items: [], availability: 'unavailable' };
      }
      throw error;
    }
  }

  async get(id: string): Promise<OpenClawApprovalGetResult> {
    const requestedId = approvalId(id);
    try {
      const response = record(await this.request<unknown>(OPENCLAW_APPROVAL_GET_METHOD, {
        id: requestedId,
      }));
      if (!response) throw new OpenClawApprovalResponseError();
      return {
        approval: parseUnifiedSnapshot(response.approval),
        availability: 'available',
      };
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, OPENCLAW_APPROVAL_GET_METHOD)) {
        return { approval: null, availability: 'unavailable' };
      }
      throw error;
    }
  }

  async resolve(
    approval: OpenClawApproval,
    decision: OpenClawApprovalDecision,
  ): Promise<OpenClawApprovalResolveResult | undefined> {
    validateDecision(decision);
    if (approval.request.allowedDecisions && !approval.request.allowedDecisions.includes(decision)) {
      throw new Error('The OpenClaw Gateway did not advertise this approval decision');
    }
    try {
      return parseApprovalResolve(await this.request<unknown>(OPENCLAW_APPROVAL_RESOLVE_METHOD, {
        id: approval.id,
        kind: approval.kind,
        decision,
      }));
    } catch (error) {
      if (!isOpenClawUnknownMethodError(error, OPENCLAW_APPROVAL_RESOLVE_METHOD)) throw error;
    }
    const response = await this.request<unknown>(resolveMethod(approval.kind), {
      id: approval.id,
      decision,
    });
    const result = record(response);
    if (!result || result.ok !== true) throw new OpenClawApprovalResponseError();
    return undefined;
  }

  async resolveSnapshot(
    approval: OpenClawApprovalSnapshot,
    decision: OpenClawApprovalDecision,
  ): Promise<OpenClawApprovalResolveResult> {
    validateDecision(decision);
    if (approval.status !== 'pending') {
      throw new Error('The OpenClaw Gateway approval is already terminal');
    }
    if (!approval.presentation.allowedDecisions.some((candidate) => candidate === decision)) {
      throw new Error('The OpenClaw Gateway did not advertise this approval decision');
    }
    try {
      return parseApprovalResolve(await this.request<unknown>(OPENCLAW_APPROVAL_RESOLVE_METHOD, {
        id: approval.id,
        kind: approval.presentation.kind,
        decision,
      }));
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, OPENCLAW_APPROVAL_RESOLVE_METHOD)) {
        throw new Error('The connected OpenClaw Gateway does not support the unified approval resolver');
      }
      throw error;
    }
  }
}
