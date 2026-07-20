export interface AgentDisplayRecord {
  id?: unknown;
  name?: unknown;
  identity?: { name?: unknown } | null;
}

/** Resolve the user-facing name without ever using it as a routing key. */
export function getAgentDisplayName(
  agent: AgentDisplayRecord | null | undefined,
  fallback = 'Agent',
): string {
  const displayName = [agent?.name, agent?.identity?.name]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find(Boolean);
  if (displayName) return displayName;

  const id = typeof agent?.id === 'string' ? agent.id.trim() : '';
  return id || fallback;
}
