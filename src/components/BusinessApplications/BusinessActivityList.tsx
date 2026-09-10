import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/shared/button/Button';
import {
  selectBusinessAttemptsForSession,
  useBusinessActivityStore,
  type BusinessAttemptState,
} from '@/business-applications/activityStore';
import { useDingTalkBusinessAudit } from '@/hooks/useDingTalkBusinessAudit';
import { useChatStore } from '@/stores/chatStore';
import { summarizeDingTalkBusinessActivity } from './businessActivitySummary';
import { resolveBusinessActivityPrimaryState } from './businessActivityPresentation';
import { BusinessActivityEvidence } from './BusinessActivityEvidence';

type ActivityScope = 'all' | 'official' | 'window';

function StateIcon({ state }: { state: BusinessAttemptState }) {
  if (state === 'pending') return <LoaderCircle size={14} className="animate-spin text-aegis-primary" />;
  if (state === 'approval_required') return <ShieldAlert size={14} className="text-aegis-warning" />;
  if (state === 'succeeded' || state === 'verified') return <CheckCircle2 size={14} className="text-aegis-success" />;
  if (state === 'succeeded_unverified' || state === 'unknown') return <AlertTriangle size={14} className="text-aegis-warning" />;
  return <AlertTriangle size={14} className="text-aegis-danger" />;
}

function SummaryMetric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'warning' }) {
  return (
    <div className="min-w-0 border-r border-aegis-border px-4 py-3 last:border-r-0">
      <div className="text-[11px] leading-4 text-aegis-text-dim">{label}</div>
      <div className={clsx('mt-0.5 font-mono text-[18px] font-semibold leading-6 tabular-nums', tone === 'warning' && value > 0 ? 'text-aegis-warning' : 'text-aegis-text-secondary')}>{value}</div>
    </div>
  );
}

function includesQuery(values: readonly (string | null | undefined)[], query: string): boolean {
  if (!query) return true;
  return values.some((value) => value?.toLocaleLowerCase().includes(query));
}

