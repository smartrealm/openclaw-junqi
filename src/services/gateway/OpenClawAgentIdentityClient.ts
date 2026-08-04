import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
  GatewayRpcError,
} from './Connection';

export const OPENCLAW_AGENT_IDENTITY_GET_METHOD = 'agent.identity.get' as const;

const AVATAR_STATUSES = ['none', 'local', 'remote', 'data'] as const;

export type OpenClawAgentAvatarStatus = typeof AVATAR_STATUSES[number];

export interface OpenClawAgentIdentity {
  readonly agentId: string;
  readonly name?: string;
  readonly avatar?: string;
  readonly avatarSource?: string;
  readonly avatarStatus?: OpenClawAgentAvatarStatus;
  readonly avatarReason?: string;
  readonly emoji?: string;
}

export interface OpenClawAgentIdentityInput {
  readonly agentId?: string;
  readonly sessionKey?: string;
}

export interface OpenClawAgentIdentityClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
}

export class OpenClawAgentIdentityUnavailableError extends Error {
  readonly code = 'OPENCLAW_AGENT_IDENTITY_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawAgentIdentityUnavailableError';
  }
}

export class OpenClawAgentIdentityResponseError extends Error {
  readonly code = 'OPENCLAW_AGENT_IDENTITY_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid agent.identity.get response');
    this.name = 'OpenClawAgentIdentityResponseError';
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

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const normalized = nonEmptyText(value);
  if (!normalized) throw new OpenClawAgentIdentityResponseError();
  return normalized;
}

function avatarStatus(value: unknown): OpenClawAgentAvatarStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !AVATAR_STATUSES.includes(value as OpenClawAgentAvatarStatus)) {
    throw new OpenClawAgentIdentityResponseError();
  }
  return value as OpenClawAgentAvatarStatus;
}

function buildParams(input: OpenClawAgentIdentityInput): Record<string, string> {
  const agentId = input.agentId?.trim();
  const sessionKey = input.sessionKey?.trim();
  if (!agentId && !sessionKey) throw new OpenClawAgentIdentityResponseError();
  return {
    ...(agentId ? { agentId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
  };
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND' || error.code === 'UNKNOWN_METHOD' || error.code === 'UNKNOWN_COMMAND');
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

export function parseOpenClawAgentIdentity(value: unknown): OpenClawAgentIdentity {
  const source = record(value);
  const agentId = nonEmptyText(source?.agentId);
  if (!source || !agentId) throw new OpenClawAgentIdentityResponseError();

  const name = optionalText(source.name);
  const avatar = optionalText(source.avatar);
  const avatarSource = optionalText(source.avatarSource);
  const avatarStatusValue = avatarStatus(source.avatarStatus);
  const avatarReason = optionalText(source.avatarReason);
  const emoji = optionalText(source.emoji);

  return {
    agentId,
    ...(name ? { name } : {}),
    ...(avatar ? { avatar } : {}),
    ...(avatarSource ? { avatarSource } : {}),
    ...(avatarStatusValue ? { avatarStatus: avatarStatusValue } : {}),
    ...(avatarReason ? { avatarReason } : {}),
    ...(emoji ? { emoji } : {}),
  };
}

/** Reads the Gateway-resolved display identity without deriving it from a session key locally. */
export class OpenClawAgentIdentityClient {
  constructor(private readonly dependencies: OpenClawAgentIdentityClientDependencies) {}

  async get(input: OpenClawAgentIdentityInput): Promise<OpenClawAgentIdentity> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) {
      throw new OpenClawAgentIdentityUnavailableError(
        'No attested Gateway connection is available for agent.identity.get',
      );
    }
    return this.getForConnection(input, connectionId);
  }

  async getForConnection(
    input: OpenClawAgentIdentityInput,
    connectionId: string,
  ): Promise<OpenClawAgentIdentity> {
    if (!this.dependencies.isConnectionCurrent(connectionId)) {
      throw new OpenClawAgentIdentityUnavailableError(
        'No attested Gateway connection is available for agent.identity.get',
      );
    }
    try {
      const response = await this.dependencies.requestFenced(
        OPENCLAW_AGENT_IDENTITY_GET_METHOD,
        buildParams(input),
        connectionId,
      );
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw new OpenClawAgentIdentityUnavailableError(
          'Gateway connection changed while reading agent.identity.get',
        );
      }
      return parseOpenClawAgentIdentity(response);
    } catch (error) {
      if (unsupportedMethod(error)) {
        throw new OpenClawAgentIdentityUnavailableError(
          'The connected OpenClaw Gateway does not support agent.identity.get',
        );
      }
      if (connectionUnavailable(error)) {
        throw new OpenClawAgentIdentityUnavailableError(
          'No attested Gateway connection is available for agent.identity.get',
        );
      }
      throw error;
    }
  }
}
