import { useMemo, type ReactNode } from 'react';
import {
  Archive,
  Bot,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Clock3,
  Coffee,
  Crown,
  MonitorCog,
  Play,
  ShieldQuestion,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AGENT_OFFICE_ZONE_IDS,
  buildAgentOfficeProjection,
  type AgentOfficeAgentProjection,
  type AgentOfficeAgentState,
  type AgentOfficeZoneId,
} from '@/processing/agentOfficeProjection';
import type {
  CollaborationCapabilityAgent,
  CollaborationRunSnapshot,
} from '@/types/collaboration';
import {
  collaborationWorkItemStatusLabel,
  type CollaborationTranslate,
} from './CollaborationCard';
import { AgentOfficeCharacter, AgentOfficeFurniture } from './AgentOfficeArtwork';

interface AgentOfficeViewProps {
  snapshot: CollaborationRunSnapshot;
  configuredAgents?: readonly CollaborationCapabilityAgent[];
  coordinatorAgentId?: string | null;
  text: CollaborationTranslate;
  className?: string;
}

const ZONE_PRESENTATION: Record<AgentOfficeZoneId, {
  titleKey: string;
  fallback: string;
  descriptionKey: string;
  description: string;
  icon: ReactNode;
  roomClassName: string;
  deskClassName: string;
}> = {
  coordination: {
    titleKey: 'collaboration.office.zones.coordination',
    fallback: 'Coordination desk',
    descriptionKey: 'collaboration.office.zoneDescriptions.coordination',
    description: 'Planning, synthesis, and delivery coordination',
    icon: <Crown size={14} aria-hidden />,
    roomClassName: 'lg:col-start-1 lg:row-start-1 border-aegis-primary/25 bg-aegis-primary/[0.045]',
    deskClassName: 'border-aegis-primary/25 bg-aegis-elevated-solid',
  },
  active: {
    titleKey: 'collaboration.office.zones.active',
    fallback: 'Active desks',
    descriptionKey: 'collaboration.office.zoneDescriptions.active',
    description: 'Agents with an active authoritative attempt',
    icon: <MonitorCog size={14} aria-hidden />,
    roomClassName: 'lg:col-start-2 lg:row-span-2 border-aegis-primary/35 bg-aegis-primary/[0.055]',
    deskClassName: 'border-aegis-primary/35 bg-aegis-elevated-solid shadow-[0_12px_24px_rgb(var(--aegis-overlay)/0.055)]',
  },
  waiting: {
    titleKey: 'collaboration.office.zones.waiting',
    fallback: 'Waiting desks',
    descriptionKey: 'collaboration.office.zoneDescriptions.waiting',
    description: 'Assigned work waiting for dispatch or dependencies',
    icon: <Coffee size={14} aria-hidden />,
    roomClassName: 'lg:col-start-1 lg:row-start-2 bg-[rgb(var(--aegis-overlay)/0.018)]',
    deskClassName: 'border-aegis-border bg-aegis-elevated-solid',
  },
  attention: {
    titleKey: 'collaboration.office.zones.attention',
    fallback: 'Attention desk',
    descriptionKey: 'collaboration.office.zoneDescriptions.attention',
    description: 'Intervention required or execution status unconfirmed',
    icon: <CircleAlert size={14} aria-hidden />,
    roomClassName: 'lg:col-start-3 lg:row-start-1 border-aegis-warning/35 bg-aegis-warning/[0.055]',
    deskClassName: 'border-aegis-warning/35 bg-aegis-elevated-solid',
  },
  completed: {
    titleKey: 'collaboration.office.zones.completed',
    fallback: 'Completed desks',
    descriptionKey: 'collaboration.office.zoneDescriptions.completed',
    description: 'All assigned work items are settled',
    icon: <Archive size={14} aria-hidden />,
    roomClassName: 'lg:col-start-3 lg:row-start-2 border-aegis-success/25 bg-aegis-success/[0.045]',
    deskClassName: 'border-aegis-success/25 bg-aegis-elevated-solid',
  },
};

