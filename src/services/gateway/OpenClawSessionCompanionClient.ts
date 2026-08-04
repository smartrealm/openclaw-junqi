import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
  GatewayRpcError,
} from './Connection';

export const OPENCLAW_SESSION_COMPANION_ASK_METHOD = 'sessions.companion.ask' as const;
export const OPENCLAW_SESSION_COMPANION_STATE_METHOD = 'sessions.companion.state' as const;
export const OPENCLAW_SESSION_COMPANION_RESET_METHOD = 'sessions.companion.reset' as const;

const QUESTION_MAX_LENGTH = 400;
const ANSWER_MAX_LENGTH = 1200;
const EXCHANGE_MAX_COUNT = 24;
const SESSION_COMPANION_BUSY_CODE = 'SESSION_COMPANION_BUSY';

export interface OpenClawSessionCompanionExchange {
  readonly question: string;
  readonly answer: string;
  readonly ts: number;
}

export interface OpenClawSessionCompanionState {
  readonly exchanges: readonly OpenClawSessionCompanionExchange[];
}

export interface OpenClawSessionCompanionAnswer {
  readonly answer: string;
  readonly ts: number;
}

export interface OpenClawSessionCompanionClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
}

export class OpenClawSessionCompanionUnavailableError extends Error {
  readonly code = 'OPENCLAW_SESSION_COMPANION_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawSessionCompanionUnavailableError';
  }
}

export class OpenClawSessionCompanionBusyError extends Error {
  readonly code = 'OPENCLAW_SESSION_COMPANION_BUSY';

  constructor() {
    super('The OpenClaw session companion is already answering a question');
    this.name = 'OpenClawSessionCompanionBusyError';
  }
}

export class OpenClawSessionCompanionResponseError extends Error {
  readonly code = 'OPENCLAW_SESSION_COMPANION_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid session companion response');
    this.name = 'OpenClawSessionCompanionResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.trim() && value.length <= maximum ? value.trim() : null;
}

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function parseExchange(value: unknown): OpenClawSessionCompanionExchange {
  const source = record(value);
  const question = boundedString(source?.question, QUESTION_MAX_LENGTH);
  const answer = boundedString(source?.answer, ANSWER_MAX_LENGTH);
  const ts = timestamp(source?.ts);
  if (!source || !question || !answer || ts === null) throw new OpenClawSessionCompanionResponseError();
  return { question, answer, ts };
}

export function parseOpenClawSessionCompanionState(value: unknown): OpenClawSessionCompanionState {
  const source = record(value);
  if (!source || !Array.isArray(source.exchanges) || source.exchanges.length > EXCHANGE_MAX_COUNT) {
    throw new OpenClawSessionCompanionResponseError();
  }
  return { exchanges: source.exchanges.map(parseExchange) };
}

export function parseOpenClawSessionCompanionAnswer(value: unknown): OpenClawSessionCompanionAnswer {
  const source = record(value);
  const answer = boundedString(source?.answer, ANSWER_MAX_LENGTH);
  const ts = timestamp(source?.ts);
  if (!source || !answer || ts === null) throw new OpenClawSessionCompanionResponseError();
  return { answer, ts };
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND' || error.code === 'UNKNOWN_METHOD' || error.code === 'UNKNOWN_COMMAND');
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

function isBusy(error: unknown): boolean {
  if (!(error instanceof GatewayRpcError) || !error.details || typeof error.details !== 'object') return false;
  return (error.details as { code?: unknown }).code === SESSION_COMPANION_BUSY_CODE;
}

/** 仅调用 OpenClaw 的只读 Companion RPC；线程状态始终由 Gateway 内存拥有。 */
export class OpenClawSessionCompanionClient {
  constructor(private readonly dependencies: OpenClawSessionCompanionClientDependencies) {}

  async getState(sessionKey: string): Promise<OpenClawSessionCompanionState> {
    return parseOpenClawSessionCompanionState(await this.request(
      OPENCLAW_SESSION_COMPANION_STATE_METHOD,
      { sessionKey: this.requireSessionKey(sessionKey) },
    ));
  }

  async ask(sessionKey: string, question: string): Promise<OpenClawSessionCompanionAnswer> {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || normalizedQuestion.length > QUESTION_MAX_LENGTH) {
      throw new OpenClawSessionCompanionResponseError();
    }
    return parseOpenClawSessionCompanionAnswer(await this.request(
      OPENCLAW_SESSION_COMPANION_ASK_METHOD,
      { sessionKey: this.requireSessionKey(sessionKey), question: normalizedQuestion },
    ));
  }

  async reset(sessionKey: string): Promise<void> {
    const response = record(await this.request(
      OPENCLAW_SESSION_COMPANION_RESET_METHOD,
      { sessionKey: this.requireSessionKey(sessionKey) },
    ));
    if (!response || response.ok !== true) throw new OpenClawSessionCompanionResponseError();
  }

  private requireSessionKey(sessionKey: string): string {
    const normalized = sessionKey.trim();
    if (!normalized) throw new OpenClawSessionCompanionResponseError();
    return normalized;
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId || !this.dependencies.isConnectionCurrent(connectionId)) {
      throw new OpenClawSessionCompanionUnavailableError('No attested Gateway connection is available for the session companion');
    }
    try {
      const response = await this.dependencies.requestFenced(method, params, connectionId);
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw new OpenClawSessionCompanionUnavailableError('Gateway connection changed while using the session companion');
      }
      return response;
    } catch (error) {
      if (isBusy(error)) throw new OpenClawSessionCompanionBusyError();
      if (unsupportedMethod(error)) {
        throw new OpenClawSessionCompanionUnavailableError('The connected OpenClaw Gateway does not support the session companion');
      }
      if (connectionUnavailable(error)) {
        throw new OpenClawSessionCompanionUnavailableError('No attested Gateway connection is available for the session companion');
      }
      throw error;
    }
  }
}
