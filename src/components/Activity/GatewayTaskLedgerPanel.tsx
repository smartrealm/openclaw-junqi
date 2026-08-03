import { Ban, ChevronDown, Clock3, Info, ListTodo, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { showConfirm } from '@/components/shared/AlertDialog';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { useGatewayTaskLedger } from '@/hooks/useGatewayTaskLedger';
import { formatTraceTimestamp } from '@/components/Chat/chatResponseTracePresentation';
import type { OpenClawTaskSummary } from '@/services/gateway/taskLedger';

function taskTime(task: OpenClawTaskSummary): number | undefined {
  return task.updatedAt ?? task.startedAt ?? task.createdAt;
}

function statusTone(status: OpenClawTaskSummary['status']): string {
  if (status === 'running') return 'text-aegis-primary';
  if (status === 'queued') return 'text-aegis-warning';
  if (status === 'failed' || status === 'timed_out') return 'text-aegis-danger';
  if (status === 'completed') return 'text-aegis-success';
  return 'text-aegis-text-dim';
}

function taskDetailsId(taskId: string): string {
  return `gateway-task-details-${encodeURIComponent(taskId)}`;
}

function TaskDetails({ task, locale, t }: {
  task: OpenClawTaskSummary;
  locale: string;
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string;
}) {
  const fields: Array<{ label: string; value: string }> = [
    { label: t('activity.taskDetail.id', '任务 ID'), value: task.id },
    { label: t('activity.taskDetail.status', '状态'), value: t(`activity.taskStatus.${task.status}`, task.status) },
    ...(task.title ? [{ label: t('activity.taskDetail.title', '标题'), value: task.title }] : []),
    ...(task.kind ? [{ label: t('activity.taskDetail.kind', '类型'), value: task.kind }] : []),
    ...(task.runtime ? [{ label: t('activity.taskDetail.runtime', '运行时'), value: task.runtime }] : []),
    ...(task.agentId ? [{ label: t('activity.taskDetail.agent', 'Agent'), value: task.agentId }] : []),
    ...(task.runId ? [{ label: t('activity.taskDetail.run', '运行 ID'), value: task.runId }] : []),
    ...(task.sessionKey ? [{ label: t('activity.taskDetail.session', '会话'), value: task.sessionKey }] : []),
    ...(task.childSessionKey ? [{ label: t('activity.taskDetail.childSession', '子会话'), value: task.childSessionKey }] : []),
    ...(task.ownerKey ? [{ label: t('activity.taskDetail.owner', '所有者'), value: task.ownerKey }] : []),
    ...(task.taskId ? [{ label: t('activity.taskDetail.task', '关联任务'), value: task.taskId }] : []),
    ...(task.flowId ? [{ label: t('activity.taskDetail.flow', '流程 ID'), value: task.flowId }] : []),
    ...(task.parentTaskId ? [{ label: t('activity.taskDetail.parent', '父任务'), value: task.parentTaskId }] : []),
    ...(task.sourceId ? [{ label: t('activity.taskDetail.source', '来源 ID'), value: task.sourceId }] : []),
    ...(task.createdAt !== undefined ? [{ label: t('activity.taskDetail.created', '创建时间'), value: formatTraceTimestamp(task.createdAt, locale) }] : []),
    ...(task.updatedAt !== undefined ? [{ label: t('activity.taskDetail.updated', '更新时间'), value: formatTraceTimestamp(task.updatedAt, locale) }] : []),
    ...(task.startedAt !== undefined ? [{ label: t('activity.taskDetail.started', '开始时间'), value: formatTraceTimestamp(task.startedAt, locale) }] : []),
    ...(task.endedAt !== undefined ? [{ label: t('activity.taskDetail.ended', '结束时间'), value: formatTraceTimestamp(task.endedAt, locale) }] : []),
    ...(task.progressSummary ? [{ label: t('activity.taskDetail.progress', '进度'), value: task.progressSummary }] : []),
    ...(task.terminalSummary ? [{ label: t('activity.taskDetail.terminalSummary', '终态摘要'), value: task.terminalSummary }] : []),
    ...(task.error ? [{ label: t('activity.taskDetail.error', '错误'), value: task.error }] : []),
  ];

  return (
    <dl className="grid min-w-0 grid-cols-1 gap-x-5 gap-y-2 text-[10px] sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field.label} className="min-w-0">
          <dt className="text-aegis-text-dim">{field.label}</dt>
          <dd className="mt-0.5 break-words font-mono text-aegis-text-muted">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function GatewayTaskLedgerPanel() {
  const { t, i18n } = useTranslation();
  const ledger = useGatewayTaskLedger();
  const tasks = [...ledger.tasks]
    .sort((left, right) => (taskTime(right) ?? 0) - (taskTime(left) ?? 0))
    .slice(0, 8);

  const confirmCancel = (task: OpenClawTaskSummary) => {
    showConfirm(
      t('activity.taskCancelTitle', '取消后台任务'),
      t('activity.taskCancelMessage', '将向 Gateway 请求取消“{{title}}”。最终状态以 Gateway 返回为准。', {
        title: task.title || task.id,
      }),
      async () => {
        const cancelled = await ledger.cancel(task.id);
        if (!cancelled) throw new Error(t('activity.taskCancelFailed', 'Gateway 未确认任务已取消。'));
      },
    );
  };

  return (
    <section className="border-y border-aegis-border bg-aegis-card" aria-label={t('activity.gatewayTasksTitle', 'Gateway 后台任务')}>
      <div className="flex items-center justify-between gap-3 border-b border-aegis-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ListTodo size={14} className="shrink-0 text-aegis-primary" />
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold text-aegis-text">{t('activity.gatewayTasksTitle', 'Gateway 后台任务')}</h2>
            <p className="mt-0.5 text-[10px] text-aegis-text-dim">{t('activity.gatewayTasksSubtitle', '来自 OpenClaw task ledger 的运行摘要')}</p>
          </div>
          <span className="font-mono text-[10px] text-aegis-text-dim">{ledger.tasks.length}</span>
        </div>
        <button
          type="button"
          onClick={() => { void ledger.refresh(); }}
          disabled={ledger.loading}
          className="grid size-7 shrink-0 place-items-center rounded-md border border-aegis-border text-aegis-text-dim transition-colors hover:text-aegis-text disabled:opacity-50"
          title={t('common.refresh', '刷新')}
          aria-label={t('common.refresh', '刷新')}
        >
          <RefreshCw size={12} className={ledger.loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {ledger.unavailable && (
        <div className="border-b border-aegis-warning/20 bg-aegis-warning/[0.04] px-4 py-2 text-[10.5px] text-aegis-warning">
          {t('activity.gatewayTasksUnavailable', 'Gateway task ledger 当前不可用，保留已加载的摘要。')}
        </div>
      )}
      {tasks.length === 0 ? (
        <div className="flex min-h-[92px] items-center justify-center px-4 text-[11px] text-aegis-text-dim">
          {ledger.loading ? <LoadingIndicator size={14} className="mr-2" label={t('common.loading', '加载中')} /> : <Clock3 size={14} className="mr-2" />}
          {ledger.loading ? t('common.loading', '加载中') : t('activity.gatewayTasksEmpty', 'Gateway 没有返回后台任务。')}
        </div>
      ) : (
        <div className="divide-y divide-[rgb(var(--aegis-overlay)/0.06)]">
          {tasks.map((task) => {
            const cancellable = task.status === 'queued' || task.status === 'running';
            const timestamp = taskTime(task);
            const expanded = ledger.expandedTaskId === task.id;
            const detail = ledger.taskDetails.get(task.id);
            const detailsId = taskDetailsId(task.id);
            return (
              <div key={task.id} className="min-w-0">
                <div className="flex min-w-0 items-start gap-3 px-4 py-2.5">
                  <span className={`mt-0.5 shrink-0 text-[10px] font-semibold ${statusTone(task.status)}`}>
                    {t(`activity.taskStatus.${task.status}`, task.status)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11.5px] font-medium text-aegis-text">{task.title || task.kind || task.id}</div>
                    <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[9.5px] text-aegis-text-dim">
                      {task.runtime && <span>{task.runtime}</span>}
                      {task.agentId && <span>{task.agentId}</span>}
                      {timestamp !== undefined && <span>{formatTraceTimestamp(timestamp, i18n.language)}</span>}
                      {task.progressSummary && <span className="max-w-[260px] truncate" title={task.progressSummary}>{task.progressSummary}</span>}
                      {task.error && <span className="max-w-[260px] truncate text-aegis-danger" title={task.error}>{task.error}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => { void ledger.inspect(task.id); }}
                      aria-expanded={expanded}
                      aria-controls={detailsId}
                      className="grid size-7 place-items-center rounded-md border border-aegis-border text-aegis-text-dim transition-colors hover:text-aegis-text disabled:opacity-50"
                      title={t('activity.inspectTask', '查看任务详情')}
                      aria-label={t('activity.inspectTask', '查看任务详情')}
                    >
                      {ledger.inspectingTaskIds.has(task.id)
                        ? <LoadingIndicator size={12} label={t('common.loading', '加载中')} />
                        : <ChevronDown size={13} className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />}
                    </button>
                    {cancellable && (
                      <button
                        type="button"
                        onClick={() => confirmCancel(task)}
                        disabled={ledger.cancellingTaskIds.has(task.id)}
                        className="grid size-7 shrink-0 place-items-center rounded-md border border-aegis-danger/25 text-aegis-danger/75 transition-colors hover:border-aegis-danger/50 hover:text-aegis-danger disabled:opacity-45"
                        title={t('activity.cancelTask', '取消任务')}
                        aria-label={t('activity.cancelTask', '取消任务')}
                      >
                        {ledger.cancellingTaskIds.has(task.id) ? <LoadingIndicator size={12} label={t('common.loading', '加载中')} /> : <Ban size={12} />}
                      </button>
                    )}
                  </div>
                </div>
                {expanded && (
                  <div id={detailsId} className="border-t border-aegis-border/60 bg-[rgb(var(--aegis-overlay)/0.02)] px-4 py-3">
                    {ledger.taskDetailErrors.has(task.id) ? (
                      <div className="flex items-center gap-2 text-[10px] text-aegis-warning">
                        <Info size={12} />
                        {t('activity.taskDetailsUnavailable', '任务详情暂时不可用，请稍后重试。')}
                      </div>
                    ) : detail ? (
                      <TaskDetails task={detail} locale={i18n.language} t={t} />
                    ) : (
                      <div className="flex items-center gap-2 text-[10px] text-aegis-text-dim">
                        <LoadingIndicator size={12} label={t('common.loading', '加载中')} />
                        {t('common.loading', '加载中')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
