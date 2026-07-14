type AgentConfigEntry = Record<string, unknown> & { id?: unknown };

export function applyAgentSkillFilter(
  config: Record<string, any>,
  agentId: string,
  skillKeys: string[],
): Record<string, any> {
  const list = Array.isArray(config.agents?.list) ? config.agents.list as AgentConfigEntry[] : [];
  const normalizedId = agentId.trim().toLowerCase();
  const index = list.findIndex((entry) => String(entry.id ?? '').trim().toLowerCase() === normalizedId);
  if (index < 0) throw new Error(`Agent "${agentId}" was created but is missing from config`);

  const skills = [...new Set(skillKeys.map((key) => key.trim()).filter(Boolean))];
  const nextAgent = { ...list[index], skills };
  const nextList = [...list];
  nextList[index] = nextAgent;
  return {
    ...config,
    agents: {
      ...(config.agents ?? {}),
      list: nextList,
    },
  };
}

export async function persistAgentSkillFilter(agentId: string, skillKeys: string[]): Promise<void> {
  const detected = await window.aegis.config.detect();
  if (!detected.exists) throw new Error('OpenClaw config file was not found');
  const { data } = await window.aegis.config.read(detected.path);
  const next = applyAgentSkillFilter(data as Record<string, any>, agentId, skillKeys);
  const writeResult = await window.aegis.config.write(detected.path, next);
  if (!writeResult.success) throw new Error(writeResult.error || 'Failed to save agent skills');
  const restart = await window.aegis.config.restart();
  if (!restart.success) throw new Error(restart.error || 'Agent skills were saved, but Gateway restart failed');
}
