const AGENT_RUN_PATH = '/agent-run';
const LEGACY_AGENT_WORKSPACE_PATH = '/ai-workspace';

export function createAgentRunTaskRoute(taskId: string): string {
  const normalizedTaskId = taskId.trim();
  return normalizedTaskId
    ? `${AGENT_RUN_PATH}?taskId=${encodeURIComponent(normalizedTaskId)}`
    : AGENT_RUN_PATH;
}

/**
 * Translate the former task deep link only when it carries exactly the one
 * query field that the old route intended to use. Other workspace URLs retain
 * their original destination so a future workspace route can own them.
 */
export function canonicalizeLegacyAgentWorkspaceTaskRoute(target: string): string {
  let parsed: URL;
  try {
    parsed = new URL(target, 'https://junqi.invalid');
  } catch {
    return target;
  }

  if (parsed.pathname !== LEGACY_AGENT_WORKSPACE_PATH || parsed.hash) return target;
  const entries = [...parsed.searchParams.entries()];
  const [entry] = entries;
  if (entries.length !== 1 || !entry || entry[0] !== 'task') return target;
  const taskId = entry[1].trim();
  return taskId ? createAgentRunTaskRoute(taskId) : target;
}
