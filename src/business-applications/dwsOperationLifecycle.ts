export type DingTalkDwsOperationPhase =
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type DwsOperationStartGuard = {
  current: boolean;
};

export function claimDwsOperationStart(guard: DwsOperationStartGuard): boolean {
  if (guard.current) return false;
  guard.current = true;
  return true;
}

export function releaseDwsOperationStart(guard: DwsOperationStartGuard): void {
  guard.current = false;
}

export function isDwsOperationActive(
  phase: DingTalkDwsOperationPhase | null | undefined,
): boolean {
  return phase === 'starting' || phase === 'running';
}
