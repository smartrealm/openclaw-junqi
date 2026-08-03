export const APPROVAL_DECISIONS = ['allow-once', 'allow-always', 'deny'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const APPROVAL_KINDS = ['exec', 'plugin'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

const PLUGIN_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type PluginApprovalSeverity = (typeof PLUGIN_SEVERITIES)[number];

const DEFAULT_PLUGIN_APPROVAL_DECISIONS: readonly ApprovalDecision[] = [
  'allow-once',
  'allow-always',
  'deny',
];

export interface ExecApprovalRequest {
  command: string;
  commandPreview?: string;
  cwd?: string;
  host?: string;
  nodeId?: string;
  agentId?: string;
  sessionKey?: string;
  warningText?: string;
  allowedDecisions: ApprovalDecision[];
}

export interface PluginApprovalRequest {
  title: string;
  description: string;
  severity?: PluginApprovalSeverity;
  pluginId?: string;
  toolName?: string;
  toolCallId?: string;
  agentId?: string;
  sessionKey?: string;
  allowedDecisions: ApprovalDecision[];
}

export interface ApprovalRecordBase {
  id: string;
  kind: ApprovalKind;
  createdAtMs: number;
  expiresAtMs: number;
}

export type ApprovalRecord =
  | (ApprovalRecordBase & { kind: 'exec'; request: ExecApprovalRequest })
  | (ApprovalRecordBase & { kind: 'plugin'; request: PluginApprovalRequest });

export interface ApprovalResolvedEvent {
  kind: ApprovalKind;
  id: string;
  decision: ApprovalDecision;
  resolvedBy?: string;
  ts: number;
  request?: ExecApprovalRequest | PluginApprovalRequest;
}

export interface ApprovalRequestedEvent {
  kind: ApprovalKind;
  record: ApprovalRecord;
}

export type GatewayApprovalEvent =
  | (ApprovalRequestedEvent & { phase: 'requested' })
  | (ApprovalResolvedEvent & { phase: 'resolved' });

export interface ApprovalResolveResult {
  ok: true;
}

type ApprovalRequester = (method: string, params: Record<string, unknown>) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`OpenClaw approval returned an invalid ${field}`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, field);
}

function timestamp(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`OpenClaw approval returned an invalid ${field}`);
  }
  return value;
}

function decision(value: unknown, field: string): ApprovalDecision {
  if (typeof value !== 'string' || !APPROVAL_DECISIONS.includes(value as ApprovalDecision)) {
    throw new Error(`OpenClaw approval returned an invalid ${field}`);
  }
  return value as ApprovalDecision;
}

function decisions(value: unknown, field: string, allowDefault: boolean): ApprovalDecision[] {
  if (value === undefined && allowDefault) return [...DEFAULT_PLUGIN_APPROVAL_DECISIONS];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`OpenClaw approval returned an invalid ${field}`);
  }
  const result = value.map((entry, index) => decision(entry, `${field}[${index}]`));
  return [...new Set(result)];
}

function parseExecRequest(value: unknown): ExecApprovalRequest {
  if (!isRecord(value)) throw new Error('OpenClaw exec approval returned an invalid request');
  const request: ExecApprovalRequest = {
    command: requiredString(value.command, 'request.command'),
    allowedDecisions: decisions(value.allowedDecisions, 'request.allowedDecisions', false),
  };
  const commandPreview = optionalString(value.commandPreview, 'request.commandPreview');
  const cwd = optionalString(value.cwd, 'request.cwd');
  const host = optionalString(value.host, 'request.host');
  const nodeId = optionalString(value.nodeId, 'request.nodeId');
  const agentId = optionalString(value.agentId, 'request.agentId');
  const sessionKey = optionalString(value.sessionKey, 'request.sessionKey');
  const warningText = optionalString(value.warningText, 'request.warningText');
  if (commandPreview) request.commandPreview = commandPreview;
  if (cwd) request.cwd = cwd;
  if (host) request.host = host;
  if (nodeId) request.nodeId = nodeId;
  if (agentId) request.agentId = agentId;
  if (sessionKey) request.sessionKey = sessionKey;
  if (warningText) request.warningText = warningText;
  return request;
}

