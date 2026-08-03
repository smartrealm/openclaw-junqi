import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  ChevronDown,
  CircleStop,
  Clock3,
  FileText,
  LoaderCircle,
  RefreshCw,
  TerminalSquare,
  Wrench,
} from 'lucide-react';
import clsx from 'clsx';
import { showConfirm } from '@/components/shared/AlertDialog';
import {
  useOpenClawTaskLedgerStore,
  type OpenClawTaskLedgerStatus,
  type OpenClawTaskSummary,
} from '@/stores/openclawTaskLedgerStore';

const TASK_REFRESH_INTERVAL_MS = 15_000;

function statusLabel(status: OpenClawTaskLedgerStatus, t: (key: string, fallback: string) => string): string {
  if (status === 'queued') return t('activity.tasks.statusQueued', 'Queued');
  if (status === 'running') return t('activity.tasks.statusRunning', 'Running');
  if (status === 'completed') return t('activity.tasks.statusCompleted', 'Completed');
  if (status === 'failed') return t('activity.tasks.statusFailed', 'Failed');
  if (status === 'cancelled') return t('activity.tasks.statusCancelled', 'Cancelled');
  return t('activity.tasks.statusTimedOut', 'Timed out');
}

function statusClass(status: OpenClawTaskLedgerStatus): string {
  if (status === 'running') return 'text-aegis-primary bg-aegis-primary/10';
  if (status === 'completed') return 'text-aegis-success bg-aegis-success/10';
  if (status === 'failed' || status === 'timed_out') return 'text-aegis-danger bg-aegis-danger/10';
  if (status === 'cancelled') return 'text-aegis-text-dim bg-aegis-hover';
  return 'text-aegis-warning bg-aegis-warning/10';
}

function taskTitle(task: OpenClawTaskSummary): string {
  return task.title ?? task.progressSummary ?? task.terminalSummary ?? task.id;
}

