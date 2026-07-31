import { Bot, ChartNoAxesCombined, MessageSquare, MessagesSquare, RefreshCw, Settings2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/shared/button/Button';

interface DashboardCostEmptyStateProps {
  hasProviders: boolean;
  sessionCount: number;
  activeAgentCount: number;
  modelCount: number;
  refreshing: boolean;
  onOpenConversation: () => void;
  onConfigureProviders: () => void;
  onRefresh: () => void;
}

export function DashboardCostEmptyState({
  hasProviders,
  sessionCount,
  activeAgentCount,
  modelCount,
  refreshing,
  onOpenConversation,
  onConfigureProviders,
  onRefresh,
}: DashboardCostEmptyStateProps) {
  const { t } = useTranslation();
  const title = hasProviders
    ? t('dashboard.costEmptyTitle')
    : t('dashboard.costEmptyNoProviderTitle');
  const description = hasProviders
    ? t('dashboard.costEmptyDescription')
    : t('dashboard.costEmptyNoProviderDescription');

  return (
    <div className="absolute inset-0 flex px-5 py-4" data-dashboard-cost-empty>
      <div className="flex w-full flex-col justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-aegis-primary">
            <ChartNoAxesCombined size={17} aria-hidden="true" />
            <span className="text-[11px] font-semibold text-aegis-text-muted">{t('dashboard.costEmptyEyebrow')}</span>
          </div>
          <h3 className="mt-2 text-[15px] font-semibold text-aegis-text">{title}</h3>
          <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-aegis-text-muted">{description}</p>
        </div>

        <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <OverviewMetric label={t('dashboard.costEmptyWindowLabel')} value={t('dashboard.costEmptyWindowValue')} />
          <OverviewMetric icon={<MessagesSquare size={14} />} label={t('costs.totalSessions')} value={String(sessionCount)} />
          <OverviewMetric icon={<Bot size={14} />} label={t('dashboard.activeAgents')} value={String(activeAgentCount)} />
          <OverviewMetric label={t('config.models')} value={String(modelCount)} />
        </dl>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="soft"
            tone="primary"
            size="sm"
            leadingIcon={hasProviders ? <MessageSquare size={14} /> : <Settings2 size={14} />}
            onClick={hasProviders ? onOpenConversation : onConfigureProviders}
          >
            {hasProviders ? t('dashboard.costEmptyOpenConversation') : t('dashboard.costEmptyConfigureProviders')}
          </Button>
          <Button
            variant="ghost"
            tone="neutral"
            size="sm"
            leadingIcon={<RefreshCw size={14} />}
            loading={refreshing}
            onClick={onRefresh}
          >
            {t('dashboard.costRetry')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function OverviewMetric({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-aegis-border/70 bg-aegis-surface/40 px-3 py-2.5">
      <dt className="flex items-center gap-1.5 truncate text-[11px] text-aegis-text-dim">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-[17px] font-semibold tabular-nums text-aegis-text">{value}</dd>
    </div>
  );
}