export function BusinessActivityList() {
  const { t } = useTranslation();
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const allAttempts = useBusinessActivityStore((state) => state.attempts);
  const clearSession = useBusinessActivityStore((state) => state.clearSession);
  const audit = useDingTalkBusinessAudit(activeSessionKey);
  const [scope, setScope] = useState<ActivityScope>('all');
  const [search, setSearch] = useState('');
  const attempts = useMemo(
    () => selectBusinessAttemptsForSession(allAttempts, activeSessionKey),
    [activeSessionKey, allAttempts],
  );
  const summary = useMemo(() => summarizeDingTalkBusinessActivity(audit.events, attempts), [attempts, audit.events]);
  const query = search.trim().toLocaleLowerCase();
  const filteredEvents = useMemo(() => (
    scope === 'window' ? [] : audit.events.filter((event) => includesQuery([
      event.toolName,
      event.action,
      event.agentId,
      event.actor.id,
      event.runId,
      event.toolCallId,
      event.errorCode,
      event.status,
    ], query))
  ), [audit.events, query, scope]);
  const filteredAttempts = useMemo(() => (
    scope === 'official' ? [] : attempts.filter((attempt) => includesQuery([
      attempt.toolLabel,
      attempt.toolName,
      attempt.agentId,
      attempt.sessionId,
      attempt.profileRef,
      attempt.errorCode,
      attempt.state,
    ], query))
  ), [attempts, query, scope]);
  const hasAnyActivity = attempts.length > 0 || audit.events.length > 0;
  const hasFilteredActivity = filteredAttempts.length > 0 || filteredEvents.length > 0;
  const primaryState = resolveBusinessActivityPrimaryState({
    hasAnyActivity,
    loading: audit.loading,
    failure: audit.failure,
  });
  const auditFailureDescription = audit.failure
    ? t(`businessApplications.activity.failure.${audit.failure}`)
    : '';

  if (primaryState.kind === 'loading') {
    return (
      <EmptyState
        density="compact"
        iconStyle="bare"
        icon={<LoaderCircle size={24} className="animate-spin" />}
        title={t('businessApplications.activity.loadingTitle')}
        description={t('businessApplications.activity.loadingDescription')}
      />
    );
  }

  if (primaryState.kind === 'failure') {
    return (
      <EmptyState
        density="compact"
        iconStyle="bare"
        icon={<AlertTriangle size={24} />}
        title={t('businessApplications.activity.failureTitle')}
        description={auditFailureDescription}
        action={(
          <Button
            size="xs"
            variant="outline"
            leadingIcon={<RefreshCw size={12} />}
            onClick={() => void audit.refresh()}
          >
            {t('businessApplications.activity.retry')}
          </Button>
        )}
      />
    );
  }

  if (primaryState.kind === 'empty') {
    return (
      <EmptyState
        density="compact"
        iconStyle="bare"
        icon={<Clock3 size={24} />}
        title={t('businessApplications.activity.emptyTitle')}
        description={t('businessApplications.activity.emptyDescription')}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-2 border-b border-aegis-border bg-aegis-bg/35 sm:grid-cols-3 xl:grid-cols-5">
        <SummaryMetric label={t('businessApplications.activity.metrics.official')} value={summary.official} />
        <SummaryMetric label={t('businessApplications.activity.metrics.local')} value={summary.local} />
        <SummaryMetric label={t('businessApplications.activity.metrics.agents')} value={summary.agents} />
        <SummaryMetric label={t('businessApplications.activity.metrics.active')} value={summary.active} />
        <SummaryMetric label={t('businessApplications.activity.metrics.attention')} value={summary.attention} tone="warning" />
      </div>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-aegis-border px-3 py-2">
        <label className="flex h-8 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-aegis-border bg-aegis-input px-2.5 focus-within:border-aegis-primary/55 focus-within:ring-2 focus-within:ring-aegis-primary/20">
          <Search size={14} className="shrink-0 text-aegis-text-dim" aria-hidden="true" />
          <span className="sr-only">{t('businessApplications.activity.searchLabel')}</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('businessApplications.activity.searchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-aegis-text outline-none placeholder:text-aegis-text-dim"
          />
        </label>
        <div className="flex h-8 rounded-md border border-aegis-border bg-aegis-input p-0.5" aria-label={t('businessApplications.activity.scopeLabel')}>
          {([
            ['all', t('businessApplications.activity.scope.all')],
            ['official', t('businessApplications.activity.scope.official')],
            ['window', t('businessApplications.activity.scope.window')],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
              className={clsx(
                'rounded px-2.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35',
                scope === value ? 'bg-aegis-primary/12 font-medium text-aegis-primary' : 'text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button size="xs" variant="ghost" loading={audit.loading} leadingIcon={<RefreshCw size={12} />} onClick={() => void audit.refresh()}>{t('businessApplications.activity.refresh')}</Button>
          <Button size="xs" variant="ghost" disabled={!activeSessionKey || attempts.length === 0} onClick={() => clearSession(activeSessionKey)}>{t('businessApplications.activity.clearWindow')}</Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {audit.failure && <div className="border-b border-aegis-warning/25 bg-aegis-warning/[0.05] px-3 py-2 text-[10px] text-aegis-warning">{auditFailureDescription}</div>}
        {!hasFilteredActivity && (
          <EmptyState
            density="compact"
            iconStyle="bare"
            icon={<Search size={22} />}
            title={t('businessApplications.activity.noMatchTitle')}
            description={t('businessApplications.activity.noMatchDescription')}
          />
        )}
        {filteredEvents.map((event) => (
          <article key={`${event.eventId}:${event.sequence}`} className="grid grid-cols-[20px_minmax(0,1fr)_auto] gap-3 border-b border-aegis-border/70 px-4 py-3.5">
            <span className="pt-0.5"><ShieldAlert size={15} className={event.status === 'succeeded' ? 'text-aegis-success' : event.status === 'failed' || event.status === 'blocked' ? 'text-aegis-danger' : 'text-aegis-warning'} /></span>
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-medium leading-5 text-aegis-text-secondary">{event.toolName ?? event.action}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] leading-4 text-aegis-text-dim">
                <span>{t('businessApplications.activity.agent')} {event.agentId ?? event.actor.id}</span>
                {event.errorCode && <span>{t('businessApplications.activity.error')} {event.errorCode}</span>}
                <span>{t('businessApplications.activity.officialMetadata')}</span>
              </div>
              <BusinessActivityEvidence items={[
                { label: t('businessApplications.activity.run'), value: event.runId },
                { label: t('businessApplications.activity.call'), value: event.toolCallId },
              ]} />
            </div>
            <div className="text-right text-[10.5px] leading-4 text-aegis-text-dim">
              <div className="font-medium text-aegis-text-secondary">{t(`businessApplications.activity.auditStatus.${event.status}`, event.status)}</div>
              <time dateTime={new Date(event.occurredAt).toISOString()}>{new Date(event.occurredAt).toLocaleTimeString()}</time>
            </div>
          </article>
        ))}
        {filteredAttempts.length > 0 && <div className="border-b border-aegis-border bg-aegis-surface/35 px-3 py-1.5 text-[9.5px] text-aegis-text-dim">{t('businessApplications.activity.localProjectionBoundary')}</div>}
        {filteredAttempts.map((attempt) => (
          <article key={attempt.id} className="grid grid-cols-[20px_minmax(0,1fr)_auto] gap-3 border-b border-aegis-border/70 px-4 py-3.5">
            <span className="pt-0.5"><StateIcon state={attempt.state} /></span>
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-medium leading-5 text-aegis-text-secondary">{attempt.toolLabel}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] leading-4 text-aegis-text-dim">
                <span>{t(`businessApplications.workbench.effect.${attempt.effect}`)}</span>
                <span>{t('businessApplications.activity.risk')} {t(`businessApplications.workbench.risk.${attempt.risk}`)}</span>
                <span>{attempt.profileRef ?? t('businessApplications.activity.noTenant')}</span>
                <span>{t('businessApplications.activity.agent')} {attempt.agentId ?? t('businessApplications.activity.agentPending')}</span>
                {attempt.errorCode && <span>{t('businessApplications.activity.error')} {attempt.errorCode}</span>}
              </div>
              <BusinessActivityEvidence items={[
                { label: t('businessApplications.activity.session'), value: attempt.sessionId },
                { label: t('businessApplications.workbench.detail.dwsPath'), value: attempt.evidence?.dwsCanonicalPath },
                { label: t('businessApplications.activity.verifier'), value: attempt.evidence?.verifierCanonicalPath },
                { label: t('businessApplications.activity.resource'), value: attempt.evidence?.resourceId },
                { label: t('businessApplications.activity.recovery'), value: attempt.evidence?.recoveryEventId },
              ]} />
            </div>
            <div className="text-right text-[10.5px] leading-4 text-aegis-text-dim">
              <div className="font-medium text-aegis-text-secondary">{t(`businessApplications.activity.state.${attempt.state}`)}</div>
              <time dateTime={new Date(attempt.startedAt).toISOString()}>
                {new Date(attempt.startedAt).toLocaleTimeString()}
              </time>
            </div>
          </article>
        ))}
        {audit.nextCursor && scope !== 'window' && (
          <div className="flex justify-center border-b border-aegis-border px-3 py-2">
            <Button size="xs" variant="ghost" loading={audit.loadingMore} onClick={() => void audit.loadMore()}>{t('businessApplications.activity.loadMore')}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
