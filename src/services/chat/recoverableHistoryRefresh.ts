import { startRecoverableTask } from '@/utils/recoverableTask';

export type SessionHistoryLoad = (
  sessionKey: string,
  options: { force: true; background: true },
) => Promise<void>;

export type SessionHistoryFailureReporter = (sessionKey: string, error: unknown) => void;

/** 将非用户点击触发的强制历史刷新限制在对应会话的可恢复错误边界内。 */
export function scheduleRecoverableSessionHistoryRefresh(
  sessionKey: string,
  loadHistory: SessionHistoryLoad,
  reportFailure: SessionHistoryFailureReporter,
): void {
  startRecoverableTask(
    () => loadHistory(sessionKey, { force: true, background: true }),
    (error) => reportFailure(sessionKey, error),
  );
}
