import { BarChart3, CalendarDays } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatTokens } from '@/utils/format';
import type { DashboardTokenUsageOverview } from './dashboardData';

interface DashboardTokenUsageSummaryProps {
  overview: DashboardTokenUsageOverview;
}

interface UsageSegmentProps {
  label: string;
  value: number;
  total: number;
  tone: string;
}

function UsageSegment({ label, value, total, tone }: UsageSegmentProps) {
  if (value <= 0) return null;
  const percentage = total > 0 ? Math.min(100, (value / total) * 100) : 0;

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 text-[11px]">
        <span className="truncate text-aegis-text-muted">{label}</span>
        <span className="shrink-0 font-mono tabular-nums text-aegis-text-secondary">{formatTokens(value)}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-[rgb(var(--aegis-overlay)/0.08)]">
        <div className="h-full rounded-full" style={{ width: `${percentage}%`, background: tone }} />
      </div>
    </div>
  );
}

export function DashboardTokenUsageSummary({ overview }: DashboardTokenUsageSummaryProps) {
  const { t } = useTranslation();

  return (
    <div className="absolute inset-0 flex items-center px-5 py-4" data-dashboard-token-summary>
      <div className="grid w-full gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(280px,1.15fr)] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-aegis-primary">
            <BarChart3 size={17} aria-hidden="true" />
            <span className="text-[11px] font-semibold text-aegis-text-muted">
              {t('dashboard.usageUnpriced')}
            </span>
          </div>
          <div className="mt-3 font-mono text-[32px] font-semibold leading-none tabular-nums text-aegis-text">
            {formatTokens(overview.totalTokens)}
          </div>
          <p className="mt-2 max-w-sm text-[12px] leading-relaxed text-aegis-text-muted">
            {t('dashboard.costPricingUnavailable')}
          </p>
          <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-aegis-border/70 pt-3 text-[11px]">
            <div className="flex items-center gap-1.5 text-aegis-text-dim">
              <CalendarDays size={13} aria-hidden="true" />
              <dt>{t('analytics.dailyBreakdown')}</dt>
              <dd className="font-medium text-aegis-text-secondary">{t('analytics.days', { count: overview.activeDays })}</dd>
            </div>
            {overview.latestActivityDate && (
              <div className="flex items-center gap-1.5 text-aegis-text-dim">
                <dt>{t('analytics.newest')}</dt>
                <dd className="font-medium text-aegis-text-secondary">{overview.latestActivityDate}</dd>
              </div>
            )}
          </dl>
        </div>
        <div className="grid gap-3 border-l-0 border-aegis-border/70 pl-0 lg:border-l lg:pl-5">
          <UsageSegment label={t('dashboard.input')} value={overview.inputTokens} total={overview.totalTokens} tone="rgb(var(--aegis-accent))" />
          <UsageSegment label={t('dashboard.output')} value={overview.outputTokens} total={overview.totalTokens} tone="rgb(var(--aegis-primary))" />
          <UsageSegment label={t('dashboard.cacheTokenLabel')} value={overview.cacheTokens} total={overview.totalTokens} tone="rgb(var(--aegis-success))" />
          <UsageSegment label={t('calendar.category.other')} value={overview.unclassifiedTokens} total={overview.totalTokens} tone="rgb(var(--aegis-text-dim))" />
        </div>
      </div>
    </div>
  );
}
