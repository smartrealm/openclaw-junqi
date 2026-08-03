import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Check,
  Clock3,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import {
  useOpenClawApprovalsStore,
  type OpenClawApproval,
  type OpenClawApprovalDecision,
} from '@/stores/openclawApprovalsStore';

const APPROVAL_REFRESH_INTERVAL_MS = 15_000;

function decisionLabel(
  decision: OpenClawApprovalDecision,
  t: (key: string, fallback: string) => string,
): string {
  if (decision === 'allow-once') return t('activity.approvals.allowOnce', 'Allow once');
  if (decision === 'allow-always') return t('activity.approvals.allowAlways', 'Allow always');
  return t('activity.approvals.deny', 'Deny');
}

function decisionIcon(decision: OpenClawApprovalDecision) {
  if (decision === 'allow-once') return <Check size={12} aria-hidden="true" />;
  if (decision === 'allow-always') return <ShieldCheck size={12} aria-hidden="true" />;
  return <XCircle size={12} aria-hidden="true" />;
}

function ApprovalMetadata({ approval }: { approval: OpenClawApproval }) {
  const { t } = useTranslation();
  const request = approval.request;
  const expiry = Date.now() >= approval.expiresAtMs
    ? t('activity.approvals.expired', 'Expired')
    : t('activity.approvals.expiresAt', 'Expires {{time}}', {
      time: new Date(approval.expiresAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-aegis-text-dim">
      {request.agentId && <span>{request.agentId}</span>}
      {request.sessionKey && <span className="max-w-[240px] truncate font-mono" title={request.sessionKey}>{request.sessionKey}</span>}
      {'host' in request && request.host && <span>{request.host}</span>}
      {'nodeId' in request && request.nodeId && <span className="font-mono">{request.nodeId}</span>}
      {'toolName' in request && request.toolName && <span className="font-mono">{request.toolName}</span>}
      <span className="inline-flex items-center gap-1"><Clock3 size={10} />{new Date(approval.createdAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      <span>{expiry}</span>
    </div>
  );
}

function ApprovalRow({
  approval,
  resolvingId,
  onResolve,
}: {
  approval: OpenClawApproval;
  resolvingId: string | null;
  onResolve: (approval: OpenClawApproval, decision: OpenClawApprovalDecision) => void;
}) {
  const { t } = useTranslation();
  const decisions = approval.request.allowedDecisions ?? [];
  const expired = Date.now() >= approval.expiresAtMs;
  const title = approval.kind === 'exec'
    ? t('activity.approvals.execTitle', 'Command approval')
    : approval.request.title;
  const detail = approval.kind === 'exec'
    ? approval.request.commandPreview || approval.request.command
    : approval.request.description;
  const severityClass = approval.kind === 'plugin' && approval.request.severity === 'critical'
    ? 'text-aegis-danger'
    : approval.kind === 'plugin' && approval.request.severity === 'warning'
      ? 'text-aegis-warning'
      : 'text-aegis-primary';

  return (
    <article className="border-t border-aegis-border px-4 py-3 first:border-t-0">
      <div className="flex min-w-0 items-start gap-3">
        <span className={clsx('mt-0.5 shrink-0', severityClass)}>
          {approval.kind === 'exec' ? <TerminalSquare size={15} /> : <AlertTriangle size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <strong className="min-w-0 text-[12px] font-semibold text-aegis-text">{title}</strong>
            <span className="shrink-0 font-mono text-[9.5px] text-aegis-text-dim">{approval.kind}</span>
          </div>
          <p className={clsx(
            'mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-aegis-text-secondary',
            approval.kind === 'exec' && 'font-mono',
          )}>{detail}</p>
          <ApprovalMetadata approval={approval} />
          {approval.kind === 'exec' && approval.request.warningText && (
            <p className="mt-1 text-[10.5px] leading-5 text-aegis-warning">{approval.request.warningText}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {decisions.length === 0 ? (
              <span className="text-[10.5px] text-aegis-text-dim">{t('activity.approvals.noDecisions', 'Gateway did not return decision options.')}</span>
            ) : (
              decisions.map((decision) => (
                <button
                  key={decision}
                  type="button"
                  onClick={() => onResolve(approval, decision)}
                  disabled={expired || resolvingId !== null}
                  className={clsx(
                    'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                    decision === 'deny'
                      ? 'border-aegis-danger/35 text-aegis-danger hover:bg-aegis-danger/10'
                      : decision === 'allow-always'
                        ? 'border-aegis-border text-aegis-text-secondary hover:bg-aegis-hover hover:text-aegis-text'
                        : 'border-aegis-primary/35 text-aegis-primary hover:bg-aegis-primary/10',
                  )}
                  aria-label={decisionLabel(decision, (key, fallback) => t(key, fallback))}
                >
                  {resolvingId === `${approval.kind}:${approval.id}` ? <LoaderCircle size={12} className="animate-spin" aria-hidden="true" /> : decisionIcon(decision)}
                  {decisionLabel(decision, (key, fallback) => t(key, fallback))}
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export function OpenClawApprovalsPanel({ connected }: { connected: boolean }) {
  const { t } = useTranslation();
  const snapshot = useOpenClawApprovalsStore((state) => state.snapshot);
  const loading = useOpenClawApprovalsStore((state) => state.loading);
  const error = useOpenClawApprovalsStore((state) => state.error);
  const resolvingId = useOpenClawApprovalsStore((state) => state.resolvingId);
  const refresh = useOpenClawApprovalsStore((state) => state.refresh);
  const resolve = useOpenClawApprovalsStore((state) => state.resolve);

  useEffect(() => {
    void refresh(connected, true);
    if (!connected) return undefined;
    const timer = window.setInterval(() => void refresh(true, false), APPROVAL_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [connected, refresh]);

  const unavailable = snapshot
    && snapshot.availability.exec === 'unavailable'
    && snapshot.availability.plugin === 'unavailable';

  return (
    <section className="overflow-hidden rounded-lg border border-aegis-border bg-aegis-card" aria-labelledby="openclaw-approvals-title">
      <div className="flex items-center justify-between gap-3 border-b border-aegis-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheck size={15} className="shrink-0 text-aegis-warning" />
          <h2 id="openclaw-approvals-title" className="truncate text-[13px] font-semibold text-aegis-text">{t('activity.approvals.title', 'OpenClaw approvals')}</h2>
          {snapshot && <span className="rounded bg-aegis-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-aegis-warning">{snapshot.approvals.length}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh(connected, true)}
            disabled={!connected || loading}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-wait disabled:opacity-45"
            title={t('common.refresh', 'Refresh')}
            aria-label={t('common.refresh', 'Refresh')}
          >
            <RefreshCw size={12} className={clsx(loading && 'animate-spin')} />
          </button>
          {loading && <LoaderCircle size={13} className="animate-spin text-aegis-text-dim" aria-label={t('activity.approvals.loading', 'Loading approvals')} />}
        </div>
      </div>

      {!connected ? (
        <p className="px-4 py-4 text-[11px] text-aegis-text-dim">{t('activity.approvals.offline', 'Connect to Gateway to inspect native approvals.')}</p>
      ) : loading && !snapshot ? (
        <p className="px-4 py-4 text-[11px] text-aegis-text-dim">{t('activity.approvals.loading', 'Loading approvals')}</p>
      ) : error && !snapshot ? (
        <div className="px-4 py-4 text-[11px] text-aegis-danger" role="alert">{error}</div>
      ) : unavailable ? (
        <p className="px-4 py-4 text-[11px] text-aegis-text-dim">{t('activity.approvals.unsupported', 'This Gateway does not expose native approval methods.')}</p>
      ) : snapshot?.approvals.length === 0 ? (
        <p className="px-4 py-4 text-[11px] text-aegis-text-dim">{t('activity.approvals.empty', 'No pending native approvals.')}</p>
      ) : (
        <>
          {error && <p className="border-b border-aegis-danger/20 bg-aegis-danger/5 px-4 py-2 text-[10.5px] text-aegis-danger" role="alert">{error}</p>}
          {snapshot?.approvals.map((approval) => (
            <ApprovalRow
              key={`${approval.kind}:${approval.id}`}
              approval={approval}
              resolvingId={resolvingId}
              onResolve={(approval, decision) => void resolve(connected, approval, decision)}
            />
          ))}
        </>
      )}
    </section>
  );
}

export default OpenClawApprovalsPanel;
