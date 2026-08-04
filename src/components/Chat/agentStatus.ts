import type { Session, TokenUsage } from '@/stores/chatStore';
import type { GatewayThinkingLevelOption } from '@/services/gateway/sessionThinkingProfile';

export interface AgentStatusSnapshot {
  tokenUsage: TokenUsage | null;
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
      thinkingLevel: null,
      thinkingLevels: null,
      thinkingDefault: null,
    };
  }

  if (session.key === activeSessionKey && activeTokenUsage) {
    return {
      tokenUsage: activeTokenUsage,
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
    thinkingLevel: session.thinkingLevel ?? null,
    thinkingLevels: session.thinkingLevels ?? null,
    thinkingDefault: session.thinkingDefault ?? null,
  };
}
