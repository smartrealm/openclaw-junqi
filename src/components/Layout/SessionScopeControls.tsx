import { ChevronDown, ListFilter, Settings2, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type {
  SidebarCreationSortAvailability,
  SidebarSessionGrouping,
  SidebarSessionSortMode,
} from './sidebarUtils';

export interface SessionScopeAgentOption {
  readonly id: string;
  readonly label: string;
}

interface SessionScopeControlsProps {
  readonly agents: readonly SessionScopeAgentOption[];
  readonly selectedAgentId: string;
  readonly grouping: SidebarSessionGrouping;
  readonly sortMode: SidebarSessionSortMode;
  readonly creationSortAvailability: SidebarCreationSortAvailability;
  readonly agentsLoading: boolean;
  readonly agentsFailed: boolean;
  readonly onAgentChange: (agentId: string) => void;
  readonly onGroupingChange: (grouping: SidebarSessionGrouping) => void;
  readonly onSortModeChange: (mode: SidebarSessionSortMode) => void;
  readonly onCreateAgent: () => void;
  readonly onOpenAgentSettings: () => void;
}

export function SessionScopeControls({
  agents,
  selectedAgentId,
  grouping,
  sortMode,
  creationSortAvailability,
  agentsLoading,
  agentsFailed,
  onAgentChange,
  onGroupingChange,
  onSortModeChange,
  onCreateAgent,
  onOpenAgentSettings,
}: SessionScopeControlsProps) {
  const { t } = useTranslation();
  const selectGrouping = (value: string) => {
    if (value === 'category' || value === 'none') onGroupingChange(value);
  };
  const selectSortMode = (value: string) => {
    if (value === 'created' || value === 'updated') onSortModeChange(value);
  };
  const iconButtonClass = clsx(
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-aegis-text-muted transition-colors',
    'hover:bg-aegis-hover/40 hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60',
    'disabled:cursor-not-allowed disabled:opacity-40',
  );
  const selectedAgentLabel = agents.find((agent) => agent.id === selectedAgentId)?.label;
  const createdTimestampUnavailable = creationSortAvailability === 'unavailable';
  const createdTimestampPartial = creationSortAvailability === 'partial';
  const agentScopeLabel = selectedAgentLabel
    ?? (agentsLoading
      ? t('sidebar.sessions.loadingAgents', '正在加载智能体')
      : agentsFailed
        ? t('sidebar.sessions.agentsUnavailable', '智能体不可用')
        : t('sidebar.sessions.noAgent', '暂无智能体'));

  return (
    <div className="shrink-0 px-3 pb-2">
      <div className="flex h-9 items-center gap-2">
        <span className="shrink-0 text-[12px] font-semibold text-aegis-text-secondary">
          {t('sidebar.sessions.title', '会话')}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('sidebar.sessions.agentMenu', '智能体菜单')}
              className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-aegis-border/70 bg-aegis-elevated/70 px-2.5 text-left text-[12px] font-semibold text-aegis-text-secondary transition-colors hover:bg-aegis-hover/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/50"
            >
              <span className="min-w-0 flex-1 truncate">{agentScopeLabel}</span>
              <ChevronDown size={13} className="shrink-0 text-aegis-text-dim" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-[220px] border-aegis-menu-border bg-aegis-menu-bg p-1.5 text-aegis-text shadow-[var(--aegis-menu-shadow)]"
          >
            {agents.length > 0 ? (
              <>
                <DropdownMenuLabel className="px-2 pb-1 pt-0.5 text-[10px] text-aegis-text-dim">
                  {t('sidebar.sessions.agents', '智能体')}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={selectedAgentId} onValueChange={onAgentChange}>
                  {agents.map((agent) => (
                    <DropdownMenuRadioItem
                      key={agent.id}
                      value={agent.id}
                      className="h-8 text-[12px] text-aegis-text-secondary focus:bg-aegis-hover/40 focus:text-aegis-text"
                    >
                      {agent.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator className="bg-aegis-border/70" />
              </>
            ) : null}
            <DropdownMenuItem
              onSelect={onCreateAgent}
              className="h-8 justify-start text-[12px] text-aegis-text-secondary focus:bg-aegis-hover/40 focus:text-aegis-text"
            >
              <UserPlus size={14} aria-hidden="true" />
              <span>{t('sidebar.newAgent', '新建智能体')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onOpenAgentSettings}
              disabled={!selectedAgentId}
              className="h-8 justify-start text-[12px] text-aegis-text-secondary focus:bg-aegis-hover/40 focus:text-aegis-text"
            >
              <Settings2 size={14} aria-hidden="true" />
              <span>{t('sidebar.sessions.agentSettings', '智能体设置')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={iconButtonClass}
              title={t('sidebar.sessions.organize', '分组与排序')}
              aria-label={t('sidebar.sessions.organize', '分组与排序')}
            >
              <ListFilter size={15} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-[196px] border-aegis-menu-border bg-aegis-menu-bg p-1.5 text-aegis-text shadow-[var(--aegis-menu-shadow)]"
          >
            <DropdownMenuLabel className="px-2 pb-1 pt-0.5 text-[10px] text-aegis-text-dim">
              {t('sidebar.sessions.groupBy', '分组依据')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={grouping}
              onValueChange={selectGrouping}
            >
              <DropdownMenuRadioItem value="category" className="h-8 text-[12px] text-aegis-text-secondary focus:bg-aegis-hover/40 focus:text-aegis-text">
                {t('sidebar.sessions.groupByCategory', '自定义分组')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="none" className="h-8 text-[12px] text-aegis-text-secondary focus:bg-aegis-hover/40 focus:text-aegis-text">
                {t('sidebar.sessions.groupByNone', '不分组')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator className="bg-aegis-border/70" />
            <DropdownMenuLabel className="px-2 pb-1 pt-0.5 text-[10px] text-aegis-text-dim">
              {t('sidebar.sessions.sortBy', '排序方式')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={sortMode}
              onValueChange={selectSortMode}
            >
              <DropdownMenuRadioItem
                value="created"
                disabled={createdTimestampUnavailable}
                className="h-8 text-[12px] text-aegis-text-secondary focus:bg-aegis-hover/40 focus:text-aegis-text"
              >
                {t('sidebar.sessions.sortCreated', '创建时间')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="updated" className="h-8 text-[12px] text-aegis-text-secondary focus:bg-aegis-hover/40 focus:text-aegis-text">
                {t('sidebar.sessions.sortUpdated', '最近更新')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {createdTimestampUnavailable ? (
              <p className="px-2 pb-0.5 pt-1 text-[10px] leading-4 text-aegis-text-dim">
                {t(
                  'sidebar.sessions.createdTimestampUnavailable',
                  'OpenClaw 未返回可核验的创建时间',
                )}
              </p>
            ) : createdTimestampPartial ? (
              <p className="px-2 pb-0.5 pt-1 text-[10px] leading-4 text-aegis-text-dim">
                {t(
                  'sidebar.sessions.createdTimestampPartial',
                  '部分历史会话缺少创建时间，会保持 Gateway 返回顺序',
                )}
              </p>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
