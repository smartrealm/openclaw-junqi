import { ListFilter, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SidebarSessionGrouping, SidebarSessionSortMode } from './sidebarUtils';

export interface SessionScopeAgentOption {
  readonly id: string;
  readonly label: string;
}

interface SessionScopeControlsProps {
  readonly agents: readonly SessionScopeAgentOption[];
  readonly selectedAgentId: string;
  readonly grouping: SidebarSessionGrouping;
  readonly sortMode: SidebarSessionSortMode;
  readonly agentsLoading: boolean;
  readonly agentsFailed: boolean;
  readonly createDisabled: boolean;
  readonly onAgentChange: (agentId: string) => void;
  readonly onGroupingChange: (grouping: SidebarSessionGrouping) => void;
  readonly onSortModeChange: (mode: SidebarSessionSortMode) => void;
  readonly onCreateSession: () => void;
}

export function SessionScopeControls({
  agents,
  selectedAgentId,
  grouping,
  sortMode,
  agentsLoading,
  agentsFailed,
  createDisabled,
  onAgentChange,
  onGroupingChange,
  onSortModeChange,
  onCreateSession,
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

  return (
    <div className="shrink-0 px-3 pb-2">
      <div className="flex h-9 items-center gap-2">
        <span className="shrink-0 text-[12px] font-semibold text-aegis-text-secondary">
          {t('sidebar.sessions.title', '会话')}
        </span>
        <Select value={selectedAgentId} onValueChange={onAgentChange} disabled={agents.length === 0}>
          <SelectTrigger
            aria-label={t('sidebar.sessions.agentScope', '智能体会话范围')}
            className="h-8 min-w-0 flex-1 rounded-lg border-aegis-border/70 bg-aegis-elevated/70 px-2.5 text-[12px] font-semibold text-aegis-text-secondary focus:ring-aegis-primary/30"
          >
            <SelectValue placeholder={agentsLoading
              ? t('sidebar.sessions.loadingAgents', '正在加载智能体')
              : agentsFailed
                ? t('sidebar.sessions.agentsUnavailable', '智能体不可用')
                : t('sidebar.sessions.noAgent', '暂无智能体')} />
          </SelectTrigger>
          <SelectContent className="border-aegis-menu-border bg-aegis-menu-bg text-aegis-text">
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id} className="text-[12px]">
                {agent.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={onCreateSession}
          disabled={createDisabled}
          className={iconButtonClass}
          title={t('sidebar.newChat', '新建对话')}
          aria-label={t('sidebar.newChat', '新建对话')}
        >
          <Plus size={15} aria-hidden="true" />
        </button>
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
              <DropdownMenuRadioItem value="created" className="h-8 text-[12px] text-aegis-text-secondary focus:bg-aegis-hover/40 focus:text-aegis-text">
                {t('sidebar.sessions.sortCreated', '创建时间')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="updated" className="h-8 text-[12px] text-aegis-text-secondary focus:bg-aegis-hover/40 focus:text-aegis-text">
                {t('sidebar.sessions.sortUpdated', '最近更新')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
