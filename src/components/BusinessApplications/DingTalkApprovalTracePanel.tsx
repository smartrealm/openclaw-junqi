import { CircleDashed, Clock3, RefreshCw, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/shared/button/Button';
import type {
  DingTalkApprovalRecordProjection,
  DingTalkApprovalTaskProjection,
  DingTalkApprovalTraceProjection,
} from '@/business-applications/dingtalkApproval';

function statusLabel(status: string | null, fallback: string): string {
  return status ?? fallback;
}

function TraceIcon({ status }: { status: string | null }) {
  return status
    ? <CircleDashed size={13} className="text-aegis-warning" />
    : <Clock3 size={13} className="text-aegis-text-dim" />;
}

function recordLabel(record: DingTalkApprovalRecordProjection, fallback: string): string {
  return record.action ?? record.status ?? fallback;
}

function taskLabel(task: DingTalkApprovalTaskProjection, fallback: string): string {
  return task.action ?? task.status ?? fallback;
}

export function DingTalkApprovalTracePanel({
  trace,
  loading,
  error,
  refreshAvailable,
  complete,
  onRefresh,
}: {
  trace: DingTalkApprovalTraceProjection;
  loading: boolean;
  error: string | null;
  refreshAvailable: boolean;
  complete: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  if (!trace.instance && trace.tasks.length === 0 && trace.records.length === 0) {
    return (
      <EmptyState
        density="compact"
        iconStyle="bare"
        icon={<Clock3 size={20} />}
        title={t('businessApplications.approvalTrace.emptyTitle')}
        description={t('businessApplications.approvalTrace.emptyDescription')}
      />
    );
  }

  return (
    <section className="mt-3 border-t border-aegis-border pt-3" aria-labelledby="dingtalk-approval-trace-title">
      <div className="flex items-center justify-between gap-2">
        <h3 id="dingtalk-approval-trace-title" className="text-[10.5px] font-semibold text-aegis-text-secondary">{t('businessApplications.approvalTrace.title')}</h3>
        <Button
          size="xs"
          variant="ghost"
          loading={loading}
          disabled={!refreshAvailable}
          leadingIcon={<RefreshCw size={11} />}
          onClick={onRefresh}
        >
          {t('businessApplications.approvalTrace.refresh')}
        </Button>
      </div>
      {trace.observedAt && <time className="mt-1 block text-[9px] text-aegis-text-dim" dateTime={trace.observedAt}>{t('businessApplications.approvalTrace.observedAt', { time: new Date(trace.observedAt).toLocaleString() })}</time>}
      {!refreshAvailable && <p className="mt-1 text-[9.5px] leading-4 text-aegis-text-dim">{t('businessApplications.approvalTrace.refreshUnavailable')}</p>}
      {refreshAvailable && !complete && <p className="mt-1 text-[9.5px] leading-4 text-aegis-warning">{t('businessApplications.approvalTrace.partialTools')}</p>}
      {error && <p className="mt-1 whitespace-pre-wrap text-[9.5px] leading-4 text-aegis-danger">{error}</p>}
      {trace.instance && (
        <dl className="mt-2 grid grid-cols-[68px_minmax(0,1fr)] gap-y-1.5 border-y border-aegis-border/70 py-2 text-[9.5px]">
          <dt className="text-aegis-text-dim">{t('businessApplications.approvalTrace.instance')}</dt>
          <dd className="truncate font-mono text-aegis-text-secondary" title={trace.instance.processInstanceId ?? undefined}>{trace.instance.processInstanceId ?? t('businessApplications.approvalTrace.notReturned')}</dd>
          <dt className="text-aegis-text-dim">{t('businessApplications.approvalTrace.process')}</dt>
          <dd className="truncate text-aegis-text-secondary">{trace.instance.title ?? trace.instance.processCode ?? t('businessApplications.approvalTrace.notReturned')}</dd>
          <dt className="text-aegis-text-dim">{t('businessApplications.approvalTrace.status')}</dt>
          <dd className="text-aegis-text-secondary">{statusLabel(trace.instance.status, t('businessApplications.approvalTrace.statusNotReturned'))}</dd>
        </dl>
      )}
      {(trace.records.length > 0 || trace.tasks.length > 0) && (
        <ol className="mt-2 space-y-1.5">
          {trace.records.map((record, index) => (
            <li key={`record-${record.recordId ?? index}`} className="grid grid-cols-[16px_minmax(0,1fr)] gap-2 rounded-md border border-aegis-border/70 bg-aegis-bg/35 px-2 py-2">
              <span className="pt-0.5"><TraceIcon status={record.status} /></span>
              <div className="min-w-0">
                <div className="truncate text-[10px] font-medium text-aegis-text-secondary">{recordLabel(record, t('businessApplications.approvalTrace.recordFallback'))}</div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[9px] text-aegis-text-dim">
                  {record.actorId && <span className="inline-flex items-center gap-1"><UserRound size={10} />{record.actorId}</span>}
                  {record.occurredAt && <time dateTime={record.occurredAt}>{record.occurredAt}</time>}
                  {record.status && <span>{statusLabel(record.status, t('businessApplications.approvalTrace.statusNotReturned'))}</span>}
                </div>
                {record.remark && <p className="mt-1 break-words text-[9.5px] leading-4 text-aegis-text-dim">{record.remark}</p>}
              </div>
            </li>
          ))}
          {trace.tasks.map((task, index) => (
            <li key={`task-${task.taskId ?? index}`} className="grid grid-cols-[16px_minmax(0,1fr)] gap-2 rounded-md border border-aegis-warning/20 bg-aegis-warning/[0.04] px-2 py-2">
              <span className="pt-0.5"><TraceIcon status={task.status} /></span>
              <div className="min-w-0">
                <div className="truncate text-[10px] font-medium text-aegis-text-secondary">{taskLabel(task, t('businessApplications.approvalTrace.taskFallback'))}</div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[9px] text-aegis-text-dim">
                  {task.taskId && <span className="font-mono">task {task.taskId}</span>}
                  {task.assigneeId && <span className="inline-flex items-center gap-1"><UserRound size={10} />{task.assigneeId}</span>}
                  {task.status && <span>{statusLabel(task.status, t('businessApplications.approvalTrace.statusNotReturned'))}</span>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
