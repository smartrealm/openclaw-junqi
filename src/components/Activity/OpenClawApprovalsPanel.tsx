import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Check,
  Clock3,
  History,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import {
  OPENCLAW_APPROVAL_REQUEST_FAILED,
  useOpenClawApprovalsStore,
  type OpenClawApproval,
  type OpenClawApprovalDecision,
  type OpenClawApprovalSnapshot,
  type OpenClawApprovalTerminalReason,
} from '@/stores/openclawApprovalsStore';

const APPROVAL_REFRESH_INTERVAL_MS = 15_000;

function approvalErrorLabel(error: string, t: (key: string, fallback: string) => string): string {
  return error === OPENCLAW_APPROVAL_REQUEST_FAILED
    ? t('activity.approvals.requestFailed', 'Unable to read native approvals.')
    : error;
}

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

function approvalPresentationTitle(
  approval: OpenClawApprovalSnapshot,
  t: (key: string, fallback: string) => string,
): string {
  const presentation = approval.presentation;
  if (presentation.kind === 'exec') return t('activity.approvals.execTitle', 'Command approval');
  return presentation.title;
}

function approvalPresentationDetail(approval: OpenClawApprovalSnapshot): string {
  const presentation = approval.presentation;
  if (presentation.kind === 'exec') return presentation.commandPreview || presentation.commandText;
  return presentation.description;
}

function approvalStatusLabel(
  status: Exclude<OpenClawApprovalSnapshot['status'], 'pending'>,
  t: (key: string, fallback: string) => string,
): string {
  if (status === 'allowed') return t('activity.approvals.statusAllowed', 'Allowed');
  if (status === 'denied') return t('activity.approvals.statusDenied', 'Denied');
  if (status === 'expired') return t('activity.approvals.statusExpired', 'Expired');
  return t('activity.approvals.statusCancelled', 'Cancelled');
}