const STATE_ICON: Record<AgentOfficeAgentState, ReactNode> = {
  COORDINATING: <Crown size={12} aria-hidden />,
  ACTIVE: <Play size={12} aria-hidden />,
  WAITING: <Clock3 size={12} aria-hidden />,
  ATTENTION: <CircleAlert size={12} aria-hidden />,
  UNKNOWN: <ShieldQuestion size={12} aria-hidden />,
  COMPLETED: <CheckCircle2 size={12} aria-hidden />,
  IDLE: <CircleDashed size={12} aria-hidden />,
};

function stateTone(state: AgentOfficeAgentState): string {
  if (state === 'ATTENTION' || state === 'UNKNOWN') return 'text-aegis-warning';
  if (state === 'COMPLETED') return 'text-aegis-success';
  if (state === 'ACTIVE' || state === 'COORDINATING') return 'text-aegis-primary';
  return 'text-aegis-text-muted';
}

function stateLabel(state: AgentOfficeAgentState, text: CollaborationTranslate): string {
  const fallback: Record<AgentOfficeAgentState, string> = {
    COORDINATING: 'Coordinating',
    ACTIVE: 'Executing',
    WAITING: 'Waiting',
    ATTENTION: 'Needs attention',
    UNKNOWN: 'Status unconfirmed',
    COMPLETED: 'Completed',
    IDLE: 'No active work',
  };
  return text(`collaboration.office.states.${state}`, fallback[state]);
}

function artworkState(state: AgentOfficeAgentState): 'active' | 'waiting' | 'attention' | 'completed' {
  if (state === 'ACTIVE' || state === 'COORDINATING') return 'active';
  if (state === 'ATTENTION' || state === 'UNKNOWN') return 'attention';
  if (state === 'COMPLETED') return 'completed';
  return 'waiting';
}

