import { Ban, Check, Clock3, LoaderCircle, Puzzle, RefreshCw, ShieldCheck, TerminalSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { showAlert, showConfirm } from '@/components/shared/AlertDialog';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { useGatewayApprovals } from '@/hooks/useGatewayApprovals';
import type { ApprovalDecision, ApprovalRecord } from '@/services/gateway/approvals';

function formatExpiry(expiresAtMs: number, language: string): string {
  const remaining = expiresAtMs - Date.now();
  if (remaining <= 0) return new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(0, 'second');
  if (remaining < 60_000) return new Intl.RelativeTimeFormat(language, { numeric: 'always' }).format(Math.ceil(remaining / 1000), 'second');
  return new Intl.RelativeTimeFormat(language, { numeric: 'always' }).format(Math.ceil(remaining / 60_000), 'minute');
}

function requestContext(record: ApprovalRecord): string[] {
  const values = record.kind === 'exec'
    ? [record.request.agentId, record.request.sessionKey, record.request.host]
    : [record.request.agentId, record.request.sessionKey, record.request.pluginId];
  return values.filter((value): value is string => Boolean(value?.trim()));
}

export function GatewayApprovalPanel() {
  const { t, i18n } = useTranslation();
  const approvals = useGatewayApprovals(true);

  const confirmResolve = (record: ApprovalRecord, decision: ApprovalDecision) => {
    const decisionLabel = t(`activity.approval.decision.${decision}`);
    showConfirm(
      t('activity.approval.confirmTitle'),
      t('activity.approval.confirmMessage', {
        decision: decisionLabel,
        subject: record.kind === 'exec'
          ? record.request.command
          : record.request.title,
      }),
      async () => {
        try {
          await approvals.resolve(record, decision);
        } catch (cause) {
          showAlert(
            t('activity.approval.resolveFailedTitle'),
            cause instanceof Error ? cause.message : String(cause),
            'error',
          );
        }
      },
    );
  };

  return (
    <section className="border-y border-aegis-border bg-aegis-card" aria-label={t('activity.approval.title')}>
      <div className="flex items-center justify-between gap-3 border-b border-aegis-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheck size={14} className="shrink-0 text-aegis-warning" />
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold text-aegis-text">{t('activity.approval.title')}</h2>
            <p className="mt-0.5 text-[10px] text-aegis-text-dim">{t('activity.approval.subtitle')}</p>
          </div>
          <span className="font-mono text-[10px] text-aegis-text-dim">{approvals.approvals.length}</span>
        </div>
        <button
          type="button"
          onClick={() => { void approvals.refresh(); }}
          disabled={approvals.loading}
          className="grid size-7 shrink-0 place-items-center rounded-md border border-aegis-border text-aegis-text-dim transition-colors hover:text-aegis-text disabled:opacity-50"
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
        >
          <RefreshCw size={12} className={approvals.loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {approvals.unavailable && (
        <div className="space-y-1 border-b border-aegis-warning/20 bg-aegis-warning/[0.04] px-4 py-2 text-[10.5px] text-aegis-warning">
          <div>{approvals.connected ? t('activity.approval.unavailable') : t('activity.approval.offline')}</div>
          {approvals.error && <div className="break-words text-[9.5px] text-aegis-text-dim">{approvals.error}</div>}
        </div>
      )}

      {approvals.approvals.length === 0 ? (
        <div className="flex min-h-[92px] items-center justify-center px-4 text-[11px] text-aegis-text-dim">
          {approvals.loading
            ? <LoadingIndicator size={14} className="mr-2" label={t('common.loading')} />
            : <Clock3 size={14} className="mr-2" />}
          {approvals.loading ? t('common.loading') : t('activity.approval.empty')}
        </div>
      ) : (
        <div className="divide-y divide-[rgb(var(--aegis-overlay)/0.06)]">
          {approvals.approvals.map((record) => {
            const contexts = requestContext(record);
            const isResolving = approvals.resolvingIds.has(record.id);
            const requestTitle = record.kind === 'exec' ? record.request.command : record.request.title;
            const requestDescription = record.kind === 'exec'
              ? record.request.warningText || record.request.commandPreview
              : record.request.description;
            return (
              <div key={`${record.kind}:${record.id}`} className="min-w-0 px-4 py-3">
                <div className="flex min-w-0 items-start gap-2">
                  {record.kind === 'exec'
                    ? <TerminalSquare size={13} className="mt-0.5 shrink-0 text-aegis-danger" />
                    : <Puzzle size={13} className="mt-0.5 shrink-0 text-aegis-warning" />}
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-[11.5px] font-semibold text-aegis-text">{requestTitle}</div>
                    {requestDescription && <div className="mt-1 break-words text-[10.5px] leading-4 text-aegis-text-muted">{requestDescription}</div>}
                    {contexts.length > 0 && <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-aegis-text-dim">{contexts.map((context) => <span key={context}>{context}</span>)}</div>}
                    <div className="mt-1 flex items-center gap-1 text-[9px] text-aegis-text-dim">
                      <Clock3 size={10} />
                      {t('activity.approval.expires', { time: formatExpiry(record.expiresAtMs, i18n.language) })}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 ps-5">
                  {record.request.allowedDecisions.map((decision) => {
                    const isDeny = decision === 'deny';
                    const isAlways = decision === 'allow-always';
                    return (
                      <button
                        key={decision}
                        type="button"
                        onClick={() => confirmResolve(record, decision)}
                        disabled={isResolving}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors disabled:cursor-wait disabled:opacity-50 ${isDeny ? 'border-aegis-danger/25 text-aegis-danger hover:border-aegis-danger/50' : isAlways ? 'border-aegis-warning/30 text-aegis-warning hover:border-aegis-warning/60' : 'border-aegis-border text-aegis-text-secondary hover:border-aegis-border-hover hover:text-aegis-text'}`}
                        title={t(`activity.approval.decision.${decision}`)}
                        aria-label={t(`activity.approval.decision.${decision}`)}
                      >
                        {isResolving ? <LoaderCircle size={11} className="animate-spin" /> : isDeny ? <Ban size={11} /> : <Check size={11} />}
                        <span>{t(`activity.approval.decision.${decision}`)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
