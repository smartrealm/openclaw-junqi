import { ArrowDown, Bot, CircleDot, History, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { formatTraceTimestamp } from '@/components/Chat/chatResponseTracePresentation';
import { useGatewayAuditLedger } from '@/hooks/useGatewayAuditLedger';
import { AUDIT_KINDS, AUDIT_STATUSES, type AuditKind, type AuditStatus, type OpenClawAuditEvent } from '@/processing/auditLedger';

function statusTone(status: AuditStatus): string {
  if (status === 'succeeded') return 'text-aegis-success';
  if (status === 'failed' || status === 'blocked') return 'text-aegis-danger';
  if (status === 'timed_out') return 'text-aegis-warning';
  if (status === 'started') return 'text-aegis-primary';
  return 'text-aegis-text-dim';
}

function eventIcon(event: OpenClawAuditEvent) {
  if (event.kind === 'tool_action') return <Wrench size={12} />;
  return <Bot size={12} />;
}

function eventTitle(event: OpenClawAuditEvent, translate: (key: string, fallback: string) => string): string {
  if (event.toolName) return event.toolName;
  return event.action === 'agent.run.started'
    ? translate('activity.audit.agentStarted', 'Agent run started')
    : translate('activity.audit.agentFinished', 'Agent run finished');
}

export function GatewayAuditLedgerPanel() {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState<AuditKind | ''>('');
  const [status, setStatus] = useState<AuditStatus | ''>('');
  const audit = useGatewayAuditLedger({
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
  });

  return (
    <section className="border-y border-aegis-border bg-aegis-card" aria-label={t('activity.audit.title', 'Gateway 审计账本')}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-aegis-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <History size={14} className="shrink-0 text-aegis-primary" />
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold text-aegis-text">{t('activity.audit.title', 'Gateway 审计账本')}</h2>
            <p className="mt-0.5 text-[10px] text-aegis-text-dim">{t('activity.audit.subtitle', 'OpenClaw 提供的跨运行 metadata-only 记录')}</p>
          </div>
          <span className="font-mono text-[10px] text-aegis-text-dim">{audit.events.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="gateway-audit-kind">{t('activity.audit.kindFilter', '记录类型')}</label>
          <select
            id="gateway-audit-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as AuditKind | '')}
            className="h-7 max-w-[128px] rounded-md border border-aegis-border bg-aegis-card px-2 text-[10px] text-aegis-text-secondary outline-none focus:border-aegis-primary"
          >
            <option value="">{t('activity.audit.allKinds', '全部类型')}</option>
            {AUDIT_KINDS.map((value) => <option key={value} value={value}>{t(`activity.audit.kind.${value}`, value)}</option>)}
          </select>
          <label className="sr-only" htmlFor="gateway-audit-status">{t('activity.audit.statusFilter', '状态')}</label>
          <select
            id="gateway-audit-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as AuditStatus | '')}
            className="h-7 max-w-[128px] rounded-md border border-aegis-border bg-aegis-card px-2 text-[10px] text-aegis-text-secondary outline-none focus:border-aegis-primary"
          >
            <option value="">{t('activity.audit.allStatuses', '全部状态')}</option>
            {AUDIT_STATUSES.map((value) => <option key={value} value={value}>{t(`activity.audit.status.${value}`, value)}</option>)}
          </select>
          <button
            type="button"
            onClick={() => { void audit.refresh(); }}
            disabled={audit.loading}
            className="grid size-7 shrink-0 place-items-center rounded-md border border-aegis-border text-aegis-text-dim transition-colors hover:text-aegis-text disabled:opacity-50"
            title={t('common.refresh', '刷新')}
            aria-label={t('common.refresh', '刷新')}
          >
            <RefreshCw size={12} className={audit.loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {audit.unavailable && (
        <div className="border-b border-aegis-warning/20 bg-aegis-warning/[0.04] px-4 py-2 text-[10.5px] text-aegis-warning">
          {t('activity.audit.unavailable', 'Gateway 审计账本当前不可用，可能是连接、权限或账本配置原因。')}
        </div>
      )}

      {audit.events.length === 0 ? (
        <div className="flex min-h-[92px] items-center justify-center px-4 text-[11px] text-aegis-text-dim">
          {audit.loading ? <LoadingIndicator size={14} className="mr-2" label={t('common.loading', '加载中')} /> : <CircleDot size={14} className="mr-2" />}
          {audit.loading ? t('common.loading', '加载中') : t('activity.audit.empty', '当前筛选没有可显示的审计记录。')}
        </div>
      ) : (
        <div className="divide-y divide-[rgb(var(--aegis-overlay)/0.06)]">
          {audit.events.map((event) => (
            <div key={`${event.eventId}:${event.sequence}`} className="min-w-0 px-4 py-2.5">
              <div className="flex min-w-0 items-start gap-2">
                <span className={`mt-0.5 shrink-0 ${statusTone(event.status)}`} title={t(`activity.audit.status.${event.status}`, event.status)}>{eventIcon(event)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <strong className="truncate text-[11.5px] font-semibold text-aegis-text">{eventTitle(event, t)}</strong>
                    <span className={`font-mono text-[9.5px] ${statusTone(event.status)}`}>{t(`activity.audit.status.${event.status}`, event.status)}</span>
                    <span className="text-[9px] text-aegis-text-dim">{t(`activity.audit.kind.${event.kind}`, event.kind)}</span>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[9.5px] text-aegis-text-dim">
                    <span className="inline-flex items-center gap-1"><ShieldCheck size={10} />{event.agentId}</span>
                    <span className="max-w-[260px] truncate font-mono" title={event.runId}>{t('activity.audit.run', 'run')}: {event.runId}</span>
                    {event.sessionKey && <span className="max-w-[260px] truncate font-mono" title={event.sessionKey}>{t('activity.audit.session', 'session')}: {event.sessionKey}</span>}
                    {event.errorCode && <span className="text-aegis-danger">{event.errorCode}</span>}
                    <span className="font-mono tabular-nums">#{event.sequence}</span>
                    <span>{formatTraceTimestamp(event.occurredAt, i18n.language)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {audit.nextCursor && (
        <div className="flex justify-center border-t border-aegis-border px-4 py-2.5">
          <button
            type="button"
            onClick={() => { void audit.loadMore(); }}
            disabled={audit.loadingMore}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-aegis-border px-2.5 text-[10.5px] text-aegis-text-secondary transition-colors hover:bg-aegis-hover hover:text-aegis-text disabled:opacity-50"
          >
            {audit.loadingMore ? <LoadingIndicator size={12} label={t('common.loading', '加载中')} /> : <ArrowDown size={12} />}
            {t('activity.audit.loadMore', '加载更早记录')}
          </button>
        </div>
      )}
    </section>
  );
}
