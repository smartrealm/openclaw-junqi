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
