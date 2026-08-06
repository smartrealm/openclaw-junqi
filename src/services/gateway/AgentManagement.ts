import type {
  GatewayAgentCreatePayload,
  GatewayAgentDisplayNameUpdate,
} from '@/utils/gatewayAgentFlow';

interface AgentRpcClient {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}

function responseRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error('OpenClaw agents.create returned an invalid response');
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

  async create(agent: GatewayAgentCreatePayload): Promise<Record<string, unknown>> {
    const workspace = agent.workspace?.trim();

    // The official create RPC derives the id from `name`. Create with the
    // validated internal id, then persist the independent display name.
    const created = await this.client.request('agents.create', {
      name: agent.id,
      ...(workspace ? { workspace } : {}),
      ...(agent.model ? { model: agent.model } : {}),
    });
    const createdRecord = responseRecord(created);
    const requestedName = agent.name?.trim();
    if (!requestedName || requestedName === agent.id) {
      return createdRecord;
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
    return { ...createdRecord, agentId: agent.id, name: requestedName };
  }
}