function formatTimestamp(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function metadata(task: OpenClawTaskSummary): Array<{ label: string; value: string }> {
  const fields: Array<[string, string | undefined]> = [
    ['kind', task.kind],
    ['runtime', task.runtime],
    ['agentId', task.agentId],
    ['sessionKey', task.sessionKey],
    ['childSessionKey', task.childSessionKey],
    ['ownerKey', task.ownerKey],
    ['runId', task.runId],
    ['taskId', task.taskId],
    ['flowId', task.flowId],
    ['parentTaskId', task.parentTaskId],
    ['sourceId', task.sourceId],
    ['lastToolName', task.lastToolName],
  ];
  return fields.flatMap(([label, value]) => value === undefined ? [] : [{ label, value }]);
}

function TaskDetails({ task }: { task: OpenClawTaskSummary }) {
  const { t } = useTranslation();
  const fields = metadata(task);
  const timestampFields: Array<[string, string | null]> = [
    [t('activity.tasks.createdAt', 'Created'), formatTimestamp(task.createdAt)],
    [t('activity.tasks.updatedAt', 'Updated'), formatTimestamp(task.updatedAt)],
    [t('activity.tasks.startedAt', 'Started'), formatTimestamp(task.startedAt)],
    [t('activity.tasks.endedAt', 'Ended'), formatTimestamp(task.endedAt)],
  ];
  const timestamps: Array<{ label: string; value: string }> = timestampFields.flatMap(([label, value]) => (
    value === null ? [] : [{ label, value }]
  ));

  return (
    <div className="border-t border-aegis-border bg-aegis-hover/25 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.length > 0 && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-[10px] text-aegis-text-dim">
            {fields.map((field) => (
              <div key={field.label} className="contents">
                <dt className="font-mono">{field.label}</dt>
                <dd className="truncate font-mono text-aegis-text-secondary" title={field.value}>{field.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {timestamps.length > 0 && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-[10px] text-aegis-text-dim">
            {timestamps.map((field) => (
              <div key={field.label} className="contents">
                <dt>{field.label}</dt>
                <dd className="font-mono text-aegis-text-secondary">{field.value}</dd>
              </div>
            ))}
            {task.toolUseCount !== undefined && (
              <div className="contents">
                <dt>{t('activity.tasks.toolUseCount', 'Tool uses')}</dt>
                <dd className="font-mono text-aegis-text-secondary">{task.toolUseCount}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
      {task.progressSummary && <p className="mt-3 whitespace-pre-wrap break-words text-[11px] leading-5 text-aegis-text-secondary">{task.progressSummary}</p>}
      {task.terminalSummary && <p className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-aegis-text-secondary">{task.terminalSummary}</p>}
      {task.error && <p className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-aegis-danger">{task.error}</p>}
      {task.prompt !== undefined && (
        <div className="mt-3 border-t border-aegis-border pt-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-aegis-text-dim"><FileText size={11} />{t('activity.tasks.prompt', 'Prompt')}</div>
          <p className="whitespace-pre-wrap break-words text-[11px] leading-5 text-aegis-text-secondary">{task.prompt}</p>
        </div>
      )}
    </div>
  );
}

function TaskRow({ connected, task }: { connected: boolean; task: OpenClawTaskSummary }) {
  const { t } = useTranslation();
  const detailsById = useOpenClawTaskLedgerStore((state) => state.detailsById);
  const detailLoadingId = useOpenClawTaskLedgerStore((state) => state.detailLoadingId);
  const detailErrors = useOpenClawTaskLedgerStore((state) => state.detailErrors);
  const cancellingTaskId = useOpenClawTaskLedgerStore((state) => state.cancellingTaskId);
  const loadDetail = useOpenClawTaskLedgerStore((state) => state.loadDetail);
  const cancel = useOpenClawTaskLedgerStore((state) => state.cancel);
  const [expanded, setExpanded] = useState(false);
  const detail = detailsById[task.id];
  const canCancel = task.status === 'queued' || task.status === 'running';
  const time = formatTimestamp(task.updatedAt ?? task.createdAt);

  const toggleDetail = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && !detail && detailLoadingId !== task.id) {
      void loadDetail(connected, task.id);
    }
  };

  const confirmCancel = () => {
    showConfirm(
      t('activity.tasks.cancelTitle', 'Cancel native task'),
      t('activity.tasks.cancelMessage', 'OpenClaw will be asked to cancel this task. This does not delete its ledger record.'),
      () => cancel(connected, task),
    );
  };

  return (
    <article className="border-t border-aegis-border first:border-t-0">
      <div className="flex min-w-0 items-start gap-3 px-4 py-3">
        <TerminalSquare size={15} className="mt-0.5 shrink-0 text-aegis-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <strong className="min-w-0 break-words text-[12px] font-semibold text-aegis-text">{taskTitle(task)}</strong>
            <span className={clsx('shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px]', statusClass(task.status))}>{statusLabel(task.status, (key, fallback) => t(key, fallback))}</span>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-aegis-text-dim">
            <span className="max-w-[230px] truncate font-mono" title={task.id}>{task.id}</span>
            {task.agentId && <span className="inline-flex items-center gap-1"><Bot size={10} />{task.agentId}</span>}
            {task.lastToolName && <span className="inline-flex items-center gap-1 font-mono"><Wrench size={10} />{task.lastToolName}</span>}
            {time && <span className="inline-flex items-center gap-1"><Clock3 size={10} />{time}</span>}
          </div>
          {task.progressSummary && <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-aegis-text-secondary">{task.progressSummary}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={toggleDetail}
            disabled={!connected}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-45"
            title={expanded ? t('activity.tasks.hideDetails', 'Hide details') : t('activity.tasks.showDetails', 'Show details')}
            aria-label={expanded ? t('activity.tasks.hideDetails', 'Hide details') : t('activity.tasks.showDetails', 'Show details')}
            aria-expanded={expanded}
          >
            {detailLoadingId === task.id ? <LoaderCircle size={13} className="animate-spin" /> : <ChevronDown size={14} className={clsx(expanded && 'rotate-180')} />}
          </button>
          {canCancel && (
            <button
              type="button"
              onClick={confirmCancel}
              disabled={!connected || cancellingTaskId !== null}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-danger/10 hover:text-aegis-danger disabled:cursor-not-allowed disabled:opacity-45"
              title={t('activity.tasks.cancel', 'Cancel task')}
              aria-label={t('activity.tasks.cancel', 'Cancel task')}
            >
              {cancellingTaskId === task.id ? <LoaderCircle size={13} className="animate-spin" /> : <CircleStop size={14} />}
            </button>
          )}
        </div>
      </div>
      {expanded && detail && <TaskDetails task={detail} />}
      {expanded && detailErrors[task.id] && <p className="border-t border-aegis-danger/20 bg-aegis-danger/5 px-4 py-2 text-[10.5px] text-aegis-danger" role="alert">{detailErrors[task.id]}</p>}
    </article>
  );
}

export function OpenClawTaskLedgerPanel({ connected }: { connected: boolean }) {
  const { t } = useTranslation();
  const page = useOpenClawTaskLedgerStore((state) => state.page);
  const loading = useOpenClawTaskLedgerStore((state) => state.loading);
  const error = useOpenClawTaskLedgerStore((state) => state.error);
  const refresh = useOpenClawTaskLedgerStore((state) => state.refresh);
  const loadMore = useOpenClawTaskLedgerStore((state) => state.loadMore);

  useEffect(() => {
    void refresh(connected, true);
    if (!connected) return undefined;
    const timer = window.setInterval(() => void refresh(true, false), TASK_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [connected, refresh]);

  const unavailable = page?.availability === 'unavailable';
  const canLoadMore = page?.availability === 'available' && page.nextCursor !== undefined;

  return (
    <section className="overflow-hidden rounded-lg border border-aegis-border bg-aegis-card" aria-labelledby="openclaw-task-ledger-title">
      <div className="flex items-center justify-between gap-3 border-b border-aegis-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <TerminalSquare size={15} className="shrink-0 text-aegis-primary" />
          <h2 id="openclaw-task-ledger-title" className="truncate text-[13px] font-semibold text-aegis-text">{t('activity.tasks.title', 'OpenClaw task ledger')}</h2>
          {page?.availability === 'available' && <span className="rounded bg-aegis-hover px-1.5 py-0.5 font-mono text-[10px] text-aegis-text-dim">{page.tasks.length}</span>}
        </div>
        <button
          type="button"
          onClick={() => void refresh(connected, true)}
          disabled={!connected || loading}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-wait disabled:opacity-45"
          title={t('common.refresh', 'Refresh')}
          aria-label={t('common.refresh', 'Refresh')}
        >
          <RefreshCw size={12} className={clsx(loading && 'animate-spin')} />
        </button>
      </div>
      {!connected ? (
        <p className="px-4 py-4 text-[11px] text-aegis-text-dim">{t('activity.tasks.offline', 'Connect to Gateway to inspect the native task ledger.')}</p>
      ) : loading && !page ? (
        <p className="px-4 py-4 text-[11px] text-aegis-text-dim">{t('activity.tasks.loading', 'Loading native tasks')}</p>
      ) : error && !page ? (
        <p className="px-4 py-4 text-[11px] text-aegis-danger" role="alert">{error}</p>
      ) : unavailable ? (
        <p className="px-4 py-4 text-[11px] text-aegis-text-dim">{t('activity.tasks.unsupported', 'This Gateway does not expose native task ledger methods.')}</p>
      ) : page?.tasks.length === 0 ? (
        <p className="px-4 py-4 text-[11px] text-aegis-text-dim">{t('activity.tasks.empty', 'No native tasks are recorded by this Gateway.')}</p>
      ) : (
        <>
          {error && <p className="border-b border-aegis-danger/20 bg-aegis-danger/5 px-4 py-2 text-[10.5px] text-aegis-danger" role="alert">{error}</p>}
          {page?.tasks.map((task) => <TaskRow key={task.id} connected={connected} task={task} />)}
          {canLoadMore && (
            <div className="border-t border-aegis-border px-4 py-3">
              <button type="button" onClick={() => void loadMore(connected)} disabled={loading} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-aegis-border px-2.5 text-[10.5px] font-medium text-aegis-text-secondary transition-colors hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-wait disabled:opacity-45">
                {loading && <LoaderCircle size={12} className="animate-spin" />}{t('activity.tasks.loadMore', 'Load more')}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default OpenClawTaskLedgerPanel;
