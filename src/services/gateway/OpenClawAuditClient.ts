export const OPENCLAW_AUDIT_ACTIVITY_METHOD = 'audit.activity.list' as const;
export const OPENCLAW_AUDIT_LEGACY_METHOD = 'audit.list' as const;

export type OpenClawAuditStatus =
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'blocked'
  | 'unknown';

export type OpenClawAuditKind = 'agent_run' | 'tool_action' | 'message';
export type OpenClawAuditDirection = 'inbound' | 'outbound';
export type OpenClawAuditEventType =
  | 'agent_run'
  | 'tool_action'
  | 'inbound_message'
  | 'outbound_message';

export interface OpenClawAuditActor {
  readonly type: 'agent' | 'system' | 'channel_sender';
  readonly id: string;
}

export interface OpenClawAuditEvent {
  readonly source: 'activity' | 'legacy';
  readonly eventType?: OpenClawAuditEventType;
  readonly schemaVersion?: 1;
  readonly eventId: string;
  readonly sequence: number;
  readonly sourceSequence: number;
  readonly occurredAt: number;
  readonly kind: OpenClawAuditKind;
  readonly action: string;
  readonly status: OpenClawAuditStatus;
  readonly actor: OpenClawAuditActor;
  readonly redaction: 'metadata_only';
  readonly agentId?: string;
  readonly sessionKey?: string;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly direction?: OpenClawAuditDirection;
  readonly channel?: string;
  readonly conversationKind?: 'direct' | 'group' | 'channel' | 'unknown';
  readonly outcome?: string;
  readonly reasonCode?: string;
  readonly errorCode?: string;
  readonly failureStage?: 'platform_send' | 'queue' | 'unknown';
  readonly deliveryKind?: 'text' | 'media' | 'other';
  readonly durationMs?: number;
  readonly resultCount?: number;
  readonly accountRef?: string;
  readonly conversationRef?: string;
  readonly messageRef?: string;
  readonly targetRef?: string;
}

export interface OpenClawAuditListInput {
  readonly agentId?: string;
  readonly sessionKey?: string;
  readonly runId?: string;
  readonly kind?: OpenClawAuditKind;
  readonly status?: OpenClawAuditStatus;
  readonly direction?: OpenClawAuditDirection;
  readonly channel?: string;
  readonly after?: number;
  readonly before?: number;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface OpenClawAuditListPage {
  readonly events: readonly OpenClawAuditEvent[];
  readonly nextCursor?: string;
  readonly source: 'activity' | 'legacy';
}

export type OpenClawAuditRequester = <T>(method: string, params: Record<string, unknown>) => Promise<T>;
export type OpenClawAdvertisedMethodLookup = (method: string) => boolean | null;

export class OpenClawAuditUnsupportedError extends Error {
  readonly code = 'OPENCLAW_AUDIT_UNSUPPORTED';

  constructor() {
    super('The connected OpenClaw Gateway does not advertise an audit query method');
    this.name = 'OpenClawAuditUnsupportedError';
  }
}

export class OpenClawAuditResponseError extends Error {
  readonly code = 'OPENCLAW_AUDIT_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid audit response');
    this.name = 'OpenClawAuditResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredText(value: unknown, max = 2_048): string {
  if (typeof value !== 'string') throw new OpenClawAuditResponseError();
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new OpenClawAuditResponseError();
  return normalized;
}

function optionalText(value: unknown, max = 2_048): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, max);
}

function integer(value: unknown, minimum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new OpenClawAuditResponseError();
  }
  return value;
}

function optionalInteger(value: unknown, minimum: number): number | undefined {
  if (value === undefined) return undefined;
  return integer(value, minimum);
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new OpenClawAuditResponseError();
  }
  return value as T;
}

