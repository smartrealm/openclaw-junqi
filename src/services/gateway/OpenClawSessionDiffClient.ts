import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
  GatewayRpcError,
} from './Connection';
import { requireOpenClawSessionTarget } from './OpenClawSessionTarget';

export const OPENCLAW_SESSIONS_DIFF_METHOD = 'sessions.diff' as const;

export type OpenClawSessionDiffStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface OpenClawSessionDiffFile {
  readonly path: string;
  readonly oldPath?: string;
  readonly status: OpenClawSessionDiffStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly binary?: boolean;
  readonly untracked?: boolean;
  readonly patch?: string;
  readonly truncated?: boolean;
}

export interface OpenClawSessionDiff {
  readonly sessionKey: string;
  readonly root?: string;
  readonly branch?: string;
  readonly baseRef?: string;
  readonly files: readonly OpenClawSessionDiffFile[];
  readonly additions: number;
  readonly deletions: number;
  readonly truncated?: boolean;
  readonly unavailableReason?: 'unknown_session' | 'not_git';
}

export interface OpenClawSessionDiffClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (
    method: string,
    params: Record<string, unknown>,
    connectionId: string,
  ) => Promise<unknown>;
}

export class OpenClawSessionDiffResponseError extends Error {
  readonly code = 'OPENCLAW_SESSION_DIFF_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid sessions.diff response');
    this.name = 'OpenClawSessionDiffResponseError';
  }
}

export class OpenClawSessionDiffUnavailableError extends Error {
  readonly code = 'OPENCLAW_SESSION_DIFF_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawSessionDiffUnavailableError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function optionalText(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return nonEmptyText(value);
}

function optionalBoolean(value: unknown): boolean | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'boolean' ? value : null;
}

function optionalUnavailableReason(
  value: unknown,
): OpenClawSessionDiff['unavailableReason'] | undefined | null {
  if (value === undefined) return undefined;
  if (value === 'unknown_session' || value === 'not_git') return value;
  return null;
}

function diffStatus(value: unknown): OpenClawSessionDiffStatus | null {
  switch (value) {
    case 'added':
    case 'modified':
    case 'deleted':
    case 'renamed':
      return value;
    default:
      return null;
  }
}

function parseFile(value: unknown): OpenClawSessionDiffFile {
  const source = record(value);
  const path = nonEmptyText(source?.path);
  const status = diffStatus(source?.status);
  const additions = nonNegativeInteger(source?.additions);
  const deletions = nonNegativeInteger(source?.deletions);
  const oldPath = optionalText(source?.oldPath);
  const binary = optionalBoolean(source?.binary);
  const untracked = optionalBoolean(source?.untracked);
  const truncated = optionalBoolean(source?.truncated);
  const patch = source?.patch;

  if (
    !source
    || !path
    || !status
    || additions === null
    || deletions === null
    || oldPath === null
    || binary === null
    || untracked === null
    || truncated === null
    || (patch !== undefined && typeof patch !== 'string')
  ) {
    throw new OpenClawSessionDiffResponseError();
  }

  return {
    path,
    status,
    additions,
    deletions,
    ...(oldPath === undefined ? {} : { oldPath }),
    ...(binary === undefined ? {} : { binary }),
    ...(untracked === undefined ? {} : { untracked }),
    ...(patch === undefined ? {} : { patch }),
    ...(truncated === undefined ? {} : { truncated }),
  };
}

export function parseOpenClawSessionDiff(
  value: unknown,
  expectedSessionKey: string,
): OpenClawSessionDiff {
  const source = record(value);
  const sessionKey = nonEmptyText(source?.sessionKey);
  const additions = nonNegativeInteger(source?.additions);
  const deletions = nonNegativeInteger(source?.deletions);
  const root = optionalText(source?.root);
  const branch = optionalText(source?.branch);
  const baseRef = optionalText(source?.baseRef);
  const truncated = optionalBoolean(source?.truncated);
  const unavailableReason = optionalUnavailableReason(source?.unavailableReason);

  if (
    !source
    || sessionKey !== expectedSessionKey
    || !Array.isArray(source.files)
    || additions === null
    || deletions === null
    || root === null
    || branch === null
    || baseRef === null
    || truncated === null
    || unavailableReason === null
  ) {
    throw new OpenClawSessionDiffResponseError();
  }

  return {
    sessionKey,
    files: source.files.map(parseFile),
    additions,
    deletions,
    ...(root === undefined ? {} : { root }),
    ...(branch === undefined ? {} : { branch }),
    ...(baseRef === undefined ? {} : { baseRef }),
    ...(truncated === undefined ? {} : { truncated }),
    ...(unavailableReason === undefined ? {} : { unavailableReason }),
  };
}

function optionalAgentId(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND'
      || error.code === 'UNKNOWN_METHOD'
      || error.code === 'UNKNOWN_COMMAND');
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

export class OpenClawSessionDiffClient {
  constructor(private readonly dependencies: OpenClawSessionDiffClientDependencies) {}

  async get(sessionKey: string, agentId?: string): Promise<OpenClawSessionDiff> {
    const key = requireOpenClawSessionTarget(sessionKey);
    const normalizedAgentId = optionalAgentId(agentId);
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) {
      throw new OpenClawSessionDiffUnavailableError(
        'No attested Gateway connection is available for session diff',
      );
    }

    try {
      const response = await this.dependencies.requestFenced(
        OPENCLAW_SESSIONS_DIFF_METHOD,
        { sessionKey: key, ...(normalizedAgentId ? { agentId: normalizedAgentId } : {}) },
        connectionId,
      );
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw new OpenClawSessionDiffUnavailableError(
          'Gateway connection changed while reading session diff',
        );
      }
      return parseOpenClawSessionDiff(response, key);
    } catch (error) {
      if (unsupportedMethod(error)) {
        throw new OpenClawSessionDiffUnavailableError(
          'The connected OpenClaw Gateway does not support sessions.diff',
        );
      }
      if (connectionUnavailable(error)) {
        throw new OpenClawSessionDiffUnavailableError(
          'No attested Gateway connection is available for session diff',
        );
      }
      throw error;
    }
  }
}
