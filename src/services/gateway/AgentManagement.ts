import type {
  GatewayAgentCreatePayload,
  GatewayAgentDisplayNameUpdate,
} from '@/utils/gatewayAgentFlow';

interface AgentRpcClient {
  request(method: string, params: Record<string, unknown>): Promise<any>;
}

/**
 * Raised after the official create RPC succeeds but the separate display-name
 * update cannot be persisted. The agent remains usable under its stable id;
 * callers can surface the partial result and let the user retry the rename.
 */
export class GatewayAgentDisplayNameUpdateError extends Error {
  readonly agentId: string;
  readonly displayName: string;
  readonly cause: unknown;

  constructor(update: GatewayAgentDisplayNameUpdate, cause: unknown) {
    super(`Agent "${update.agentId}" was created, but its display name could not be saved.`);
    this.name = 'GatewayAgentDisplayNameUpdateError';
    this.agentId = update.agentId;
    this.displayName = update.name;
    this.cause = cause;
  }
}

/** Adapts JunQi's stable id + display name model to OpenClaw's official RPCs. */
export class OpenClawAgentManagement {
  constructor(private readonly client: AgentRpcClient) {}

  async create(agent: GatewayAgentCreatePayload) {
    const workspace = agent.workspace?.trim();
    if (!workspace) {
      throw new Error('A workspace is required to create an OpenClaw agent.');
    }

    // The official create RPC derives the id from `name`. Create with the
    // validated internal id, then persist the independent display name.
    const created = await this.client.request('agents.create', {
      name: agent.id,
      workspace,
      ...(agent.model ? { model: agent.model } : {}),
    });
    const requestedName = agent.name?.trim();
    if (!requestedName || requestedName === agent.id) {
      return created;
    }

    const update: GatewayAgentDisplayNameUpdate = {
      agentId: agent.id,
      name: requestedName,
    };
    try {
      await this.client.request('agents.update', { ...update });
    } catch (error) {
      throw new GatewayAgentDisplayNameUpdateError(update, error);
    }
    return { ...created, agentId: agent.id, name: requestedName };
  }
}
