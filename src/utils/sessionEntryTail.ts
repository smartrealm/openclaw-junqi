export function shouldPositionActiveSessionTail(params: {
  readonly activeSessionKey: string;
  readonly positionedSessionKey: string | null;
  readonly timelineItemCount: number;
}): boolean {
  return Boolean(
    params.activeSessionKey.trim()
      && params.positionedSessionKey !== params.activeSessionKey
      && params.timelineItemCount > 0,
  );
}