const STATUSES: readonly OpenClawAuditStatus[] = [
  'started', 'succeeded', 'failed', 'cancelled', 'timed_out', 'blocked', 'unknown',
];
const KINDS: readonly OpenClawAuditKind[] = ['agent_run', 'tool_action', 'message'];
const DIRECTIONS: readonly OpenClawAuditDirection[] = ['inbound', 'outbound'];
const ACTIVITY_EVENT_TYPES: readonly OpenClawAuditEventType[] = [
  'agent_run', 'tool_action', 'inbound_message', 'outbound_message',
];
const HMAC_REF_PATTERN = /^hmac-sha256:v1:[a-f0-9]{32}:[a-f0-9]{64}$/;

function parseActor(value: unknown, allowed: readonly OpenClawAuditActor['type'][]): OpenClawAuditActor {
  const source = record(value);
  if (!source) throw new OpenClawAuditResponseError();
  const type = oneOf(source.type, allowed);
  return { type, id: requiredText(source.id, 2_048) };
}

function parseCommon(source: Record<string, unknown>): {
  eventId: string;
  sequence: number;
  sourceSequence: number;
  occurredAt: number;
  kind: OpenClawAuditKind;
  action: string;
  status: OpenClawAuditStatus;
  redaction: 'metadata_only';
} {
  return {
    eventId: requiredText(source.eventId),
    sequence: integer(source.sequence, 1),
    sourceSequence: integer(source.sourceSequence, 1),
    occurredAt: integer(source.occurredAt, 0),
    kind: oneOf(source.kind, KINDS),
    action: requiredText(source.action, 256),
    status: oneOf(source.status, STATUSES),
    redaction: oneOf(source.redaction, ['metadata_only'] as const),
  };
}

function validateAgentTerminal(
  action: string,
  status: OpenClawAuditStatus,
  errorCode: string | undefined,
  kind: 'agent_run' | 'tool_action',
): void {
  const prefix = kind === 'agent_run' ? 'agent.run' : 'tool.action';
  const actionStarted = `${prefix}.started`;
  const actionFinished = `${prefix}.finished`;
  if (action === actionStarted) {
    if (status !== 'started' || errorCode !== undefined) throw new OpenClawAuditResponseError();
    return;
  }
  if (action !== actionFinished) throw new OpenClawAuditResponseError();
  const expected = kind === 'agent_run'
    ? ({
        succeeded: undefined,
        failed: 'run_failed',
        cancelled: 'run_cancelled',
        timed_out: 'run_timed_out',
        blocked: 'run_blocked',
      } as const)
    : ({
        succeeded: undefined,
        failed: 'tool_failed',
        cancelled: 'tool_cancelled',
        timed_out: 'tool_timed_out',
        blocked: 'tool_blocked',
        unknown: 'tool_outcome_unknown',
      } as const);
  if (!(status in expected) || expected[status as keyof typeof expected] !== errorCode) {
    throw new OpenClawAuditResponseError();
  }
}

