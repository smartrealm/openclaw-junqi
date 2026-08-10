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

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`OpenClaw agents.create returned an invalid ${field}`);
  }
  return value.trim();
}

function confirmedCreateResult(value: unknown, expectedAgentId: string): Record<string, unknown> {
  const result = responseRecord(value);
  if (result.ok !== true) throw new Error('OpenClaw agents.create did not confirm success');
  const agentId = requiredText(result.agentId, 'agentId');
  if (agentId.toLowerCase() !== expectedAgentId.trim().toLowerCase()) {
    throw new Error('OpenClaw agents.create returned a different agent id');
  }
  requiredText(result.name, 'name');
  requiredText(result.workspace, 'workspace');
  if (result.model !== undefined && (typeof result.model !== 'string' || !result.model.trim())) {
    throw new Error('OpenClaw agents.create returned an invalid model');
  }
  return result;
}

function confirmDisplayNameUpdate(value: unknown, expectedAgentId: string): void {
  const result = responseRecord(value);
  const agentId = requiredText(result.agentId, 'agentId');
  if (result.ok !== true || agentId.toLowerCase() !== expectedAgentId.trim().toLowerCase()) {
    throw new Error('OpenClaw agents.update did not confirm the requested agent');
  }
}

/** 解析官方 agents.update 回执，避免调用方在未确认时提前更新界面。 */
export function confirmOpenClawAgentUpdate(value: unknown, expectedAgentId: string): { ok: true; agentId: string } {
  const result = responseRecord(value);
  const agentId = requiredText(result.agentId, 'agentId');
  if (result.ok !== true || agentId.toLowerCase() !== expectedAgentId.trim().toLowerCase()) {
    throw new Error('OpenClaw agents.update did not confirm the requested agent');
  }
  return { ok: true, agentId };
}

/** 解析官方 agents.delete 回执，删除后的本地清理必须建立在该回执上。 */
export function confirmOpenClawAgentDelete(value: unknown, expectedAgentId: string): { ok: true; agentId: string } {
  const result = responseRecord(value);
  const agentId = requiredText(result.agentId, 'agentId');
  if (result.ok !== true || agentId.toLowerCase() !== expectedAgentId.trim().toLowerCase()) {
    throw new Error('OpenClaw agents.delete did not confirm the requested agent');
  }
  if (typeof result.removedBindings !== 'number' || !Number.isSafeInteger(result.removedBindings) || result.removedBindings < 0) {
    throw new Error('OpenClaw agents.delete returned an invalid removedBindings count');
  }
  return { ok: true, agentId };
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
    const createdRecord = confirmedCreateResult(created, agent.id);
    const requestedName = agent.name?.trim();
    if (!requestedName || requestedName === agent.id) {
      return createdRecord;
    }

    const update: GatewayAgentDisplayNameUpdate = {
      agentId: agent.id,
      name: requestedName,
    };
    try {
      const updated = await this.client.request('agents.update', { ...update });
      confirmDisplayNameUpdate(updated, update.agentId);
    } catch (error) {
      throw new GatewayAgentDisplayNameUpdateError(update, error);
    }
    return { ...createdRecord, agentId: agent.id, name: requestedName };
  }
}
