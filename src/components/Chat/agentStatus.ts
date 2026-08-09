import type { Session, TokenUsage } from '@/stores/chatStore';
import type { GatewaySessionAgentRuntime } from '@/services/gateway/sessionAgentRuntime';
import type { GatewayThinkingLevelOption } from '@/processing/sessionThinkingProfile';

export interface AgentStatusSnapshot {
  tokenUsage: TokenUsage | null;
  agentRuntime: GatewaySessionAgentRuntime | null;
  thinkingLevel: string | null;
  thinkingLevels: readonly GatewayThinkingLevelOption[] | null;
  thinkingDefault: string | null;
}

interface ResolveAgentStatusSnapshotOptions {
  session: Session | undefined;
  activeSessionKey: string;
  activeTokenUsage: TokenUsage | null;
  activeThinkingLevel: string | null;
  defaultContextTokens: number | null;
}

/**
 * The active session can receive fresher usage from stream/polling than its
 * cached session row. Other tabs must use their own cached metadata, never
 * the active session's values.
 */
export function resolveAgentStatusSnapshot({
  session,
  activeSessionKey,
  activeTokenUsage,
  activeThinkingLevel,
  defaultContextTokens,
}: ResolveAgentStatusSnapshotOptions): AgentStatusSnapshot {
  if (!session) {
    return {
      tokenUsage: null,
      agentRuntime: null,
      thinkingLevel: null,
      thinkingLevels: null,
      thinkingDefault: null,
    };
  }

  if (session.key === activeSessionKey && activeTokenUsage) {
    return {
      tokenUsage: activeTokenUsage,
      agentRuntime: session.agentRuntime ?? null,
      thinkingLevel: session.thinkingLevel ?? activeThinkingLevel,
      thinkingLevels: session.thinkingLevels ?? null,
      thinkingDefault: session.thinkingDefault ?? null,
    };
  }

  const contextTokens = session.totalTokens ?? 0;
  const maxTokens = session.contextTokens ?? defaultContextTokens ?? 0;
  return {
    tokenUsage: contextTokens > 0 || maxTokens > 0
      ? {
          contextTokens,
          maxTokens,
          percentage: maxTokens > 0 ? Math.round((contextTokens / maxTokens) * 100) : 0,
          compactions: session.compactionCount ?? 0,
        }
      : null,
    agentRuntime: session.agentRuntime ?? null,
    thinkingLevel: session.thinkingLevel ?? null,
    thinkingLevels: session.thinkingLevels ?? null,
    thinkingDefault: session.thinkingDefault ?? null,
  };
}
