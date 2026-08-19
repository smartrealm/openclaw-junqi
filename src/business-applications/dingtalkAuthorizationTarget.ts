export interface DingTalkAuthorizationAgentCandidate {
  readonly id: string;
  readonly name?: string;
}

export function collectDingTalkAuthorizationTargets(
  currentAgentId: string | null,
  candidates: readonly DingTalkAuthorizationAgentCandidate[],
): DingTalkAuthorizationAgentCandidate[] {
  const normalizedCurrentAgentId = currentAgentId?.trim() || null;
  const byId = new Map<string, DingTalkAuthorizationAgentCandidate>();
  for (const candidate of candidates) {
    const id = candidate.id.trim();
    if (!id || byId.has(id)) continue;
    byId.set(id, { id, ...(candidate.name?.trim() ? { name: candidate.name.trim() } : {}) });
  }
  if (normalizedCurrentAgentId && !byId.has(normalizedCurrentAgentId)) {
    byId.set(normalizedCurrentAgentId, { id: normalizedCurrentAgentId });
  }
  return [...byId.values()].sort((left, right) => {
    if (left.id === normalizedCurrentAgentId) return -1;
    if (right.id === normalizedCurrentAgentId) return 1;
    return left.id.localeCompare(right.id);
  });
}