function AgentDesk({
  agent,
  text,
  zone,
}: {
  agent: AgentOfficeAgentProjection;
  text: CollaborationTranslate;
  zone: AgentOfficeZoneId;
}) {
  const workItem = agent.currentWorkItem;
  const stateCopy = stateLabel(agent.state, text);
  const active = agent.state === 'ACTIVE' || agent.state === 'COORDINATING';
  return (
    <article
      className={cn(
        'relative min-w-0 rounded-lg border px-2.5 pb-2.5 pt-2 transition-[transform,border-color,box-shadow] duration-200 motion-reduce:transform-none motion-reduce:transition-none',
        'hover:-translate-y-px hover:shadow-[0_12px_24px_rgb(var(--aegis-overlay)/0.07)] motion-reduce:hover:translate-y-0',
        ZONE_PRESENTATION[zone].deskClassName,
        active && 'ring-1 ring-aegis-primary/20',
      )}
      data-office-agent-id={agent.agentId}
      data-office-agent-state={agent.state}
      data-office-desk-id={agent.deskId}
      aria-label={text('collaboration.office.agentDeskLabel', '{{agent}}, {{state}}', {
        agent: agent.displayName,
        state: stateCopy,
      })}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className={cn('relative grid size-12 shrink-0 place-items-center rounded-md border border-aegis-border bg-aegis-surface-solid', stateTone(agent.state), active && 'border-aegis-primary/35')}>
          <AgentOfficeCharacter
            agentId={agent.agentId}
            state={artworkState(agent.state)}
            coordinator={agent.coordinator}
            className="h-11 w-10"
          />
          <span className={cn('absolute -bottom-1 -end-1 grid size-4 place-items-center rounded-sm border border-aegis-border bg-aegis-surface-solid', stateTone(agent.state))}>
            {STATE_ICON[agent.state]}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <h4 className="min-w-0 flex-1 truncate text-[11px] font-semibold text-aegis-text-secondary" title={agent.displayName}>
              {agent.displayName}
            </h4>
            {agent.coordinator && (
              <span className="shrink-0 rounded-sm bg-aegis-primary/[0.1] px-1 py-0.5 text-[8px] font-medium text-aegis-primary">
                {text('collaboration.office.coordinator', 'Coordinator')}
              </span>
            )}
          </div>
          <div className={cn('mt-1 flex items-center gap-1 text-[9px] font-medium', stateTone(agent.state))}>
            {STATE_ICON[agent.state]}
            <span className="truncate">{stateCopy}</span>
          </div>
        </div>
      </div>

      <div className="mt-2 min-h-9 border-t border-aegis-border/80 pt-2">
        {workItem ? (
          <>
            <p className="line-clamp-2 break-words text-[10px] font-medium leading-4 text-aegis-text-secondary">
              {workItem.title}
            </p>
            <div className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[8.5px] text-aegis-text-dim">
              <span className="truncate">{collaborationWorkItemStatusLabel(workItem.status, text)}</span>
              <span className="shrink-0 font-mono tabular-nums">
                {text('collaboration.office.workItemProgress', '{{completed}}/{{total}} settled', {
                  completed: agent.completedWorkItemCount,
                  total: agent.workItemCount,
                })}
              </span>
            </div>
          </>
        ) : (
          <div className="flex min-h-7 items-center gap-1.5 text-[9.5px] text-aegis-text-dim">
            <CircleDashed size={11} aria-hidden />
            <span>{text('collaboration.office.noAssignedWork', 'No assigned work item')}</span>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-aegis-border/70 pt-1.5 text-[8px] text-aegis-text-dim">
        <span>{text('collaboration.office.runtime', 'Runtime')}</span>
        <span className="min-w-0 truncate font-mono text-aegis-text-muted" title={agent.runtimeType}>
          {agent.runtimeType ?? text('collaboration.office.runtimeUnknown', 'Not projected')}
        </span>
      </div>
    </article>
  );
}

function ConfiguredDesk({
  agent,
  text,
}: {
  agent: CollaborationCapabilityAgent;
  text: CollaborationTranslate;
}) {
  const label = agent.coordinator
    ? text('agentHub.office.configuredCoordinator', 'Coordinator Agent')
    : agent.allowed
      ? text('agentHub.office.configuredAllowed', 'Allowed to participate')
      : text('agentHub.office.configuredUnavailable', 'Not allowed to participate');
  const displayName = agent.name?.trim() || agent.id;
  return (
    <article
      className="relative min-w-0 rounded-lg border border-dashed border-aegis-border bg-aegis-surface-solid/80 px-2.5 pb-2.5 pt-2"
      data-office-configured-agent-id={agent.id}
      data-office-seat="configured"
      aria-label={text('collaboration.office.configuredDeskLabel', '{{agent}}, configured desk; no current run participation', { agent: displayName })}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="relative grid size-12 shrink-0 place-items-center rounded-md border border-aegis-border bg-aegis-surface-solid text-aegis-text-muted">
          <AgentOfficeCharacter
            agentId={agent.id}
            state="configured"
            coordinator={agent.coordinator}
            className="h-11 w-10"
          />
          <span className="absolute -bottom-1 -end-1 rounded-sm border border-aegis-border bg-aegis-surface-solid px-1 py-0.5 text-[7px] font-medium text-aegis-text-dim">
            {text('collaboration.office.configuredDeskBadge', 'Configured')}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-[11px] font-semibold text-aegis-text-secondary" title={displayName}>{displayName}</h4>
          <p className="mt-1 truncate text-[9px] text-aegis-text-muted">{label}</p>
        </div>
      </div>
      <p className="mt-2 border-t border-aegis-border/70 pt-2 text-[9px] leading-4 text-aegis-text-dim">
        {text('collaboration.office.configuredDeskDescription', 'Configured seat only. It does not claim current run participation, live presence, or execution state.')}
      </p>
    </article>
  );
}

function OfficeZone({
  zone,
  agents,
  configuredAgents,
  officeId,
  text,
}: {
  zone: AgentOfficeZoneId;
  agents: readonly AgentOfficeAgentProjection[];
  configuredAgents: readonly CollaborationCapabilityAgent[];
  officeId: string;
  text: CollaborationTranslate;
}) {
  const presentation = ZONE_PRESENTATION[zone];
  const activeZone = zone === 'active';
  return (
    <section
      className={cn(
        'relative min-h-40 overflow-hidden rounded-lg border p-2.5 sm:p-3',
        presentation.roomClassName,
      )}
      data-office-zone={zone}
      aria-labelledby={`office-zone-${officeId}-${zone}`}
    >
      <div className="pointer-events-none absolute inset-x-3 top-10 border-t border-dashed border-aegis-border/60" aria-hidden="true" />
      <AgentOfficeFurniture kind={zone} className={cn('pointer-events-none absolute right-2 top-8 h-16 w-28 opacity-35', zone === 'attention' ? 'text-aegis-warning' : zone === 'completed' ? 'text-aegis-success' : 'text-aegis-primary')} />
      <header className="relative flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`office-zone-${officeId}-${zone}`} className="flex items-center gap-1.5 text-[10.5px] font-semibold text-aegis-text-secondary">
            <span className={cn(zone === 'attention' ? 'text-aegis-warning' : zone === 'completed' ? 'text-aegis-success' : 'text-aegis-primary')}>
              {presentation.icon}
            </span>
            <span>{text(presentation.titleKey, presentation.fallback)}</span>
          </h3>
          <p className="mt-0.5 truncate text-[8.5px] text-aegis-text-dim" title={text(presentation.descriptionKey, presentation.description)}>
            {text(presentation.descriptionKey, presentation.description)}
          </p>
        </div>
        <span className="grid size-5 shrink-0 place-items-center rounded-sm border border-aegis-border bg-aegis-surface-solid font-mono text-[8.5px] tabular-nums text-aegis-text-muted">
          {agents.length + configuredAgents.length}
        </span>
      </header>

      <div className={cn(
        'relative mt-4 grid min-w-0 gap-2',
        activeZone ? 'sm:grid-cols-2 xl:grid-cols-3' : 'sm:grid-cols-2',
      )}>
        {agents.map((agent) => <AgentDesk key={agent.agentId} agent={agent} text={text} zone={zone} />)}
        {configuredAgents.map((agent) => <ConfiguredDesk key={agent.id} agent={agent} text={text} />)}
      </div>
    </section>
  );
}

export function AgentOfficeView({
  snapshot,
  configuredAgents = [],
  coordinatorAgentId = null,
  text,
  className,
}: AgentOfficeViewProps) {
  const office = useMemo(() => (
    buildAgentOfficeProjection(snapshot, configuredAgents, coordinatorAgentId)
  ), [configuredAgents, coordinatorAgentId, snapshot]);
  const configuredSeatAgents = useMemo(() => {
    const projectedAgentIds = new Set(office.agents.map((agent) => agent.agentId));
    return configuredAgents.filter((agent) => !projectedAgentIds.has(agent.id));
  }, [configuredAgents, office.agents]);

  if (office.agents.length === 0 && configuredSeatAgents.length === 0) {
    return (
      <div
        className={cn('flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.018)] px-5 text-center', className)}
        data-work-item-view="office"
      >
        <Bot size={20} className="text-aegis-text-dim" aria-hidden />
        <div className="text-[11px] text-aegis-text-muted">
          {text('collaboration.office.empty', 'No authoritative Agent assignment is available for this run.')}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn('min-w-0 overflow-hidden rounded-lg border border-aegis-border bg-aegis-surface-solid', className)}
      data-work-item-view="office"
      data-agent-office={office.officeId}
      data-office-layout="spatial"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-aegis-border bg-aegis-bg/45 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold text-aegis-text-secondary">
            {text('collaboration.office.title', 'Agent Office')}
          </div>
          <p className="mt-0.5 max-w-[68ch] text-[9.5px] leading-4 text-aegis-text-dim">
            {text('collaboration.office.authorityNotice', 'Read-only projection from the authoritative collaboration snapshot. Desk placement does not change orchestration state.')}
          </p>
        </div>
        <div className="shrink-0 font-mono text-[9.5px] tabular-nums text-aegis-text-muted">
          {text('collaboration.office.agentCount', '{{count}} Agents', { count: office.agents.length })}
        </div>
      </div>

      <div className="min-w-0 bg-aegis-bg/30 p-2.5 sm:p-3">
        <div className="grid min-w-0 gap-2.5 lg:grid-cols-[minmax(11rem,0.85fr)_minmax(20rem,1.7fr)_minmax(11rem,0.85fr)] lg:grid-rows-[minmax(11rem,0.9fr)_minmax(13rem,1.1fr)]">
          {AGENT_OFFICE_ZONE_IDS.map((zone) => (
            <OfficeZone
              key={zone}
              zone={zone}
              agents={office.agents.filter((agent) => agent.zoneId === zone)}
              configuredAgents={zone === 'waiting' ? configuredSeatAgents : []}
              officeId={office.officeId}
              text={text}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
