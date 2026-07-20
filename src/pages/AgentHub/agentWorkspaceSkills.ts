export interface AgentWorkspaceSkill {
  name: string;
  description: string;
  eligible: boolean;
  disabled: boolean;
}

export function parseAgentWorkspaceSkills(response: unknown): AgentWorkspaceSkill[] {
  if (!response || typeof response !== 'object') return [];
  const record = response as Record<string, unknown>;
  const rawSkills = Array.isArray(record.skills)
    ? record.skills
    : Array.isArray(record.entries)
      ? record.entries
      : [];
  const explicitFilter = Array.isArray(record.agentSkillFilter)
    ? new Set(record.agentSkillFilter.filter((value): value is string => typeof value === 'string'))
    : null;

  const unique = new Map<string, AgentWorkspaceSkill>();
  for (const raw of rawSkills) {
    if (!raw || typeof raw !== 'object') continue;
    const skill = raw as Record<string, unknown>;
    const source = typeof skill.source === 'string' ? skill.source.toLowerCase() : '';
    const name = typeof skill.name === 'string' ? skill.name.trim() : '';
    const skillKey = typeof skill.skillKey === 'string' ? skill.skillKey.trim() : name;
    if (!name) continue;
    const isWorkspaceLocal = source === 'openclaw-workspace' || source === 'workspace';
    const isExplicitlyAllowed = explicitFilter?.has(skillKey) || explicitFilter?.has(name);
    if (explicitFilter ? !isExplicitlyAllowed : !isWorkspaceLocal) continue;
    unique.set(name, {
      name,
      description: typeof skill.description === 'string' ? skill.description : '',
      eligible: skill.eligible !== false,
      disabled: skill.disabled === true,
    });
  }

  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}
