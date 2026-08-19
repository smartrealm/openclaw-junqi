import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
} from './Connection';
import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';
import { resolveOpenClawSessionTarget } from './OpenClawSessionTarget';
import {
  OpenClawProgressCardResponseError,
  parseOpenClawProgressCardResult,
  type OpenClawProgressCard,
} from '@/progress-card/domain';

const PROGRESS_CARD_GET_METHOD = 'progressCard.get';

export type OpenClawProgressCardUnavailableReason =
  | 'connection_unavailable'
  | 'connection_changed'
  | 'method_unavailable';

export class OpenClawProgressCardUnavailableError extends Error {
  readonly code = 'OPENCLAW_PROGRESS_CARD_UNAVAILABLE';

  constructor(readonly reason: OpenClawProgressCardUnavailableReason, message: string) {
    super(message);
    this.name = 'OpenClawProgressCardUnavailableError';
  }
}

export interface OpenClawProgressCardClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (
    method: string,
    params: Record<string, unknown>,
    connectionId: string,
  ) => Promise<unknown>;
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

export class OpenClawProgressCardClient {
  constructor(private readonly dependencies: OpenClawProgressCardClientDependencies) {}

  async get(sessionKey: string): Promise<OpenClawProgressCard | null> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) {
      throw new OpenClawProgressCardUnavailableError(
        'connection_unavailable',
        'No attested Gateway connection is available for progress cards',
      );
    }
    const target = resolveOpenClawSessionTarget(sessionKey);
    try {
      const response = await this.dependencies.requestFenced(
        PROGRESS_CARD_GET_METHOD,
        { sessionKey: target.localKey },
        connectionId,
      );
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw new OpenClawProgressCardUnavailableError(
          'connection_changed',
          'Gateway connection changed while reading the progress card',
        );
      }
      const card = parseOpenClawProgressCardResult(response);
      if (card && card.sessionKey !== target.localKey) {
        throw new OpenClawProgressCardResponseError();
      }
      return card;
    } catch (error) {
      if (error instanceof OpenClawProgressCardUnavailableError) throw error;
      if (isOpenClawUnknownMethodError(error, PROGRESS_CARD_GET_METHOD)) {
        throw new OpenClawProgressCardUnavailableError(
          'method_unavailable',
          'The connected OpenClaw Gateway does not support progressCard.get',
        );
      }
      if (connectionUnavailable(error)) {
        throw new OpenClawProgressCardUnavailableError(
          'connection_unavailable',
          'No attested Gateway connection is available for progress cards',
        );
      }
      throw error;
    }
  }
}
