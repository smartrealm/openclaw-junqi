import { useEffect, useMemo } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOpenClawApprovalsStore } from '@/stores/openclawApprovalsStore';

const APPROVAL_REFRESH_INTERVAL_MS = 15_000;

export interface PendingApprovalSummary {
  readonly activeSessionCount: number;
  readonly otherSessionCount: number;
}

export function summarizePendingApprovals(
  approvals: ReadonlyArray<{ readonly request: { readonly sessionKey?: string } }>,
  activeSessionKey: string,
): PendingApprovalSummary {
  const activeSessionCount = approvals.filter((approval) => approval.request.sessionKey === activeSessionKey).length;
  return {
    activeSessionCount,
    otherSessionCount: approvals.length - activeSessionCount,
  };
}

export function ChatPendingApprovalsStrip({
  connected,
  activeSessionKey,
  onOpenApprovals,
}: {
  readonly connected: boolean;
  readonly activeSessionKey: string;
  readonly onOpenApprovals: () => void;
}) {
  const { t } = useTranslation();
  const snapshot = useOpenClawApprovalsStore((state) => state.snapshot);
  const refresh = useOpenClawApprovalsStore((state) => state.refresh);
  const subscribeLiveUpdates = useOpenClawApprovalsStore((state) => state.subscribeLiveUpdates);

  useEffect(() => {
    const unsubscribe = subscribeLiveUpdates(connected);
    void refresh(connected, false);
    if (!connected) return unsubscribe;
    const timer = window.setInterval(() => void refresh(true, false), APPROVAL_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [connected, refresh, subscribeLiveUpdates]);

  const summary = useMemo(() => (
    summarizePendingApprovals(snapshot?.approvals ?? [], activeSessionKey)
  ), [activeSessionKey, snapshot?.approvals]);
  const unavailable = snapshot
    && snapshot.availability.exec === 'unavailable'
    && snapshot.availability.plugin === 'unavailable';

  if (!connected || unavailable || (summary.activeSessionCount === 0 && summary.otherSessionCount === 0)) {
    return null;
  }

  const description = summary.activeSessionCount > 0
    ? t('chat.pendingApprovals.activeSession', {
      count: summary.activeSessionCount,
    })
    : t('chat.pendingApprovals.otherSessions', {
      count: summary.otherSessionCount,
    });
  const otherSessions = summary.activeSessionCount > 0 && summary.otherSessionCount > 0
    ? t('chat.pendingApprovals.otherSessionsSuffix', {
      count: summary.otherSessionCount,
    })
    : null;

  return (
    <section
      className="shrink-0 border-t border-aegis-warning/20 bg-aegis-warning/[0.05] px-3 py-2"
      aria-label={t('chat.pendingApprovals.ariaLabel')}
      role="status"
    >
      <div className="mx-auto flex w-full max-w-[760px] items-center gap-2">
        <ShieldAlert size={15} className="shrink-0 text-aegis-warning" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[11px] text-aegis-text-secondary">
          <span className="font-medium text-aegis-text">{description}</span>
          {otherSessions && <span className="ml-1 text-aegis-text-dim">{otherSessions}</span>}
        </p>
        <button
          type="button"
          onClick={onOpenApprovals}
          className="shrink-0 rounded-md border border-aegis-warning/35 px-2 py-1 text-[10.5px] font-medium text-aegis-warning transition-[background-color,border-color,color] duration-[var(--aegis-duration-normal)] ease-[var(--aegis-ease-standard)] hover:bg-aegis-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50"
        >
          {t('chat.pendingApprovals.open')}
        </button>
      </div>
    </section>
  );
}
