import { applyAgentCreationOverrides } from './agentCreationConfig';

export function applyAgentSkillFilter(
  config: Record<string, any>,
  agentId: string,
  skillKeys: string[],
): Record<string, any> {
  return applyAgentCreationOverrides(config, agentId, { skills: skillKeys });
}
