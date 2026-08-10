import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
} from './Connection';
import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';

export const OPENCLAW_AGENT_WAIT_METHOD = 'agent.wait' as const;

const TERMINAL_STATUSES = ['ok', 'error'] as const;
const WAIT_STATUSES = [...TERMINAL_STATUSES, 'timeout'] as const;

export type OpenClawAgentWaitStatus = typeof WAIT_STATUSES[number];

export interface OpenClawAgentWaitResult {
  readonly runId: string;
  readonly status: OpenClawAgentWaitStatus;
}

export interface OpenClawAgentWaitClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
}

export class OpenClawAgentWaitUnavailableError extends Error {
  readonly code = 'OPENCLAW_AGENT_WAIT_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawAgentWaitUnavailableError';
  }
}

export class OpenClawAgentWaitResponseError extends Error {
  readonly code = 'OPENCLAW_AGENT_WAIT_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid agent.wait response');
    this.name = 'OpenClawAgentWaitResponseError';
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

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

export function parseOpenClawAgentWaitResult(value: unknown): OpenClawAgentWaitResult {
  const source = record(value);
  const runId = nonEmptyText(source?.runId);
  const status = source?.status;
  if (!source || !runId || typeof status !== 'string' || !WAIT_STATUSES.includes(status as OpenClawAgentWaitStatus)) {
    throw new OpenClawAgentWaitResponseError();
  }
  return { runId, status: status as OpenClawAgentWaitStatus };
}

/** Reads one Gateway-owned run outcome without creating or mutating a run. */
export class OpenClawAgentWaitClient {
  constructor(private readonly dependencies: OpenClawAgentWaitClientDependencies) {}

  async check(runId: string): Promise<OpenClawAgentWaitResult> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) {
      throw new OpenClawAgentWaitUnavailableError(
        'No attested Gateway connection is available for agent.wait',
      );
    }
    return this.checkForConnection(runId, connectionId);
  }

  async checkForConnection(runId: string, connectionId: string): Promise<OpenClawAgentWaitResult> {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) throw new OpenClawAgentWaitResponseError();
    if (!this.dependencies.isConnectionCurrent(connectionId)) {
      throw new OpenClawAgentWaitUnavailableError(
        'No attested Gateway connection is available for agent.wait',
      );
    }
    try {
      const response = await this.dependencies.requestFenced(
        OPENCLAW_AGENT_WAIT_METHOD,
        { runId: normalizedRunId, timeoutMs: 0 },
        connectionId,
      );
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw new OpenClawAgentWaitUnavailableError(
          'Gateway connection changed while reading agent.wait',
        );
      }
      const result = parseOpenClawAgentWaitResult(response);
      if (result.runId !== normalizedRunId) throw new OpenClawAgentWaitResponseError();
      return result;
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, OPENCLAW_AGENT_WAIT_METHOD)) {
        throw new OpenClawAgentWaitUnavailableError(
          'The connected OpenClaw Gateway does not support agent.wait',
        );
      }
      if (connectionUnavailable(error)) {
        throw new OpenClawAgentWaitUnavailableError(
          'No attested Gateway connection is available for agent.wait',
        );
      }
      throw error;
    }
  }
}
