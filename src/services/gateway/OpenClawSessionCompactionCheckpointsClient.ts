import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
} from './Connection';
import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';
import { resolveOpenClawSessionTarget } from './OpenClawSessionTarget';

export const OPENCLAW_COMPACTION_CHECKPOINT_LIST_METHOD = 'sessions.compaction.list' as const;

const CHECKPOINT_REASONS = ['manual', 'auto-threshold', 'overflow-retry', 'timeout-retry'] as const;

export type OpenClawCompactionCheckpointReason = typeof CHECKPOINT_REASONS[number];

export interface OpenClawCompactionTranscriptReference {
  readonly sessionId: string;
  readonly sessionFile?: string;
  readonly leafId?: string;
  readonly entryId?: string;
}

export interface OpenClawCompactionCheckpoint {
  readonly checkpointId: string;
  readonly sessionKey: string;
  readonly sessionId: string;
  readonly createdAt: number;
  readonly reason: OpenClawCompactionCheckpointReason;
  readonly tokensBefore?: number;
  readonly tokensAfter?: number;
  readonly summary?: string;
  readonly firstKeptEntryId?: string;
  readonly preCompaction: OpenClawCompactionTranscriptReference;
  readonly postCompaction: OpenClawCompactionTranscriptReference;
}

export interface OpenClawCompactionCheckpointClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
}

export class OpenClawCompactionCheckpointsUnavailableError extends Error {
  readonly code = 'OPENCLAW_COMPACTION_CHECKPOINTS_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawCompactionCheckpointsUnavailableError';
  }
}

export class OpenClawCompactionCheckpointsResponseError extends Error {
  readonly code = 'OPENCLAW_COMPACTION_CHECKPOINTS_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid compaction checkpoint response');
    this.name = 'OpenClawCompactionCheckpointsResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const parsed = nonEmptyString(value);
  if (!parsed) throw new OpenClawCompactionCheckpointsResponseError();
  return parsed;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseReference(value: unknown): OpenClawCompactionTranscriptReference {
  const source = record(value);
  const sessionId = nonEmptyString(source?.sessionId);
  if (!source || !sessionId) throw new OpenClawCompactionCheckpointsResponseError();
  return {
    sessionId,
    ...(optionalString(source.sessionFile) ? { sessionFile: optionalString(source.sessionFile) } : {}),
    ...(optionalString(source.leafId) ? { leafId: optionalString(source.leafId) } : {}),
    ...(optionalString(source.entryId) ? { entryId: optionalString(source.entryId) } : {}),
  };
}

function parseCheckpoint(value: unknown): OpenClawCompactionCheckpoint {
  const source = record(value);
  const checkpointId = nonEmptyString(source?.checkpointId);
  const sessionKey = nonEmptyString(source?.sessionKey);
  const sessionId = nonEmptyString(source?.sessionId);
  const createdAt = nonNegativeInteger(source?.createdAt);
  const reason = typeof source?.reason === 'string' && CHECKPOINT_REASONS.includes(source.reason as OpenClawCompactionCheckpointReason)
    ? source.reason as OpenClawCompactionCheckpointReason
    : null;
  if (!source || !checkpointId || !sessionKey || !sessionId || createdAt === null || !reason) {
    throw new OpenClawCompactionCheckpointsResponseError();
  }
  const tokensBefore = source.tokensBefore === undefined ? undefined : nonNegativeInteger(source.tokensBefore);
  const tokensAfter = source.tokensAfter === undefined ? undefined : nonNegativeInteger(source.tokensAfter);
  if (tokensBefore === null || tokensAfter === null || (source.summary !== undefined && typeof source.summary !== 'string')) {
    throw new OpenClawCompactionCheckpointsResponseError();
  }
  return {
    checkpointId,
    sessionKey,
    sessionId,
    createdAt,
    reason,
    ...(tokensBefore !== undefined ? { tokensBefore } : {}),
    ...(tokensAfter !== undefined ? { tokensAfter } : {}),
    ...(source.summary !== undefined ? { summary: source.summary } : {}),
    ...(optionalString(source.firstKeptEntryId) ? { firstKeptEntryId: optionalString(source.firstKeptEntryId) } : {}),
    preCompaction: parseReference(source.preCompaction),
    postCompaction: parseReference(source.postCompaction),
  };
}

function unavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

/** 只读取由 Gateway 持有的压缩检查点元数据。 */
export class OpenClawSessionCompactionCheckpointsClient {
  constructor(private readonly dependencies: OpenClawCompactionCheckpointClientDependencies) {}

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) throw new OpenClawCompactionCheckpointsUnavailableError('No attested Gateway connection is available');
    try {
      const response = await this.dependencies.requestFenced(method, params, connectionId);
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw new OpenClawCompactionCheckpointsUnavailableError('Gateway connection changed while reading compaction checkpoints');
      }
      return response;
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, method) || unavailable(error)) {
        throw new OpenClawCompactionCheckpointsUnavailableError('Compaction checkpoints are unavailable from the current OpenClaw Gateway');
      }
      throw error;
    }
  }

  async list(sessionKey: string): Promise<readonly OpenClawCompactionCheckpoint[]> {
    const target = resolveOpenClawSessionTarget(sessionKey);
    const source = record(await this.request(OPENCLAW_COMPACTION_CHECKPOINT_LIST_METHOD, {
      key: target.key,
      ...(target.agentId ? { agentId: target.agentId } : {}),
    }));
    if (!source || source.ok !== true || nonEmptyString(source.key) !== target.key || !Array.isArray(source.checkpoints)) {
      throw new OpenClawCompactionCheckpointsResponseError();
    }
    return source.checkpoints.map(parseCheckpoint);
  }
}