function approvalReasonLabel(
  reason: OpenClawApprovalTerminalReason,
  t: (key: string, fallback: string) => string,
): string {
  if (reason === 'user') return t('activity.approvals.reasonUser', 'User decision');
  if (reason === 'timeout') return t('activity.approvals.reasonTimeout', 'Timed out');
  if (reason === 'run-aborted') return t('activity.approvals.reasonRunAborted', 'Run aborted');
  if (reason === 'gateway-restart') return t('activity.approvals.reasonGatewayRestart', 'Gateway restarted');
  if (reason === 'malformed-verdict') return t('activity.approvals.reasonMalformed', 'Malformed decision');
  if (reason === 'no-route') return t('activity.approvals.reasonNoRoute', 'No delivery route');
  return t('activity.approvals.reasonStorage', 'Storage failure');
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
    <article className="border-t border-aegis-border px-4 py-3 first:border-t-0 transition-colors duration-200 hover:bg-aegis-hover/35">
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
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-aegis-border/70 pt-2.5">
            {decisions.length === 0 ? (
              <span className="text-[10.5px] text-aegis-text-dim">{t('activity.approvals.noDecisions', 'Gateway did not return decision options.')}</span>
            ) : (
              decisions.map((decision) => (
                <button
                  key={decision}
                  type="button"
                  onClick={() => onResolve(approval, decision)}
                  disabled={expired || resolvingId !== null}
                  aria-busy={resolvingId === `${approval.kind}:${approval.id}`}
                  className={clsx(
                    'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10.5px] font-medium transition-[background-color,border-color,color,transform,opacity] duration-[var(--aegis-duration-normal)] ease-[var(--aegis-ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45',
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

type OpenClawHistoryApproval = Exclude<OpenClawApprovalSnapshot, { status: 'pending' }>;

function ApprovalHistoryRow({ approval }: { approval: OpenClawHistoryApproval }) {
  const { t } = useTranslation();
  const presentation = approval.presentation;
  const severityClass = presentation.kind === 'plugin' && presentation.severity === 'critical'
    ? 'text-aegis-danger'
    : presentation.kind === 'plugin' && presentation.severity === 'warning'
      ? 'text-aegis-warning'
      : 'text-aegis-primary';
  const sourceSession = approval.source?.sessionKey;
  const agentId = presentation.agentId;
  const resolvedTime = new Date(approval.resolvedAtMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <article className="border-t border-aegis-border px-4 py-3 first:border-t-0">
      <div className="flex min-w-0 items-start gap-3">
        <span className={clsx('mt-0.5 shrink-0', severityClass)}>
          {presentation.kind === 'exec' ? <TerminalSquare size={15} /> : <AlertTriangle size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <strong className="min-w-0 text-[12px] font-semibold text-aegis-text">
              {approvalPresentationTitle(approval, (key, fallback) => t(key, fallback))}
            </strong>
            <span className="shrink-0 font-mono text-[9.5px] text-aegis-text-dim">{presentation.kind}</span>
          </div>
          <p className={clsx(
            'mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-aegis-text-secondary',
            presentation.kind === 'exec' && 'font-mono',
          )}>{approvalPresentationDetail(approval)}</p>
          {presentation.kind === 'plugin' && presentation.detail && (
            <p className="mt-1 whitespace-pre-wrap break-words text-[10.5px] leading-5 text-aegis-text-dim">{presentation.detail}</p>
          )}
          {presentation.kind === 'exec' && presentation.warningText && (
            <p className="mt-1 text-[10.5px] leading-5 text-aegis-warning">{presentation.warningText}</p>
          )}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-aegis-text-dim">
            {agentId && <span>{agentId}</span>}
            {sourceSession && <span className="max-w-[240px] truncate font-mono" title={sourceSession}>{sourceSession}</span>}
            <span>{approvalStatusLabel(approval.status, (key, fallback) => t(key, fallback))}</span>
            <span>{approvalReasonLabel(approval.reason, (key, fallback) => t(key, fallback))}</span>
            {approval.decision && <span>{decisionLabel(approval.decision, (key, fallback) => t(key, fallback))}</span>}
            <span>{resolvedTime}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function ApprovalHistorySection({ connected }: { connected: boolean }) {
  const { t } = useTranslation();
  const history = useOpenClawApprovalsStore((state) => state.history);
  const historyLoading = useOpenClawApprovalsStore((state) => state.historyLoading);
  const historyError = useOpenClawApprovalsStore((state) => state.historyError);
  const refreshHistory = useOpenClawApprovalsStore((state) => state.refreshHistory);
  const loadMoreHistory = useOpenClawApprovalsStore((state) => state.loadMoreHistory);
  const unavailable = history?.availability === 'unavailable';

  return (
    <div className="border-t border-aegis-border">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <History size={14} className="shrink-0 text-aegis-text-dim" />
          <h3 className="truncate text-[12px] font-semibold text-aegis-text">{t('activity.approvals.historyTitle', 'Approval history')}</h3>
          {history?.availability === 'available' && (
            <span className="rounded bg-aegis-hover px-1.5 py-0.5 font-mono text-[10px] text-aegis-text-dim">{history.items.length}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void refreshHistory(connected, true)}
          disabled={!connected || historyLoading}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-wait disabled:opacity-45"
          title={t('activity.approvals.historyRefresh', 'Refresh approval history')}
          aria-label={t('activity.approvals.historyRefresh', 'Refresh approval history')}
        >
          <RefreshCw size={12} className={clsx(historyLoading && 'animate-spin')} />
        </button>
      </div>
      {!connected ? (
        <p className="px-4 pb-4 text-[11px] text-aegis-text-dim">{t('activity.approvals.offline', 'Connect to Gateway to inspect native approvals.')}</p>
      ) : historyLoading && !history ? (
        <p className="px-4 pb-4 text-[11px] text-aegis-text-dim">{t('activity.approvals.historyLoading', 'Loading approval history')}</p>
      ) : historyError && !history ? (
        <div className="px-4 pb-4 text-[11px] text-aegis-danger" role="alert">{approvalErrorLabel(historyError, (key, fallback) => t(key, fallback))}</div>
      ) : unavailable ? (
        <p className="px-4 pb-4 text-[11px] text-aegis-text-dim">{t('activity.approvals.historyUnsupported', 'This Gateway does not expose native approval history.')}</p>
      ) : history?.items.length === 0 ? (
        <p className="px-4 pb-4 text-[11px] text-aegis-text-dim">{t('activity.approvals.historyEmpty', 'No terminal approvals in the Gateway history.')}</p>
      ) : (
        <>
          {historyError && <p className="border-b border-aegis-danger/20 bg-aegis-danger/5 px-4 py-2 text-[10.5px] text-aegis-danger" role="alert">{approvalErrorLabel(historyError, (key, fallback) => t(key, fallback))}</p>}
          {history?.items.map((approval) => (
            <ApprovalHistoryRow key={approval.id} approval={approval} />
          ))}
          {history?.nextCursor && (
            <div className="border-t border-aegis-border px-4 py-3">
              <button
                type="button"
                onClick={() => void loadMoreHistory(connected)}
                disabled={historyLoading}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-aegis-border px-2 text-[10.5px] text-aegis-text-secondary transition-colors hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-wait disabled:opacity-45"
              >
                {historyLoading && <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />}
                {t('activity.approvals.historyMore', 'Load more')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function OpenClawApprovalsPanel({ connected }: { connected: boolean }) {
  const { t } = useTranslation();
  const snapshot = useOpenClawApprovalsStore((state) => state.snapshot);
  const loading = useOpenClawApprovalsStore((state) => state.loading);
  const error = useOpenClawApprovalsStore((state) => state.error);
  const resolvingId = useOpenClawApprovalsStore((state) => state.resolvingId);
  const refresh = useOpenClawApprovalsStore((state) => state.refresh);
  const refreshHistory = useOpenClawApprovalsStore((state) => state.refreshHistory);
  const subscribeLiveUpdates = useOpenClawApprovalsStore((state) => state.subscribeLiveUpdates);
  const resolve = useOpenClawApprovalsStore((state) => state.resolve);

  useEffect(() => {
    const unsubscribeLiveUpdates = subscribeLiveUpdates(connected);
    void refresh(connected, true);
    void refreshHistory(connected, true);
    if (!connected) return unsubscribeLiveUpdates;
    const timer = window.setInterval(() => void refresh(true, false), APPROVAL_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      unsubscribeLiveUpdates();
    };
  }, [connected, refresh, refreshHistory, subscribeLiveUpdates]);

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
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-aegis-text-dim transition-colors motion-reduce:transition-none hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-wait disabled:opacity-45"
            title={t('common.refresh', 'Refresh')}
            aria-label={t('common.refresh', 'Refresh')}
          >
            <RefreshCw size={12} className={clsx(loading && 'animate-spin')} />
          </button>
          {loading && <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none text-aegis-text-dim" aria-label={t('activity.approvals.loading', 'Loading approvals')} />}
        </div>
      </div>

      <div>
      {!connected ? (
        <p className="px-4 py-4 text-[11px] text-aegis-text-dim">{t('activity.approvals.offline', 'Connect to Gateway to inspect native approvals.')}</p>
      ) : loading && !snapshot ? (
        <p className="px-4 py-4 text-[11px] text-aegis-text-dim">{t('activity.approvals.loading', 'Loading approvals')}</p>
      ) : error && !snapshot ? (
        <div className="px-4 py-4 text-[11px] text-aegis-danger" role="alert">{approvalErrorLabel(error, (key, fallback) => t(key, fallback))}</div>
      ) : unavailable ? (
        <p className="px-4 py-4 text-[11px] text-aegis-text-dim">{t('activity.approvals.unsupported', 'This Gateway does not expose native approval methods.')}</p>
      ) : snapshot?.approvals.length === 0 ? (
        <p className="px-4 py-4 text-[11px] text-aegis-text-dim">{t('activity.approvals.empty', 'No pending native approvals.')}</p>
      ) : (
        <>
          {error && <p className="border-b border-aegis-danger/20 bg-aegis-danger/5 px-4 py-2 text-[10.5px] text-aegis-danger" role="alert">{approvalErrorLabel(error, (key, fallback) => t(key, fallback))}</p>}
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
      </div>
      <ApprovalHistorySection connected={connected} />
    </section>
  );
}

export default OpenClawApprovalsPanel;
