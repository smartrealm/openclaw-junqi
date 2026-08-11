import { Bot, MessageSquare, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { ChannelRuntimeIcon } from '@/components/shared/ChannelRuntimeIcon';
import type { ChannelAccountReadiness, ChannelAccountReadinessState } from '@/services/channelConfig';
import type { ChannelsRuntimeSnapshot } from '@/services/openclawChannelRuntime';
import type { ChannelGroupWithName } from './channelCenterTypes';

export type ChannelReadinessFilter = 'all' | ChannelAccountReadinessState;

interface ChannelListPanelProps {
  groups: ChannelGroupWithName[];
  filteredGroups: ChannelGroupWithName[];
  selectedGroupId?: string;
  runtimeSnapshot: ChannelsRuntimeSnapshot | null;
  accountCount: number;
  readyCount: number;
  readinessCounts: Record<ChannelAccountReadinessState, number>;
  readinessFilter: ChannelReadinessFilter;
  saving: boolean;
  focusedAgentName?: string;
  getReadiness: (group: ChannelGroupWithName, accountId: string) => ChannelAccountReadiness;
  onFilterChange: (filter: ChannelReadinessFilter) => void;
  onSelect: (group: ChannelGroupWithName) => void;
  onClearAgentFocus: () => void;
  onAddChannel: () => void;
}

export function ChannelListPanel({
  groups,
  filteredGroups,
  selectedGroupId,
  runtimeSnapshot,
  accountCount,
  readyCount,
  readinessCounts,
  readinessFilter,
  saving,
  focusedAgentName,
  getReadiness,
  onFilterChange,
  onSelect,
  onClearAgentFocus,
  onAddChannel,
}: ChannelListPanelProps) {
  const { t } = useTranslation();

  return (
    <aside className="border-b border-aegis-border bg-aegis-surface/35 lg:border-b-0 lg:border-e" aria-label={t('channelsCenter.configured', 'Configured channels')}>
      <div className="border-b border-aegis-border px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold text-aegis-text">
              {t('channelsCenter.configured', 'Configured channels')}
            </div>
            <div className="mt-0.5 text-[9.5px] text-aegis-text-muted">
              {groups.length} {t('channelsCenter.enabledChannels', 'channels')} · {readyCount} / {accountCount} {t('channelsCenter.readyAccounts', 'ready')}
            </div>
          </div>
          {saving && <LoadingIndicator size={12} />}
        </div>
        {focusedAgentName && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-aegis-primary/20 bg-aegis-primary/5 px-2 py-1.5">
            <Bot size={11} className="shrink-0 text-aegis-primary" />
            <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-aegis-primary">
              {focusedAgentName}
            </span>
            <button
              type="button"
              onClick={onClearAgentFocus}
              title={t('channelsCenter.clearAgentFocus', 'Clear agent focus')}
              aria-label={t('channelsCenter.clearAgentFocus', 'Clear agent focus')}
              className="rounded p-0.5 text-aegis-primary hover:bg-aegis-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35"
            >
              <X size={11} />
            </button>
          </div>
        )}
        <label className="mt-2 block">
          <span className="sr-only">{t('channelsCenter.filterByStatus', 'Filter by status')}</span>
          <select
            value={readinessFilter}
            onChange={(event) => onFilterChange(event.target.value as ChannelReadinessFilter)}
            className="h-8 w-full rounded-md border border-aegis-border bg-aegis-bg px-2 text-[10.5px] text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35"
          >
            <option value="all">{t('channelsCenter.filterAll', 'All')} · {accountCount}</option>
            <option value="ready">{t('channelsCenter.readiness.ready', 'Ready')} · {readinessCounts.ready}</option>
            <option value="missing_credentials">{t('channelsCenter.readiness.missing_credentials', 'Missing credentials')} · {readinessCounts.missing_credentials}</option>
            <option value="disabled">{t('channelsCenter.readiness.disabled', 'Disabled')} · {readinessCounts.disabled}</option>
            <option value="unknown">{t('channelsCenter.readiness.unknown', 'Runtime status unavailable')} · {readinessCounts.unknown}</option>
          </select>
        </label>
      </div>

      <div className="max-h-[560px] overflow-y-auto p-2">
        {groups.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <MessageSquare size={24} className="mx-auto text-aegis-text-muted" />
            <div className="mt-2 text-[11px] font-semibold text-aegis-text">
              {t('channelsCenter.emptyTitle', 'No channels configured')}
            </div>
            <button type="button" onClick={onAddChannel} className="mt-3 text-[10.5px] font-semibold text-aegis-primary hover:underline">
              {t('channelsCenter.addChannels', 'Add channel')}
            </button>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="px-3 py-10 text-center text-[10.5px] text-aegis-text-muted">
            {t('channelsCenter.noFilterResults', 'No matching accounts')}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredGroups.map((group) => {
              const active = selectedGroupId === group.id;
              const groupReady = group.accounts.filter((account) => getReadiness(group, account.id).state === 'ready').length;
              return (
                <button
                  type="button"
                  key={group.id}
                  onClick={() => onSelect(group)}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35',
                    active ? 'bg-aegis-primary/8 text-aegis-text' : 'text-aegis-text-secondary hover:bg-aegis-hover',
                  )}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-aegis-border bg-aegis-bg text-aegis-text-muted">
                    <ChannelRuntimeIcon systemImage={runtimeSnapshot?.channelSystemImages?.[group.id]} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-semibold">{group.name}</span>
                    <span className="mt-0.5 block truncate font-mono text-[9px] text-aegis-text-muted">
                      {groupReady} / {group.accounts.length} {t('channelsCenter.readyAccounts', 'ready')}
                    </span>
                  </span>
                  <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', group.enabled ? 'bg-aegis-success' : 'bg-aegis-text-muted')} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
