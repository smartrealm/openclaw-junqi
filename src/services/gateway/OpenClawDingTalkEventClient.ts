import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
} from './Connection';
import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';

export const OPENCLAW_DINGTALK_EVENT_SNAPSHOT_METHOD = 'junqi.dingtalk.events.snapshot' as const;

export type OpenClawDingTalkEventPhase =
  | 'disabled'
  | 'starting'
  | 'running'
  | 'degraded'
  | 'stopping'
  | 'stopped';

export interface OpenClawDingTalkEventRecord {
  readonly sequence: number;
  readonly receivedAt: string;
  readonly eventType: string;
}

export interface OpenClawDingTalkEventSnapshot {
  readonly runtimeGeneration: string;
  readonly configurationDigest: string;
  readonly configured: boolean;
  readonly phase: OpenClawDingTalkEventPhase;
  readonly profileRef: string | null;
  readonly subscriptionCount: number;
  readonly activeConsumerCount: number;
  readonly readyConsumerCount: number;
  readonly eventKeys: readonly string[];
  readonly contractDigest: string | null;
  readonly latestSequence: number;
  readonly oldestSequence: number | null;
  readonly droppedCount: number;
  readonly rejectedCount: number;
  readonly lastErrorCode: string | null;
  readonly events: readonly OpenClawDingTalkEventRecord[];
}

export interface OpenClawDingTalkEventClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (
    method: string,
    params: Record<string, unknown>,
    connectionId: string,
  ) => Promise<unknown>;
}

export class OpenClawDingTalkEventUnavailableError extends Error {
  readonly code = 'OPENCLAW_DINGTALK_EVENT_SNAPSHOT_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawDingTalkEventUnavailableError';
  }
}

export class OpenClawDingTalkEventResponseError extends Error {
  readonly code = 'OPENCLAW_DINGTALK_EVENT_SNAPSHOT_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid DingTalk event snapshot');
    this.name = 'OpenClawDingTalkEventResponseError';
  }
}

const PHASES: readonly OpenClawDingTalkEventPhase[] = [
  'disabled',
  'starting',
  'running',
  'degraded',
  'stopping',
  'stopped',
];
const SNAPSHOT_KEYS = new Set([
  'runtimeGeneration',
  'configurationDigest',
  'configured',
  'phase',
  'profileRef',
  'subscriptionCount',
  'activeConsumerCount',
  'readyConsumerCount',
  'eventKeys',
  'contractDigest',
  'latestSequence',
  'oldestSequence',
  'droppedCount',
  'rejectedCount',
  'lastErrorCode',
  'events',
]);
const EVENT_KEYS = new Set(['sequence', 'receivedAt', 'eventType']);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeInteger(value: unknown, minimum = 0): number | null {
  return Number.isSafeInteger(value) && Number(value) >= minimum ? Number(value) : null;
}

function exactString(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length > maximum) return null;
  const normalized = value.trim();
  return normalized && normalized === value ? normalized : null;
}

function nullableString(value: unknown, maximum: number): string | null | undefined {
  if (value === null) return null;
  return exactString(value, maximum) ?? undefined;
}

function parseEvent(value: unknown): OpenClawDingTalkEventRecord {
  const source = record(value);
  if (!source || Object.keys(source).some((key) => !EVENT_KEYS.has(key))) {
    throw new OpenClawDingTalkEventResponseError();
  }
  const sequence = safeInteger(source.sequence, 1);
  const receivedAt = exactString(source.receivedAt, 64);
  const eventType = exactString(source.eventType, 256);
  if (
    sequence === null
    || !receivedAt
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(receivedAt)
    || !eventType
  ) {
    throw new OpenClawDingTalkEventResponseError();
  }
  return { sequence, receivedAt, eventType };
}

