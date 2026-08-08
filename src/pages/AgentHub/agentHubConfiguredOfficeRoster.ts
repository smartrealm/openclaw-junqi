import type { CollaborationCapabilityAgent } from '@/services/collaboration/types';

export interface ConfiguredOfficeAgent {
  id: string;
  displayName: string;
  description: string | null;
  coordinator: boolean;
  allowed: boolean;
  runtimeType: string | null;
}

/** 将 Gateway 返回的配置身份投影为静态办公室席位，不推断运行参与或在线状态。 */
export function buildConfiguredOfficeRoster(
  agents: readonly CollaborationCapabilityAgent[],
): ConfiguredOfficeAgent[] {
  return [...agents]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((agent) => ({
      id: agent.id,
      displayName: agent.name?.trim() || agent.id,
      description: agent.description?.trim() || null,
      coordinator: agent.coordinator,
      allowed: agent.allowed,
      runtimeType: agent.runtimeType ?? null,
    }));
}
