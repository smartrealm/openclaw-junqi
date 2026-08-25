export interface AgentFleetActivitySessionInput {
  readonly agentId?: string;
  readonly running?: boolean;
  readonly hasActiveRun?: boolean;
  readonly hasActiveSubagentRun?: boolean;
  readonly updatedAt?: number | string;
}

function numericUpdatedAt(value: number | string | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export interface AgentFleetActivityAgentInput {
  readonly id: string;
  readonly name?: string;
}

export interface AgentFleetActivityProjection {
  readonly agentId: string;
  readonly displayName: string;
  readonly active: boolean;
  readonly activeSessionCount: number;
  readonly lastActiveAt: number | null;
}

function sessionIsActive(session: AgentFleetActivitySessionInput): boolean {
  return session.running === true
    || session.hasActiveRun === true
    || session.hasActiveSubagentRun === true;
}

/**
 * 仅由 OpenClaw 官方 sessions.list 的 running/hasActiveRun/hasActiveSubagentRun
 * 权威字段派生每个已配置 Agent 的忙闲状态，不推断或缓存额外语义。
 */
export function buildAgentFleetActivityProjection(
  agents: readonly AgentFleetActivityAgentInput[],
  sessions: readonly AgentFleetActivitySessionInput[],
): AgentFleetActivityProjection[] {
  const byAgent = new Map<string, AgentFleetActivitySessionInput[]>();
  for (const session of sessions) {
    const agentId = session.agentId?.trim();
    if (!agentId) continue;
    const bucket = byAgent.get(agentId);
    if (bucket) bucket.push(session);
    else byAgent.set(agentId, [session]);
  }

  return agents.map((agent) => {
    const agentSessions = byAgent.get(agent.id) ?? [];
    const activeSessions = agentSessions.filter(sessionIsActive);
    const lastActiveAt = agentSessions.reduce<number | null>((latest, session) => {
      const updatedAt = numericUpdatedAt(session.updatedAt);
      if (updatedAt === null) return latest;
      if (latest === null || updatedAt > latest) return updatedAt;
      return latest;
    }, null);
    return {
      agentId: agent.id,
      displayName: agent.name?.trim() || agent.id,
      active: activeSessions.length > 0,
      activeSessionCount: activeSessions.length,
      lastActiveAt,
    };
  }).sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    return left.displayName.localeCompare(right.displayName);
  });
}
