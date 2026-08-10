import type { AgentConfig, GatewayRuntimeConfig, ModelReferenceConfig } from '@/types/openclawConfig';
import { readOpenClawConfigSnapshot } from '@/services/gateway/OpenClawConfigSnapshot';
import { requireOpenClawConfigPatchAcknowledgement } from '@/services/gateway/OpenClawRuntimeConfigClient';

type AgentConfigEntry = AgentConfig;

export type AgentCreationConfig = GatewayRuntimeConfig & {
  agents: NonNullable<GatewayRuntimeConfig['agents']> & { list: AgentConfigEntry[] };
};

export interface AgentCreationOverrides {
  skills?: string[];
  model?: ModelReferenceConfig;
}

export interface AgentConfigGateway {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
  callPrivileged(method: string, params: Record<string, unknown>): Promise<unknown>;
}

function normalizedSkillKeys(skillKeys: string[]): string[] {
  return Array.from(new Set(skillKeys.map((key) => key.trim()).filter(Boolean)));
}

function normalizedModelOverride(model: ModelReferenceConfig | undefined): ModelReferenceConfig | undefined {
  if (typeof model === 'string') {
    const primary = model.trim();
    return primary || undefined;
  }
  if (!model || typeof model !== 'object') return undefined;
  const primary = String(model.primary ?? '').trim();
  if (!primary) throw new Error('A fallback model configuration needs a primary model.');
  const fallbacks = Array.from(new Set(
    (model.fallbacks ?? [])
      .map((fallback) => String(fallback ?? '').trim())
      .filter((fallback) => Boolean(fallback) && fallback !== primary),
  ));
  return fallbacks.length > 0 ? { primary, fallbacks } : { primary };
}

export function applyAgentCreationOverrides(
  config: GatewayRuntimeConfig,
  agentId: string,
  overrides: AgentCreationOverrides,
): AgentCreationConfig {
  const list = config.agents?.list ?? [];
  const normalizedId = agentId.trim().toLowerCase();
  const index = list.findIndex((entry) => String(entry.id ?? '').trim().toLowerCase() === normalizedId);
  if (index < 0) throw new Error(`Agent "${agentId}" was created but is missing from config`);

  const nextAgent: AgentConfigEntry = { ...list[index] };
  if (overrides.skills !== undefined) nextAgent.skills = normalizedSkillKeys(overrides.skills);
  const model = normalizedModelOverride(overrides.model);
  if (model !== undefined) nextAgent.model = model;

  const nextList = [...list];
  nextList[index] = nextAgent;
  const agents: AgentCreationConfig['agents'] = {
    ...(config.agents ?? {}),
    list: nextList,
  };
  return {
    ...config,
    agents,
  };
}

/**
 * Follow an `agents.create` RPC with a guarded patch only when the form needs
 * fields that the create RPC cannot express, such as skill filters or ordered
 * model fallbacks. This keeps the Gateway as the source of truth.
 */
export async function persistAgentCreationOverrides(
  gateway: AgentConfigGateway,
  agentId: string,
  overrides: AgentCreationOverrides,
): Promise<void> {
  const snapshot = readOpenClawConfigSnapshot(await gateway.call('config.get', {}));
  const next = applyAgentCreationOverrides(snapshot.config, agentId, overrides);
  const updatedAgent = next.agents?.list?.find(
    (entry) => entry.id.trim().toLowerCase() === agentId.trim().toLowerCase(),
  );
  if (!updatedAgent) throw new Error(`Agent "${agentId}" was created but is missing from config`);

  const result = await gateway.callPrivileged('config.patch', {
    raw: JSON.stringify({ agents: { list: [updatedAgent] } }),
    ...(snapshot.hash ? { baseHash: snapshot.hash } : {}),
  });
  requireOpenClawConfigPatchAcknowledgement(result);
}
