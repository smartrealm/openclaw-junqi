import { RefreshCw, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useTaskExecutionCheckpoint } from '@/task-execution/useTaskExecutionCheckpoint';
import type { TaskRunStatus } from '@/task-execution/types';

interface TaskExecutionRecoveryBannerProps {
  sessionKey: string;
  sessionId?: string;
  connected: boolean;
  onReconcile: () => Promise<void> | void;
  compact?: boolean;
}

function attentionStatus(status: TaskRunStatus, historyActive: boolean | null): boolean {
  if (status === 'running') return historyActive === false;
  return status === 'pending'
    || status === 'cancel_requested'
    || status === 'verification_required';
}

function statusKey(status: TaskRunStatus): string {
  switch (status) {
    case 'pending': return 'chat.taskRecovery.statusPending';
    case 'running': return 'chat.taskRecovery.statusRunning';
    case 'cancel_requested': return 'chat.taskRecovery.statusCancelRequested';
    case 'verification_required': return 'chat.taskRecovery.statusVerificationRequired';
    default: return 'chat.taskRecovery.statusUnknown';
  }
}

export function TaskExecutionRecoveryBanner({
  sessionKey,
  sessionId,
  connected,
  onReconcile,
  compact = false,
}: TaskExecutionRecoveryBannerProps) {
  const { t } = useTranslation();
  const { checkpoint } = useTaskExecutionCheckpoint(sessionKey, sessionId);
  const [reconciling, setReconciling] = useState(false);
  const run = checkpoint?.runs
    .filter((candidate) => attentionStatus(candidate.status, candidate.historyActive))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (!run) return null;

  const unresolvedToolCount = checkpoint?.nodes.filter((node) => (
    node.runId === run.runId
    && node.kind === 'tool_reconciliation'
    && node.status === 'verification_required'
  )).length ?? 0;

  const reconcile = async () => {
    if (reconciling || !connected) return;
    setReconciling(true);
    try {
      await onReconcile();
    } finally {
      setReconciling(false);
    }
  };

  return (
    <div
      className={clsx(
        'shrink-0 border-b border-aegis-warning/25 bg-aegis-warning/[0.07] text-aegis-warning',
        compact ? 'px-3 py-2' : 'px-4 py-2.5',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-[920px] items-center gap-2.5">
        <ShieldAlert size={compact ? 14 : 16} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold">
            {t('chat.taskRecovery.title')}
          </div>
          <div className="truncate text-[10px] opacity-80">
            {t('chat.taskRecovery.detail', {
              status: t(statusKey(run.status)),
              tools: unresolvedToolCount,
            })}
          </div>
        </div>
        <button
          type="button"
          onClick={() => { void reconcile(); }}
          disabled={!connected || reconciling}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-aegis-warning/35 px-2 py-1 text-[10px] font-medium transition-colors hover:bg-aegis-warning/10 disabled:cursor-not-allowed disabled:opacity-50"
          title={t('chat.taskRecovery.reconcile')}
        >
          <RefreshCw size={11} className={reconciling ? 'animate-spin' : undefined} />
          {t('chat.taskRecovery.reconcile')}
        </button>
      </div>
    </div>
  );
}
