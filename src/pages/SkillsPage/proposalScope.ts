export const GATEWAY_DEFAULT_PROPOSAL_SCOPE = 'gateway-default';
export const ACTIVE_SESSION_PROPOSAL_SCOPE = 'active-session';

const EXPLICIT_AGENT_PROPOSAL_SCOPE_PREFIX = 'agent:';

export function proposalScopeValueForAgent(agentId: string): string {
  return `${EXPLICIT_AGENT_PROPOSAL_SCOPE_PREFIX}${agentId}`;
}

export function resolveProposalScopeAgentId(
  scope: string,
  activeSessionAgentId: string | undefined,
): string | undefined {
  if (scope === GATEWAY_DEFAULT_PROPOSAL_SCOPE) return undefined;
  if (scope === ACTIVE_SESSION_PROPOSAL_SCOPE) {
    const agentId = activeSessionAgentId?.trim();
    return agentId || undefined;
  }
  if (!scope.startsWith(EXPLICIT_AGENT_PROPOSAL_SCOPE_PREFIX)) return undefined;
  const agentId = scope.slice(EXPLICIT_AGENT_PROPOSAL_SCOPE_PREFIX.length).trim();
  return agentId || undefined;
}
