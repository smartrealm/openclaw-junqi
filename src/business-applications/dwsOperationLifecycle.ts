export type DingTalkDwsOperationPhase =
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type DwsDialogDismissAction = 'request-cancel' | 'dismiss';

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
  return phase === 'starting' || phase === 'running' || phase === 'cancelling';
}

export function resolveDwsDialogDismissAction(
  phase: DingTalkDwsOperationPhase | null | undefined,
): DwsDialogDismissAction {
  return isDwsOperationActive(phase) ? 'request-cancel' : 'dismiss';
}