/** 只接受插件定义的闭合操作员投影，不读取事件业务载荷。 */
export function parseOpenClawDingTalkEventSnapshot(
  value: unknown,
  afterSequence = 0,
): OpenClawDingTalkEventSnapshot {
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
    throw new OpenClawDingTalkEventResponseError();
  }
  const source = record(value);
  if (!source || Object.keys(source).some((key) => !SNAPSHOT_KEYS.has(key))) {
    throw new OpenClawDingTalkEventResponseError();
  }
  const phase = typeof source.phase === 'string'
    && PHASES.includes(source.phase as OpenClawDingTalkEventPhase)
    ? source.phase as OpenClawDingTalkEventPhase
    : null;
  const runtimeGeneration = exactString(source.runtimeGeneration, 36);
  const configurationDigest = typeof source.configurationDigest === 'string'
    && /^[a-f0-9]{64}$/u.test(source.configurationDigest)
    ? source.configurationDigest
    : null;
  const profileRef = nullableString(source.profileRef, 512);
  const contractDigest = source.contractDigest === null
    ? null
    : typeof source.contractDigest === 'string' && /^[a-f0-9]{64}$/u.test(source.contractDigest)
      ? source.contractDigest
      : undefined;
  const lastErrorCode = nullableString(source.lastErrorCode, 128);
  const subscriptionCount = safeInteger(source.subscriptionCount);
  const activeConsumerCount = safeInteger(source.activeConsumerCount);
  const readyConsumerCount = safeInteger(source.readyConsumerCount);
  const latestSequence = safeInteger(source.latestSequence);
  const oldestSequence = source.oldestSequence === null
    ? null
    : safeInteger(source.oldestSequence, 1);
  const droppedCount = safeInteger(source.droppedCount);
  const rejectedCount = safeInteger(source.rejectedCount);
  if (
    typeof source.configured !== 'boolean'
    || !runtimeGeneration
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(runtimeGeneration)
    || !configurationDigest
    || !phase
    || profileRef === undefined
    || contractDigest === undefined
    || lastErrorCode === undefined
    || subscriptionCount === null
    || subscriptionCount > 8
    || activeConsumerCount === null
    || activeConsumerCount > subscriptionCount
    || readyConsumerCount === null
    || readyConsumerCount > activeConsumerCount
    || latestSequence === null
    || oldestSequence === undefined
    || (oldestSequence !== null && oldestSequence > latestSequence)
    || droppedCount === null
    || rejectedCount === null
    || !Array.isArray(source.eventKeys)
    || source.eventKeys.length > 27
    || !Array.isArray(source.events)
    || source.events.length > 20
  ) {
    throw new OpenClawDingTalkEventResponseError();
  }
  const eventKeys = source.eventKeys.map((eventKey) => exactString(eventKey, 256));
  if (eventKeys.some((eventKey) => eventKey === null) || new Set(eventKeys).size !== eventKeys.length) {
    throw new OpenClawDingTalkEventResponseError();
  }
  const normalizedEventKeys = eventKeys as string[];
  const events = source.events.map(parseEvent);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (
      event.sequence <= afterSequence
      || event.sequence > latestSequence
      || !normalizedEventKeys.includes(event.eventType)
      || (index > 0 && event.sequence <= events[index - 1]!.sequence)
    ) {
      throw new OpenClawDingTalkEventResponseError();
    }
  }
  const configuredByIdentity = profileRef !== null && subscriptionCount > 0;
  if (
    source.configured !== configuredByIdentity
    || (subscriptionCount === 0 && normalizedEventKeys.length > 0)
    || (subscriptionCount > 0 && normalizedEventKeys.length === 0)
    || (!source.configured && (activeConsumerCount > 0 || readyConsumerCount > 0))
    || (latestSequence === 0) !== (oldestSequence === null)
    || (events.length > 0 && oldestSequence !== null && oldestSequence > events[0]!.sequence)
    || (latestSequence > afterSequence && (
      events.length === 0
      || events[events.length - 1]!.sequence !== latestSequence
    ))
  ) {
    throw new OpenClawDingTalkEventResponseError();
  }
  return {
    runtimeGeneration,
    configurationDigest,
    configured: source.configured,
    phase,
    profileRef,
    subscriptionCount,
    activeConsumerCount,
    readyConsumerCount,
    eventKeys: normalizedEventKeys,
    contractDigest,
    latestSequence,
    oldestSequence,
    droppedCount,
    rejectedCount,
    lastErrorCode,
    events,
  };
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

export class OpenClawDingTalkEventClient {
  constructor(private readonly dependencies: OpenClawDingTalkEventClientDependencies) {}

  async get(afterSequence = 0, limit = 20): Promise<OpenClawDingTalkEventSnapshot> {
    if (
      !Number.isSafeInteger(afterSequence)
      || afterSequence < 0
      || !Number.isSafeInteger(limit)
      || limit < 1
      || limit > 20
    ) {
      throw new Error('Invalid DingTalk event snapshot request');
    }
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId || !this.dependencies.isConnectionCurrent(connectionId)) {
      throw this.unavailable('No attested Gateway connection is available for DingTalk events');
    }
    try {
      const response = await this.dependencies.requestFenced(
        OPENCLAW_DINGTALK_EVENT_SNAPSHOT_METHOD,
        { afterSequence, limit },
        connectionId,
      );
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw this.unavailable('Gateway connection changed while reading DingTalk events');
      }
      return parseOpenClawDingTalkEventSnapshot(response, afterSequence);
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, OPENCLAW_DINGTALK_EVENT_SNAPSHOT_METHOD)) {
        throw this.unavailable('The connected DingTalk plugin does not support event snapshots');
      }
      if (connectionUnavailable(error)) {
        throw this.unavailable('No attested Gateway connection is available for DingTalk events');
      }
      throw error;
    }
  }

  private unavailable(message: string): OpenClawDingTalkEventUnavailableError {
    return new OpenClawDingTalkEventUnavailableError(message);
  }
}
