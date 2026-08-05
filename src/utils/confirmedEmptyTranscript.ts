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
 * A sessions.list row can omit the leaf while the just-created session is
 * already known to be empty. Keep that creation fact only for the exact same
 * Gateway identity; an explicit leaf or any identity uncertainty remains
 * authoritative and replaces the local projection.
 */
export function preserveConfirmedEmptyTranscriptLeaf<T extends ConfirmedEmptyTranscriptSession>(
  previous: ConfirmedEmptyTranscriptSession | undefined,
  incoming: T,
): T {
  if (
    !previous
    || !hasConfirmedEmptyTranscript(previous)
    || incoming.activeLeafEntryId !== undefined
    || incoming.key !== previous.key
    || incoming.sessionId !== previous.sessionId
    || incoming.agentId !== previous.agentId
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
