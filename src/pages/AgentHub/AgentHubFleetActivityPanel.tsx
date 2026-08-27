import { useMemo } from 'react';
import { MonitorCog, Coffee } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildAgentFleetActivityProjection,
  type AgentFleetActivityAgentInput,
  type AgentFleetActivitySessionInput,
} from '@/processing/agentFleetActivityProjection';
import { AgentOfficeDeskScene, AgentOfficeFurniture } from '@/components/Collaboration/AgentOfficeArtwork';
import type { CollaborationTranslate } from '@/components/Collaboration/CollaborationCard';

interface AgentHubFleetActivityPanelProps {
  agents: readonly AgentFleetActivityAgentInput[];
  sessions: readonly AgentFleetActivitySessionInput[];
  text: CollaborationTranslate;
}

function FleetDesk({
  entry,
  text,
}: {
  entry: ReturnType<typeof buildAgentFleetActivityProjection>[number];
  text: CollaborationTranslate;
}) {
  return (
    <article
      data-agent-hub-fleet-agent-id={entry.agentId}
      data-agent-hub-fleet-state={entry.active ? 'busy' : 'idle'}
      aria-label={text('collaboration.office.agentDeskLabel', '{{agent}}, {{state}}', {
        agent: entry.displayName,
        state: entry.active
          ? text('agentHub.office.fleetBusy', '忙碌')
          : text('agentHub.office.fleetIdle', '空闲'),
      })}
      className={cn(
        'relative min-w-0 rounded-lg border pb-2 pt-1.5 transition-[transform,border-color,box-shadow] duration-200 motion-reduce:transform-none motion-reduce:transition-none',
        'hover:-translate-y-px hover:shadow-[0_12px_24px_rgb(var(--aegis-overlay)/0.07)] motion-reduce:hover:translate-y-0',
        entry.active
          ? 'border-aegis-primary/35 bg-aegis-elevated-solid ring-1 ring-aegis-primary/20'
          : 'border-aegis-border bg-aegis-elevated-solid',
      )}
    >
      <div className={cn(
        'flex min-w-0 justify-center',
        entry.active ? 'text-aegis-primary' : 'text-aegis-text-muted',
      )}>
        <AgentOfficeDeskScene
          agentId={entry.agentId}
          state={entry.active ? 'active' : 'waiting'}
          className="h-16 w-20"
        />
      </div>
      <div className="min-w-0 px-2.5 text-center">
        <h4 className="truncate text-[11px] font-semibold text-aegis-text-secondary" title={entry.displayName}>
          {entry.displayName}
        </h4>
        <div className={cn(
          'mt-0.5 flex items-center justify-center gap-1 text-[9px] font-medium',
          entry.active ? 'text-aegis-primary' : 'text-aegis-text-muted',
        )}>
          <span className="truncate">
            {entry.active
              ? text('agentHub.office.fleetActiveSessionCount', '{{count}} 个活动会话', { count: entry.activeSessionCount })
              : text('agentHub.office.fleetIdle', '空闲')}
          </span>
        </div>
      </div>
    </article>
  );
}

/**
 * 智能体运行状态总览：复用 AgentOfficeView 的房间与工位视觉语言，
 * 只由 OpenClaw 官方 sessions.list 的 running/hasActiveRun/hasActiveSubagentRun
 * 权威字段派生忙闲两个房间，不依赖协作插件许可名单。
 */
