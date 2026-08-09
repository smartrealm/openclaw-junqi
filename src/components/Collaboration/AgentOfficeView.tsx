import { useMemo, type ReactNode } from 'react';
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Clock3,
  Crown,
  Play,
  ShieldQuestion,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
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
}> = {
  coordination: {
    titleKey: 'collaboration.office.zones.coordination',
    fallback: 'Coordination desk',
    descriptionKey: 'collaboration.office.zoneDescriptions.coordination',
    description: 'Planning, synthesis, and delivery coordination',
    icon: <Crown size={13} aria-hidden />,
  },
  active: {
    titleKey: 'collaboration.office.zones.active',
    fallback: 'Active desks',
    descriptionKey: 'collaboration.office.zoneDescriptions.active',
    description: 'Agents with an active authoritative attempt',
    icon: <Play size={13} aria-hidden />,
  },
  waiting: {
    titleKey: 'collaboration.office.zones.waiting',
    fallback: 'Waiting desks',
    descriptionKey: 'collaboration.office.zoneDescriptions.waiting',
    description: 'Assigned work waiting for dispatch or dependencies',
    icon: <Clock3 size={13} aria-hidden />,
  },
  attention: {
    titleKey: 'collaboration.office.zones.attention',
    fallback: 'Attention desk',
    descriptionKey: 'collaboration.office.zoneDescriptions.attention',
    description: 'Intervention required or execution status unconfirmed',
    icon: <CircleAlert size={13} aria-hidden />,
  },
  completed: {
    titleKey: 'collaboration.office.zones.completed',
    fallback: 'Completed desks',
    descriptionKey: 'collaboration.office.zoneDescriptions.completed',
    description: 'All assigned work items are settled',
    icon: <CheckCircle2 size={13} aria-hidden />,
  },
};

const STATE_ICON: Record<AgentOfficeAgentState, ReactNode> = {
  COORDINATING: <Crown size={13} aria-hidden />,
  ACTIVE: <Play size={13} aria-hidden />,
  WAITING: <Clock3 size={13} aria-hidden />,
  ATTENTION: <CircleAlert size={13} aria-hidden />,
  UNKNOWN: <ShieldQuestion size={13} aria-hidden />,
  COMPLETED: <CheckCircle2 size={13} aria-hidden />,
  IDLE: <CircleDashed size={13} aria-hidden />,
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

function initials(name: string): string {
  const segments = name.trim().split(/\s+/).filter(Boolean);
  const value = segments.length > 1
    ? `${segments[0]?.[0] ?? ''}${segments[segments.length - 1]?.[0] ?? ''}`
    : name.trim().slice(0, 2);
  return value.toLocaleUpperCase();
}

function AgentDesk({ agent, text }: { agent: AgentOfficeAgentProjection; text: CollaborationTranslate }) {
  const workItem = agent.currentWorkItem;
  const stateCopy = stateLabel(agent.state, text);
  return (
    <article
      className={cn(
        'group min-w-0 rounded-md border bg-aegis-surface-solid px-3 py-3 transition-[transform,border-color,background-color] duration-200 motion-reduce:transform-none motion-reduce:transition-none',
        'border-aegis-border hover:-translate-y-px hover:border-aegis-border-hover hover:bg-aegis-elevated-solid motion-reduce:hover:translate-y-0',
      )}
      data-office-agent-id={agent.agentId}
      data-office-agent-state={agent.state}
      data-office-desk-id={agent.deskId}
      aria-label={text('collaboration.office.agentDeskLabel', '{{agent}}, {{state}}', {
        agent: agent.displayName,
        state: stateCopy,
      })}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.035)] font-mono text-[10px] font-semibold text-aegis-text-secondary">
          {initials(agent.displayName)}
          <span className={cn('absolute -bottom-1 -end-1 rounded-sm border border-aegis-border bg-aegis-surface-solid p-0.5', stateTone(agent.state))}>
            {STATE_ICON[agent.state]}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="min-w-0 truncate text-[11.5px] font-semibold text-aegis-text-secondary" title={agent.displayName}>
              {agent.displayName}
            </h4>
            {agent.coordinator && (
              <span className="rounded-sm bg-aegis-primary/[0.09] px-1 py-0.5 text-[8.5px] font-medium text-aegis-primary">
                {text('collaboration.office.coordinator', 'Coordinator')}
              </span>
            )}
          </div>
          <div className={cn('mt-0.5 flex items-center gap-1 text-[9.5px] font-medium', stateTone(agent.state))}>
            {STATE_ICON[agent.state]}
            <span>{stateCopy}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 min-h-[42px] border-t border-aegis-border pt-2.5">
        {workItem ? (
          <>
            <div className="line-clamp-2 break-words text-[10.5px] font-medium leading-4 text-aegis-text-secondary">
              {workItem.title}
            </div>
            <div className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[9px] text-aegis-text-dim">
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
          <div className="flex min-h-8 items-center gap-1.5 text-[10px] text-aegis-text-dim">
            <CircleDashed size={12} aria-hidden />
            <span>{text('collaboration.office.noAssignedWork', 'No assigned work item')}</span>
          </div>
        )}
      </div>

      <dl className="mt-2 grid min-w-0 grid-cols-2 gap-2 text-[8.5px] text-aegis-text-dim">
        <div className="min-w-0">
          <dt>{text('collaboration.office.runtime', 'Runtime')}</dt>
          <dd className="mt-0.5 truncate font-mono text-aegis-text-muted">
            {agent.runtimeType ?? text('collaboration.office.runtimeUnknown', 'Not projected')}
          </dd>
        </div>
        <div className="min-w-0 text-end">
          <dt>{text('collaboration.office.desk', 'Desk')}</dt>
          <dd className="mt-0.5 truncate font-mono text-aegis-text-muted">{agent.deskId}</dd>
        </div>
      </dl>
    </article>
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

  if (office.agents.length === 0) {
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
      className={cn('min-w-0 overflow-hidden rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.018)]', className)}
      data-work-item-view="office"
      data-agent-office={office.officeId}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-aegis-border px-3 py-2.5">
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

      <div className="grid min-w-0 gap-2.5 p-2.5 lg:grid-cols-2">
        {office.zones.map((zone) => {
          const presentation = ZONE_PRESENTATION[zone.id];
          const agents = zone.agentIds.map((agentId) => office.agents.find((agent) => agent.agentId === agentId)!);
          return (
            <section
              key={zone.id}
              className={cn(
                'min-w-0 rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.018)] p-2.5',
                zone.id === 'attention' && 'border-aegis-warning/25 bg-aegis-warning/[0.025]',
              )}
              data-office-zone={zone.id}
              aria-labelledby={`office-zone-${office.officeId}-${zone.id}`}
            >
              <header className="mb-2 flex min-w-0 items-start justify-between gap-2 px-0.5">
                <div className="min-w-0">
                  <h3 id={`office-zone-${office.officeId}-${zone.id}`} className="flex items-center gap-1.5 text-[10.5px] font-semibold text-aegis-text-secondary">
                    <span className={zone.id === 'attention' ? 'text-aegis-warning' : 'text-aegis-text-muted'}>{presentation.icon}</span>
                    <span>{text(presentation.titleKey, presentation.fallback)}</span>
                  </h3>
                  <p className="mt-0.5 truncate text-[8.5px] text-aegis-text-dim" title={text(presentation.descriptionKey, presentation.description)}>
                    {text(presentation.descriptionKey, presentation.description)}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[9px] tabular-nums text-aegis-text-dim">{agents.length}</span>
              </header>
              <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                {agents.map((agent) => <AgentDesk key={agent.agentId} agent={agent} text={text} />)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