function parseActivityEvent(value: unknown): OpenClawAuditEvent {
  const source = record(value);
  if (!source) throw new OpenClawAuditResponseError();
  const common = parseCommon(source);
  if (source.schemaVersion !== 1) throw new OpenClawAuditResponseError();
  const eventType = oneOf(source.eventType, ACTIVITY_EVENT_TYPES);

  if (eventType === 'agent_run' || eventType === 'tool_action') {
    const kind = eventType === 'agent_run' ? 'agent_run' : 'tool_action';
    if (common.kind !== kind) throw new OpenClawAuditResponseError();
    const actor = parseActor(source.actor, ['agent', 'system']);
    const agentId = requiredText(source.agentId);
    const runId = requiredText(source.runId);
    const errorCode = optionalText(source.errorCode, 128);
    validateAgentTerminal(common.action, common.status, errorCode, kind);
    const toolCallId = eventType === 'tool_action' ? optionalText(source.toolCallId) : undefined;
    const toolName = eventType === 'tool_action' ? optionalText(source.toolName) : undefined;
    return {
      source: 'activity',
      eventType,
      schemaVersion: 1,
      ...common,
      actor,
      agentId,
      runId,
      ...(optionalText(source.sessionKey) ? { sessionKey: optionalText(source.sessionKey) } : {}),
      ...(optionalText(source.sessionId) ? { sessionId: optionalText(source.sessionId) } : {}),
      ...(toolCallId ? { toolCallId } : {}),
      ...(toolName ? { toolName } : {}),
      ...(errorCode ? { errorCode } : {}),
    };
  }

  if (common.kind !== 'message') throw new OpenClawAuditResponseError();
  const direction = eventType === 'inbound_message' ? 'inbound' : 'outbound';
  if (source.direction !== direction) throw new OpenClawAuditResponseError();
  const actor = parseActor(
    source.actor,
    eventType === 'inbound_message' ? ['channel_sender', 'system'] : ['agent', 'system'],
  );
  if (actor.type === 'channel_sender' && !HMAC_REF_PATTERN.test(actor.id)) {
    throw new OpenClawAuditResponseError();
  }
  for (const field of ['sessionKey', 'sessionId', 'toolCallId', 'toolName'] as const) {
    if (source[field] !== undefined) throw new OpenClawAuditResponseError();
  }
  const outcome = requiredText(source.outcome, 128);
  const conversationKind = oneOf(source.conversationKind, ['direct', 'group', 'channel', 'unknown'] as const);
  const status = common.status;
  const errorCode = optionalText(source.errorCode, 128);
  const reasonCode = optionalText(source.reasonCode, 128);
  const failureStage = source.failureStage === undefined
    ? undefined
    : oneOf(source.failureStage, ['platform_send', 'queue', 'unknown'] as const);
  const deliveryKind = source.deliveryKind === undefined
    ? undefined
    : oneOf(source.deliveryKind, ['text', 'media', 'other'] as const);
  const durationMs = optionalInteger(source.durationMs, 0);
  const resultCount = optionalInteger(source.resultCount, 0);
  const identityRefs = ['accountRef', 'conversationRef', 'messageRef', 'targetRef'].reduce<Record<string, string>>((refs, field) => {
    const value = source[field];
    if (value !== undefined) {
      const normalized = requiredText(value, 256);
      if (!HMAC_REF_PATTERN.test(normalized)) throw new OpenClawAuditResponseError();
      refs[field] = normalized;
    }
    return refs;
  }, {});
  const messageOutcomeValid = eventType === 'inbound_message'
    ? (status === 'succeeded' && outcome === 'completed')
      || (status === 'blocked' && outcome === 'skipped')
      || (status === 'failed' && outcome === 'failed' && errorCode === 'message_processing_failed')
    : (status === 'succeeded' && outcome === 'sent')
      || (status === 'blocked' && outcome === 'suppressed' && Boolean(reasonCode))
      || (status === 'failed' && outcome === 'failed' && Boolean(errorCode) && Boolean(failureStage))
      || (status === 'unknown' && outcome === 'unknown' && Boolean(failureStage));
  if (!messageOutcomeValid) throw new OpenClawAuditResponseError();
  if (eventType === 'inbound_message') {
    if (status === 'succeeded' && (errorCode !== undefined || ![
      'fast_abort', 'plugin_bound_handled', 'plugin_bound_unavailable', 'plugin_bound_declined',
      'before_dispatch_handled', 'acp_dispatch_completed', 'acp_dispatch_empty', undefined,
    ].includes(reasonCode))) throw new OpenClawAuditResponseError();
    if (status === 'blocked' && (errorCode !== undefined || ![
      'duplicate', 'reply_operation_active', 'reply_operation_aborted', 'acp_dispatch_aborted', undefined,
    ].includes(reasonCode))) throw new OpenClawAuditResponseError();
    if (status === 'failed' && (errorCode !== 'message_processing_failed'
      || (reasonCode !== undefined && !['acp_dispatch_failed', 'plugin_bound_error'].includes(reasonCode)))) {
      throw new OpenClawAuditResponseError();
    }
  }
  if (eventType === 'outbound_message') {
    if (status === 'succeeded' && (errorCode !== undefined || reasonCode !== undefined || failureStage !== undefined)) {
      throw new OpenClawAuditResponseError();
    }
    if (status === 'blocked' && (![
      'cancelled_by_message_sending_hook',
      'cancelled_by_reply_payload_sending_hook',
      'empty_after_message_sending_hook',
      'empty_after_reply_payload_sending_hook',
      'no_visible_payload',
    ].includes(reasonCode || '') || errorCode !== undefined || failureStage !== undefined || deliveryKind !== undefined)) {
      throw new OpenClawAuditResponseError();
    }
    if (status === 'failed' && (!errorCode || !['message_delivery_failed', 'message_delivery_partial_failure'].includes(errorCode)
      || !failureStage || reasonCode !== undefined)) throw new OpenClawAuditResponseError();
    if (status === 'unknown' && (errorCode !== undefined || reasonCode !== undefined || deliveryKind !== undefined || !failureStage)) {
      throw new OpenClawAuditResponseError();
    }
  }
  if (eventType === 'inbound_message' && (failureStage !== undefined || deliveryKind !== undefined)) {
    throw new OpenClawAuditResponseError();
  }
  if (eventType === 'outbound_message' && reasonCode && status !== 'blocked') {
    throw new OpenClawAuditResponseError();
  }
  if (eventType === 'outbound_message' && status === 'blocked' && deliveryKind !== undefined) {
    throw new OpenClawAuditResponseError();
  }
  return {
    source: 'activity',
    eventType,
    schemaVersion: 1,
    ...common,
    actor,
    direction,
    channel: requiredText(source.channel, 256),
    conversationKind,
    outcome,
    ...(optionalText(source.agentId) ? { agentId: optionalText(source.agentId) } : {}),
    ...(optionalText(source.runId) ? { runId: optionalText(source.runId) } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(resultCount !== undefined ? { resultCount } : {}),
    ...(reasonCode ? { reasonCode } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(failureStage ? { failureStage } : {}),
    ...(deliveryKind ? { deliveryKind } : {}),
    ...(identityRefs.accountRef ? { accountRef: identityRefs.accountRef } : {}),
    ...(identityRefs.conversationRef ? { conversationRef: identityRefs.conversationRef } : {}),
    ...(identityRefs.messageRef ? { messageRef: identityRefs.messageRef } : {}),
    ...(identityRefs.targetRef ? { targetRef: identityRefs.targetRef } : {}),
  };
}

function parseLegacyEvent(value: unknown): OpenClawAuditEvent {
  const source = record(value);
  if (!source) throw new OpenClawAuditResponseError();
  const common = parseCommon(source);
  if (common.kind !== 'agent_run' && common.kind !== 'tool_action') {
    throw new OpenClawAuditResponseError();
  }
  const actor = parseActor(source.actor, ['agent', 'system']);
  const agentId = requiredText(source.agentId);
  const runId = requiredText(source.runId);
  const errorCode = optionalText(source.errorCode, 128);
  validateAgentTerminal(common.action, common.status, errorCode, common.kind);
  const toolCallId = common.kind === 'tool_action' ? optionalText(source.toolCallId) : undefined;
  const toolName = common.kind === 'tool_action' ? optionalText(source.toolName) : undefined;
  return {
    source: 'legacy',
    ...common,
    actor,
    agentId,
    runId,
    ...(optionalText(source.sessionKey) ? { sessionKey: optionalText(source.sessionKey) } : {}),
    ...(optionalText(source.sessionId) ? { sessionId: optionalText(source.sessionId) } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolName ? { toolName } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
}

function parsePage(
  value: unknown,
  sourceName: OpenClawAuditListPage['source'],
  parseEvent: (event: unknown) => OpenClawAuditEvent,
): OpenClawAuditListPage {
  const source = record(value);
  if (!source || !Array.isArray(source.events)) throw new OpenClawAuditResponseError();
  const nextCursor = optionalText(source.nextCursor);
  return {
    source: sourceName,
    events: source.events.map(parseEvent),
    ...(nextCursor ? { nextCursor } : {}),
  };
}

function requestParams(input: OpenClawAuditListInput, allowMessageFilters: boolean): Record<string, unknown> {
  const textInput = (value: string | undefined, name: string, max = 2_048): string | undefined => {
    if (value === undefined) return undefined;
    const normalized = value.trim();
    if (!normalized || normalized.length > max) throw new Error(`Invalid OpenClaw audit ${name}`);
    return normalized;
  };
  const agentId = textInput(input.agentId, 'agent id');
  const sessionKey = textInput(input.sessionKey, 'session key');
  const runId = textInput(input.runId, 'run id');
  const channel = textInput(input.channel, 'channel', 256);
  if (!allowMessageFilters && (input.kind === 'message' || input.direction !== undefined || channel !== undefined)) {
    throw new OpenClawAuditUnsupportedError();
  }
  if (input.kind !== undefined && !KINDS.includes(input.kind)) throw new Error('Invalid OpenClaw audit kind');
  if (input.status !== undefined && !STATUSES.includes(input.status)) throw new Error('Invalid OpenClaw audit status');
  if (input.direction !== undefined && !DIRECTIONS.includes(input.direction)) throw new Error('Invalid OpenClaw audit direction');
  for (const value of [input.after, input.before]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new Error('Invalid OpenClaw audit time bound');
  }
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500)) {
    throw new Error('Invalid OpenClaw audit limit');
  }
  const cursor = textInput(input.cursor, 'cursor');
  return {
    ...(agentId ? { agentId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(runId ? { runId } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.direction ? { direction: input.direction } : {}),
    ...(channel ? { channel } : {}),
    ...(input.after !== undefined ? { after: input.after } : {}),
    ...(input.before !== undefined ? { before: input.before } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

export function parseOpenClawAuditActivityPage(value: unknown): OpenClawAuditListPage {
  return parsePage(value, 'activity', parseActivityEvent);
}

export function parseOpenClawAuditLegacyPage(value: unknown): OpenClawAuditListPage {
  return parsePage(value, 'legacy', parseLegacyEvent);
}

export class OpenClawAuditClient {
  constructor(
    private readonly request: OpenClawAuditRequester,
    private readonly hasAdvertisedMethod: OpenClawAdvertisedMethodLookup = () => null,
  ) {}

  async list(input: OpenClawAuditListInput = {}): Promise<OpenClawAuditListPage> {
    const activityCapability = this.hasAdvertisedMethod(OPENCLAW_AUDIT_ACTIVITY_METHOD);
    const legacyCapability = this.hasAdvertisedMethod(OPENCLAW_AUDIT_LEGACY_METHOD);
    const activityParams = requestParams(input, true);
    const requiresActivity = input.kind === 'message' || input.direction !== undefined || input.channel !== undefined;

    if (activityCapability === true) {
      return parseOpenClawAuditActivityPage(await this.request(OPENCLAW_AUDIT_ACTIVITY_METHOD, activityParams));
    }
    if (activityCapability === false && legacyCapability === false) {
      throw new OpenClawAuditUnsupportedError();
    }
    if (activityCapability === false && requiresActivity) {
      throw new OpenClawAuditUnsupportedError();
    }
    const legacyParams = requestParams(input, false);
    if (legacyCapability === false) throw new OpenClawAuditUnsupportedError();
    return parseOpenClawAuditLegacyPage(await this.request(OPENCLAW_AUDIT_LEGACY_METHOD, legacyParams));
  }
}
