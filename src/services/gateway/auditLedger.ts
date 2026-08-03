export const AUDIT_KINDS = ['agent_run', 'tool_action'] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

export const AUDIT_STATUSES = [
  'started',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'blocked',
  'unknown',
] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export interface OpenClawAuditEvent {
  eventId: string;
  sequence: number;
  sourceSequence: number;
  occurredAt: number;
  kind: AuditKind;
  action: 'agent.run.started' | 'agent.run.finished' | 'tool.action.started' | 'tool.action.finished';
  status: AuditStatus;
  errorCode?: string;
  actor: { type: 'agent' | 'system'; id: string };
  agentId: string;
  sessionKey?: string;
  sessionId?: string;
  runId: string;
  toolCallId?: string;
  toolName?: string;
  redaction: 'metadata_only';
}

export interface AuditListParams {
  agentId?: string;
  sessionKey?: string;
  runId?: string;
  kind?: AuditKind;
  status?: AuditStatus;
  after?: number;
  before?: number;
  limit?: number;
  cursor?: string;
}

export interface AuditListPage {
  events: OpenClawAuditEvent[];
  nextCursor?: string;
}

interface AuditRequester {
  (method: string, params: Record<string, unknown>): Promise<unknown>;
}

const AUDIT_ACTIONS = [
  'agent.run.started',
  'agent.run.finished',
  'tool.action.started',
  'tool.action.finished',
] as const;
const ACTOR_TYPES = ['agent', 'system'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`audit.list returned an invalid ${field}`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return nonEmptyString(value, field);
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`audit.list returned an invalid ${field}`);
  }
  return value;
}

function oneOf<const T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(`audit.list returned an invalid ${field}`);
  }
  return value as T[number];
}

function parseAuditEvent(value: unknown): OpenClawAuditEvent {
  if (!isRecord(value)) throw new Error('audit.list returned an invalid event');
  const actor = value.actor;
  if (!isRecord(actor)) throw new Error('audit.list returned an invalid actor');
  return {
    eventId: nonEmptyString(value.eventId, 'eventId'),
    sequence: integer(value.sequence, 'sequence'),
    sourceSequence: integer(value.sourceSequence, 'sourceSequence'),
    occurredAt: integer(value.occurredAt, 'occurredAt'),
    kind: oneOf(value.kind, AUDIT_KINDS, 'kind'),
    action: oneOf(value.action, AUDIT_ACTIONS, 'action'),
    status: oneOf(value.status, AUDIT_STATUSES, 'status'),
    ...(value.errorCode !== undefined ? { errorCode: nonEmptyString(value.errorCode, 'errorCode') } : {}),
    actor: {
      type: oneOf(actor.type, ACTOR_TYPES, 'actor.type'),
      id: nonEmptyString(actor.id, 'actor.id'),
    },
    agentId: nonEmptyString(value.agentId, 'agentId'),
    ...(value.sessionKey !== undefined ? { sessionKey: optionalString(value.sessionKey, 'sessionKey') } : {}),
    ...(value.sessionId !== undefined ? { sessionId: optionalString(value.sessionId, 'sessionId') } : {}),
    runId: nonEmptyString(value.runId, 'runId'),
    ...(value.toolCallId !== undefined ? { toolCallId: optionalString(value.toolCallId, 'toolCallId') } : {}),
    ...(value.toolName !== undefined ? { toolName: optionalString(value.toolName, 'toolName') } : {}),
    redaction: value.redaction === 'metadata_only'
      ? 'metadata_only'
      : (() => { throw new Error('audit.list returned an invalid redaction marker'); })(),
  };
}

export function parseAuditListPage(value: unknown): AuditListPage {
  if (!isRecord(value) || !Array.isArray(value.events) || value.events.length > 500) {
    throw new Error('audit.list returned an invalid page');
  }
  const nextCursor = value.nextCursor === undefined
    ? undefined
    : nonEmptyString(value.nextCursor, 'nextCursor');
  return {
    events: value.events.map(parseAuditEvent),
    ...(nextCursor ? { nextCursor } : {}),
  };
}

/** Returns the authoritative terminal status for the exact agent run, when present. */
export function latestAgentRunTerminalStatus(
  events: readonly OpenClawAuditEvent[],
): AuditStatus | null {
  let latest: OpenClawAuditEvent | undefined;
  for (const event of events) {
    if (event.kind !== 'agent_run' || event.action !== 'agent.run.finished') continue;
    if (event.status === 'started') continue;
    if (!latest || event.sequence > latest.sequence) latest = event;
  }
  return latest?.status ?? null;
}

export async function listAuditEvents(
  request: AuditRequester,
  params: AuditListParams,
): Promise<AuditListPage> {
  const runId = params.runId?.trim();
  if (!runId) throw new Error('audit.list requires a runId for trace projection');
  return requestAuditPage(request, { ...params, runId });
}

/** Query the bounded cross-run audit ledger without inventing a run identity. */
export async function listAuditLedger(
  request: AuditRequester,
  params: AuditListParams = {},
): Promise<AuditListPage> {
  return requestAuditPage(request, params);
}

async function requestAuditPage(
  request: AuditRequester,
  params: AuditListParams,
): Promise<AuditListPage> {
  const runId = params.runId?.trim();
  const result = await request('audit.list', {
    ...(params.agentId?.trim() ? { agentId: params.agentId.trim() } : {}),
    ...(params.sessionKey?.trim() ? { sessionKey: params.sessionKey.trim() } : {}),
    ...(runId ? { runId } : {}),
    ...(params.kind ? { kind: params.kind } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.after !== undefined ? { after: params.after } : {}),
    ...(params.before !== undefined ? { before: params.before } : {}),
    limit: Math.min(Math.max(Math.floor(params.limit ?? 100), 1), 500),
    ...(params.cursor?.trim() ? { cursor: params.cursor.trim() } : {}),
  });
  return parseAuditListPage(result);
}
