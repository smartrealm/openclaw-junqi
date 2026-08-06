import { agentIdFromSessionKey } from './sessionPresentation';

export interface ConfirmedEmptyTranscriptSession {
  readonly key?: string;
  readonly sessionId?: string;
  readonly agentId?: string;
  readonly activeLeafEntryId?: string | null;
}

export function hasConfirmedEmptyTranscript(
  session: ConfirmedEmptyTranscriptSession | undefined,
): boolean {
  return Boolean(
    session?.key?.trim()
      && session.sessionId?.trim()
      && session.agentId?.trim()
      && session.activeLeafEntryId === null,
  );
}

/**
 * sessions.list 行可以省略 leaf 和 agentId；前者保留创建确认，后者由官方
 * session key 的 agent 段核对。Gateway 明确返回 leaf 或身份确实变化时，仍以
 * Gateway 投影覆盖本地创建事实。
 */
export function preserveConfirmedEmptyTranscriptLeaf<T extends ConfirmedEmptyTranscriptSession>(
  previous: ConfirmedEmptyTranscriptSession | undefined,
  incoming: T,
): T {
  const previousAgentId = previous?.agentId?.trim() || (previous?.key ? agentIdFromSessionKey(previous.key) : null);
  const incomingAgentId = incoming.agentId?.trim() || (incoming.key ? agentIdFromSessionKey(incoming.key) : null);
  if (
    !previous
    || !hasConfirmedEmptyTranscript(previous)
    || incoming.activeLeafEntryId !== undefined
    || incoming.key !== previous.key
    || incoming.sessionId !== previous.sessionId
    || incomingAgentId !== previousAgentId
  ) {
    return incoming;
  }

  return { ...incoming, activeLeafEntryId: null };
}

export function shouldLoadActiveSessionHistory(params: {
  readonly previousSessionKey: string | null;
  readonly activeSessionKey: string;
  readonly messageCount: number;
  readonly confirmedEmptyTranscript: boolean;
}): boolean {
  if (params.confirmedEmptyTranscript) return false;
  return params.previousSessionKey !== params.activeSessionKey || params.messageCount === 0;
}

export function shouldWarmUpHistoryBeforeFirstSend(params: {
  readonly messageCount: number;
  readonly confirmedEmptyTranscript: boolean;
}): boolean {
  return params.messageCount === 0 && !params.confirmedEmptyTranscript;
}