function parsePluginRequest(value: unknown): PluginApprovalRequest {
  if (!isRecord(value)) throw new Error('OpenClaw plugin approval returned an invalid request');
  const request: PluginApprovalRequest = {
    title: requiredString(value.title, 'request.title'),
    description: requiredString(value.description, 'request.description'),
    allowedDecisions: decisions(value.allowedDecisions, 'request.allowedDecisions', true),
  };
  const severity = value.severity === undefined || value.severity === null
    ? undefined
    : value.severity;
  if (severity !== undefined && (typeof severity !== 'string' || !PLUGIN_SEVERITIES.includes(severity as PluginApprovalSeverity))) {
    throw new Error('OpenClaw plugin approval returned an invalid request.severity');
  }
  const pluginId = optionalString(value.pluginId, 'request.pluginId');
  const toolName = optionalString(value.toolName, 'request.toolName');
  const toolCallId = optionalString(value.toolCallId, 'request.toolCallId');
  const agentId = optionalString(value.agentId, 'request.agentId');
  const sessionKey = optionalString(value.sessionKey, 'request.sessionKey');
  if (severity !== undefined) request.severity = severity as PluginApprovalSeverity;
  if (pluginId) request.pluginId = pluginId;
  if (toolName) request.toolName = toolName;
  if (toolCallId) request.toolCallId = toolCallId;
  if (agentId) request.agentId = agentId;
  if (sessionKey) request.sessionKey = sessionKey;
  return request;
}

function parseRecord(value: unknown, kind: ApprovalKind): ApprovalRecord {
  if (!isRecord(value)) throw new Error(`OpenClaw ${kind} approval returned an invalid record`);
  const base = {
    id: requiredString(value.id, 'id'),
    kind,
    createdAtMs: timestamp(value.createdAtMs, 'createdAtMs'),
    expiresAtMs: timestamp(value.expiresAtMs, 'expiresAtMs'),
  } as const;
  return kind === 'exec'
    ? { ...base, kind, request: parseExecRequest(value.request) }
    : { ...base, kind, request: parsePluginRequest(value.request) };
}

export function parseApprovalList(value: unknown, kind: ApprovalKind): ApprovalRecord[] {
  if (!Array.isArray(value)) throw new Error(`OpenClaw ${kind} approval list is invalid`);
  return value.map((entry) => parseRecord(entry, kind));
}

export function buildApprovalResolveParams(id: string, selectedDecision: ApprovalDecision): Record<string, unknown> {
  const normalizedId = id.trim();
  if (!normalizedId) throw new Error('OpenClaw approval resolve requires an id');
  return { id: normalizedId, decision: decision(selectedDecision, 'decision') };
}

export function parseApprovalResolveResult(value: unknown): ApprovalResolveResult {
  if (!isRecord(value) || value.ok !== true) {
    throw new Error('OpenClaw approval resolve was not confirmed');
  }
  return { ok: true };
}

function parseResolvedEvent(value: unknown, kind: ApprovalKind): ApprovalResolvedEvent {
  if (!isRecord(value)) throw new Error(`OpenClaw ${kind} approval resolved event is invalid`);
  const request = value.request === undefined
    ? undefined
    : kind === 'exec' ? parseExecRequest(value.request) : parsePluginRequest(value.request);
  const resolvedBy = optionalString(value.resolvedBy, 'resolvedBy');
  return {
    kind,
    id: requiredString(value.id, 'id'),
    decision: decision(value.decision, 'decision'),
    ...(resolvedBy ? { resolvedBy } : {}),
    ts: timestamp(value.ts, 'ts'),
    ...(request ? { request } : {}),
  };
}

export function parseGatewayApprovalEvent(value: unknown): GatewayApprovalEvent | null {
  if (!isRecord(value) || value.type !== 'event' || typeof value.event !== 'string') return null;
  const eventName = value.event;
  const kind: ApprovalKind | null = eventName.startsWith('exec.approval.')
    ? 'exec'
    : eventName.startsWith('plugin.approval.')
      ? 'plugin'
      : null;
  if (!kind) return null;
  if (eventName.endsWith('.requested')) {
    return { phase: 'requested', kind, record: parseRecord(value.payload, kind) };
  }
  if (eventName.endsWith('.resolved')) {
    return { phase: 'resolved', ...parseResolvedEvent(value.payload, kind) };
  }
  return null;
}

export interface ApprovalClientDependencies {
  requestPrivileged: ApprovalRequester;
}

export class OpenClawApprovalClient {
  constructor(private readonly deps: ApprovalClientDependencies) {}

  async list(): Promise<ApprovalRecord[]> {
    const [exec, plugin] = await Promise.all([
      this.deps.requestPrivileged('exec.approval.list', {}),
      this.deps.requestPrivileged('plugin.approval.list', {}),
    ]);
    return [
      ...parseApprovalList(exec, 'exec'),
      ...parseApprovalList(plugin, 'plugin'),
    ].sort((left, right) => right.createdAtMs - left.createdAtMs);
  }

  async resolve(record: ApprovalRecord, selectedDecision: ApprovalDecision): Promise<ApprovalResolveResult> {
    const method = record.kind === 'exec'
      ? 'exec.approval.resolve'
      : 'plugin.approval.resolve';
    return parseApprovalResolveResult(await this.deps.requestPrivileged(
      method,
      buildApprovalResolveParams(record.id, selectedDecision),
    ));
  }
}
