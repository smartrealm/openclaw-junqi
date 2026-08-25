import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, CircleDashed } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildAgentFleetActivityProjection,
  type AgentFleetActivityAgentInput,
  type AgentFleetActivitySessionInput,
} from '@/processing/agentFleetActivityProjection';
import { AgentOfficeCharacter } from '@/components/Collaboration/AgentOfficeArtwork';

interface AgentHubFleetActivityPanelProps {
  agents: readonly AgentFleetActivityAgentInput[];
  sessions: readonly AgentFleetActivitySessionInput[];
}

/**
 * 展示全部已配置 Agent 的忙闲状态，只由 OpenClaw 官方 sessions.list 的
 * running/hasActiveRun/hasActiveSubagentRun 权威字段派生，不依赖协作插件许可名单。
 */
export function AgentHubFleetActivityPanel({
  agents,
  sessions,
}: AgentHubFleetActivityPanelProps) {
  const { t, i18n } = useTranslation();
  const projection = useMemo(
    () => buildAgentFleetActivityProjection(agents, sessions),
    [agents, sessions],
  );

  if (projection.length === 0) return null;

  const busy = projection.filter((entry) => entry.active);
  const idle = projection.filter((entry) => !entry.active);

  const renderCard = (entry: (typeof projection)[number]) => (
    <article
      key={entry.agentId}
      data-agent-hub-fleet-agent-id={entry.agentId}
      data-agent-hub-fleet-state={entry.active ? 'busy' : 'idle'}
      aria-label={`${entry.displayName}，${entry.active
        ? t('agentHub.office.fleetBusy', '忙碌')
        : t('agentHub.office.fleetIdle', '空闲')}`}
      className="relative flex min-w-0 items-center gap-2.5 rounded-lg border border-aegis-border bg-aegis-surface-solid px-2.5 py-2.5"
    >
      <div className={cn(
        'relative grid size-11 shrink-0 place-items-center rounded-md border bg-aegis-surface-solid',
        entry.active ? 'border-aegis-primary/30 text-aegis-primary' : 'border-aegis-border text-aegis-text-dim',
      )}>
        <AgentOfficeCharacter
          agentId={entry.agentId}
          state={entry.active ? 'active' : 'waiting'}
          className="h-10 w-9"
        />
      </div>
      <div className="min-w-0 flex-1">
        <h5 className="truncate text-xs font-semibold text-aegis-text" title={entry.displayName}>
          {entry.displayName}
        </h5>
        <p className={cn(
          'mt-0.5 truncate text-[10px] font-medium',
          entry.active ? 'text-aegis-primary' : 'text-aegis-text-dim',
        )}>
          {entry.active
            ? t('agentHub.office.fleetActiveSessionCount', '{{count}} 个活动会话', { count: entry.activeSessionCount })
            : t('agentHub.office.fleetIdle', '空闲')}
        </p>
      </div>
      {entry.lastActiveAt !== null && (
        <span className="shrink-0 text-[9.5px] text-aegis-text-dim">
          {new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
            dateStyle: 'short',
            timeStyle: 'short',
          }).format(entry.lastActiveAt)}
        </span>
      )}
    </article>
  );

  return (
    <section className="w-full text-left" aria-labelledby="agent-hub-fleet-activity-title" data-agent-hub-fleet-activity>
      <div className="mb-3 flex min-w-0 items-start gap-2 px-1">
        <div className="grid size-7 shrink-0 place-items-center rounded-lg border border-aegis-primary/25 bg-aegis-primary/[0.08] text-aegis-primary">
          <Activity size={14} aria-hidden />
        </div>
        <div className="min-w-0">
          <h4 id="agent-hub-fleet-activity-title" className="text-xs font-semibold text-aegis-text-secondary">
            {t('agentHub.office.fleetActivityTitle', '智能体运行状态')}
          </h4>
          <p className="mt-0.5 text-[11px] leading-4 text-aegis-text-muted">
            {t('agentHub.office.fleetActivityDescription', '基于 OpenClaw 会话权威状态的忙闲总览，与协作许可无关。')}
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-lg border border-aegis-primary/20 bg-aegis-primary/[0.03] p-3">
          <header className="flex items-center gap-1.5 text-[10.5px] font-semibold text-aegis-text-secondary">
            <Activity size={13} className="text-aegis-primary" aria-hidden />
            <span>{t('agentHub.office.fleetBusyZone', '忙碌')}</span>
            <span className="ms-auto grid size-5 place-items-center rounded-sm border border-aegis-border bg-aegis-surface-solid font-mono text-[9px] tabular-nums text-aegis-text-muted">
              {busy.length}
            </span>
          </header>
          <div className="mt-2 space-y-2">
            {busy.length > 0
              ? busy.map(renderCard)
              : <span className="block text-[10px] text-aegis-text-dim">{t('agentHub.office.fleetNoBusy', '当前没有正在运行的 Agent')}</span>}
          </div>
        </section>
        <section className="rounded-lg border border-aegis-border bg-aegis-surface p-3">
          <header className="flex items-center gap-1.5 text-[10.5px] font-semibold text-aegis-text-secondary">
            <CircleDashed size={13} className="text-aegis-text-muted" aria-hidden />
            <span>{t('agentHub.office.fleetIdleZone', '空闲')}</span>
            <span className="ms-auto grid size-5 place-items-center rounded-sm border border-aegis-border bg-aegis-surface-solid font-mono text-[9px] tabular-nums text-aegis-text-muted">
              {idle.length}
            </span>
          </header>
          <div className="mt-2 space-y-2">
            {idle.length > 0
              ? idle.map(renderCard)
              : <span className="block text-[10px] text-aegis-text-dim">{t('agentHub.office.fleetNoIdle', '所有 Agent 都在运行中')}</span>}
          </div>
        </section>
      </div>
    </section>
  );
}