export function AgentHubFleetActivityPanel({
  agents,
  sessions,
  text,
}: AgentHubFleetActivityPanelProps) {
  const projection = useMemo(
    () => buildAgentFleetActivityProjection(agents, sessions),
    [agents, sessions],
  );

  if (projection.length === 0) return null;

  const busy = projection.filter((entry) => entry.active);
  const idle = projection.filter((entry) => !entry.active);

  return (
    <div
      className="min-w-0 overflow-hidden rounded-lg border border-aegis-border bg-aegis-surface-solid"
      data-agent-hub-fleet-activity
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-aegis-border bg-aegis-bg/45 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold text-aegis-text-secondary">
            {text('agentHub.office.fleetActivityTitle', '智能体运行状态')}
          </div>
          <p className="mt-0.5 max-w-[68ch] text-[9.5px] leading-4 text-aegis-text-dim">
            {text('agentHub.office.fleetActivityDescription', '基于 OpenClaw 会话权威状态的忙闲总览，与协作许可无关。')}
          </p>
        </div>
        <div className="shrink-0 font-mono text-[9.5px] tabular-nums text-aegis-text-muted">
          {text('collaboration.office.agentCount', '{{count}} 个智能体', { count: projection.length })}
        </div>
      </div>

      <div className="min-w-0 bg-aegis-bg/30 p-2.5 sm:p-3">
        <div className="grid min-w-0 gap-2.5 lg:grid-cols-2">
          <section
            className="relative min-h-40 overflow-hidden rounded-lg border border-aegis-primary/35 bg-aegis-primary/[0.055] p-2.5 sm:p-3"
            data-agent-hub-fleet-zone="busy"
            aria-labelledby="agent-hub-fleet-zone-busy"
          >
            <div className="pointer-events-none absolute inset-x-3 top-10 border-t border-dashed border-aegis-border/60" aria-hidden="true" />
            <AgentOfficeFurniture kind="active" className="pointer-events-none absolute right-2 top-8 h-16 w-28 text-aegis-primary opacity-35" />
            <header className="relative flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 id="agent-hub-fleet-zone-busy" className="flex items-center gap-1.5 text-[10.5px] font-semibold text-aegis-text-secondary">
                  <MonitorCog size={14} className="text-aegis-primary" aria-hidden />
                  <span>{text('agentHub.office.fleetBusyZone', '忙碌')}</span>
                </h3>
              </div>
              <span className="grid size-5 shrink-0 place-items-center rounded-sm border border-aegis-border bg-aegis-surface-solid font-mono text-[8.5px] tabular-nums text-aegis-text-muted">
                {busy.length}
              </span>
            </header>
            <div className="relative mt-4 grid min-w-0 gap-2 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
              {busy.length > 0
                ? busy.map((entry) => <FleetDesk key={entry.agentId} entry={entry} text={text} />)
                : (
                  <span className="col-span-full text-[10px] text-aegis-text-dim">
                    {text('agentHub.office.fleetNoBusy', '当前没有正在运行的 Agent')}
                  </span>
                )}
            </div>
          </section>

          <section
            className="relative min-h-40 overflow-hidden rounded-lg border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.018)] p-2.5 sm:p-3"
            data-agent-hub-fleet-zone="idle"
            aria-labelledby="agent-hub-fleet-zone-idle"
          >
            <div className="pointer-events-none absolute inset-x-3 top-10 border-t border-dashed border-aegis-border/60" aria-hidden="true" />
            <AgentOfficeFurniture kind="waiting" className="pointer-events-none absolute right-2 top-8 h-16 w-28 text-aegis-primary opacity-35" />
            <header className="relative flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 id="agent-hub-fleet-zone-idle" className="flex items-center gap-1.5 text-[10.5px] font-semibold text-aegis-text-secondary">
                  <Coffee size={14} className="text-aegis-primary" aria-hidden />
                  <span>{text('agentHub.office.fleetIdleZone', '空闲')}</span>
                </h3>
              </div>
              <span className="grid size-5 shrink-0 place-items-center rounded-sm border border-aegis-border bg-aegis-surface-solid font-mono text-[8.5px] tabular-nums text-aegis-text-muted">
                {idle.length}
              </span>
            </header>
            <div className="relative mt-4 grid min-w-0 gap-2 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
              {idle.length > 0
                ? idle.map((entry) => <FleetDesk key={entry.agentId} entry={entry} text={text} />)
                : (
                  <span className="col-span-full text-[10px] text-aegis-text-dim">
                    {text('agentHub.office.fleetNoIdle', '所有 Agent 都在运行中')}
                  </span>
                )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
