import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FileCheck2,
  GitFork,
  History,
  Library,
  List,
  Network,
  RefreshCw,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { hasUnresolvedResidualExecutionRisk } from '@/services/collaboration/types';
import {
  buildWorkflowGraphProjection,
  workflowGraphEdgePath,
  WORKFLOW_GRAPH_NODE_HEIGHT,
  WORKFLOW_GRAPH_NODE_WIDTH,
} from '@/services/collaboration/workflowGraph';
import type {
  CollaborationAttemptSnapshot,
  CollaborationDeliverySnapshot,
  CollaborationEvent,
  CollaborationInterventionSnapshot,
  CollaborationRunSnapshot,
  CollaborationWorkItemSnapshot,
} from '@/services/collaboration/types';
import {
  CollaborationActionBar,
  CollaborationResidualExecutionRiskNotice,
  CollaborationRunStatusIcon,
  CollaborationWorkItemStatusIcon,
  collaborationRunStatusLabel,
  collaborationWorkItemStatusLabel,
  useCollaborationText,
  type CollaborationActionContext,
  type CollaborationTranslate,
} from './CollaborationCard';
import { CollaborationAttemptIdentity } from './CollaborationAttemptIdentity';

export type CollaborationWorkItemView = 'graph' | 'list';

export interface CollaborationDetailsProps {
  snapshot?: CollaborationRunSnapshot | null;
  events?: CollaborationEvent[];
  eventTimelineComplete?: boolean;
  eventTimelineIncompleteReason?: string;
  loading?: boolean;
  error?: string | null;
  workItemView?: CollaborationWorkItemView;
  defaultWorkItemView?: CollaborationWorkItemView;
  pendingAction?: string | null;
  disabledActions?: readonly string[];
  translate?: CollaborationTranslate;
  locale?: string;
  onWorkItemViewChange?: (view: CollaborationWorkItemView) => void;
  onAction?: (context: CollaborationActionContext) => void;
  onRetry?: () => void;
  className?: string;
}

function formatDateTime(timestamp: number | null | undefined, locale?: string): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '-';
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString();
  }
}

function formatDuration(start: number | null | undefined, end: number | null | undefined): string | null {
  if (!start || !end || end < start) return null;
  const seconds = Math.floor((end - start) / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function primitiveEntries(record: object | null | undefined, limit = 5): Array<[string, string]> {
  if (!record) return [];
  const result: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(record)) {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const text = String(value);
      result.push([key, text.length > 180 ? `${text.slice(0, 177)}...` : text]);
    }
    if (result.length >= limit) break;
  }
  return result;
}

function DetailSection({
  title,
  icon,
  count,
  children,
  className,
}: {
  title: string;
  icon: ReactNode;
  count?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-t border-aegis-border px-4 py-4 sm:px-5', className)}>
      <header className="mb-3 flex min-w-0 items-center gap-2">
        <span className="text-aegis-text-muted" aria-hidden>{icon}</span>
        <h3 className="min-w-0 truncate text-[12px] font-semibold text-aegis-text-secondary">{title}</h3>
        {typeof count === 'number' && (
          <span className="font-mono text-[10.5px] tabular-nums text-aegis-text-dim">{count}</span>
        )}
      </header>
      {children}
    </section>
  );
}

function EmptySection({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-2 text-[11px] text-aegis-text-dim">
      <CircleDashed size={13} aria-hidden />
      <span>{children}</span>
    </div>
  );
}

function WorkItemGraph({
  items,
  text,
}: {
  items: CollaborationWorkItemSnapshot[];
  text: CollaborationTranslate;
}) {
  const graph = useMemo(() => buildWorkflowGraphProjection(items), [items]);
  const markerId = useId().replace(/:/g, '');
  return (
    <div
      className="overflow-x-auto rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.018)]"
      role="img"
      aria-label={text('collaboration.details.dagLabel', 'Work dependency graph')}
      data-work-item-view="graph"
      data-work-item-graph
    >
      <div className="relative min-w-full" style={{ width: graph.width, height: graph.height }}>
        <svg
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={graph.width}
          height={graph.height}
          aria-hidden
        >
          <defs>
            <marker id={markerId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" className="fill-aegis-text-dim" />
            </marker>
          </defs>
          {graph.edges.map((edge) => (
            <path
              key={edge.id}
              d={workflowGraphEdgePath(edge)}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              markerEnd={`url(#${markerId})`}
              className="text-aegis-text-dim"
              data-work-item-edge={edge.id}
            />
          ))}
        </svg>
        {graph.nodes.map((node) => {
          const item = node.item;
          return (
            <article
              key={item.id}
              className="absolute overflow-hidden rounded-md border border-aegis-border bg-aegis-surface-solid px-2.5 py-2 shadow-sm"
              style={{
                width: WORKFLOW_GRAPH_NODE_WIDTH,
                height: WORKFLOW_GRAPH_NODE_HEIGHT,
                left: node.x,
                top: node.y,
              }}
              data-work-item-id={item.id}
              data-dependencies={item.dependencies.join(',')}
            >
              <div className="flex min-w-0 items-start gap-1.5">
                <span className="mt-0.5 shrink-0"><CollaborationWorkItemStatusIcon status={item.status} size={13} /></span>
                <div className="min-w-0">
                  <div className="line-clamp-2 break-words text-[11px] font-medium leading-4 text-aegis-text-secondary">{item.title}</div>
                  <div className="mt-0.5 truncate font-mono text-[9px] text-aegis-text-dim">{item.logicalId}</div>
                </div>
              </div>
              <div className="mt-2 flex min-w-0 items-center justify-between gap-2 text-[9.5px] text-aegis-text-muted">
                <span className="truncate">{collaborationWorkItemStatusLabel(item.status, text)}</span>
                <span className="truncate" title={item.assignedAgentId ?? undefined}>
                  <Bot size={10} className="me-0.5 inline" aria-hidden />
                  {item.assignedAgentId ?? text('collaboration.card.unassignedAgent', 'Unassigned')}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function WorkItemList({
  items,
  text,
}: {
  items: CollaborationWorkItemSnapshot[];
  text: CollaborationTranslate;
}) {
  return (
    <div role="table" aria-label={text('collaboration.details.listLabel', 'Work item list')} data-work-item-view="list">
      <div role="row" className="hidden grid-cols-[minmax(0,1fr)_120px_120px] gap-3 border-b border-aegis-border px-2 pb-1.5 text-[10px] font-medium text-aegis-text-dim sm:grid">
        <span role="columnheader">{text('collaboration.details.workItem', 'Work item')}</span>
        <span role="columnheader">{text('collaboration.details.agent', 'Agent')}</span>
        <span role="columnheader">{text('collaboration.details.state', 'State')}</span>
      </div>
      {items.map((item) => (
        <div key={item.id} role="row" className="grid min-w-0 grid-cols-[18px_minmax(0,1fr)] gap-x-2 border-b border-aegis-border px-2 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_120px_120px] sm:gap-3">
          <span className="sm:hidden"><CollaborationWorkItemStatusIcon status={item.status} size={13} /></span>
          <div role="cell" className="min-w-0">
            <div className="break-words text-[11.5px] font-medium text-aegis-text-secondary">{item.title}</div>
            {item.dependencies.length > 0 && (
              <div className="mt-0.5 truncate text-[10px] text-aegis-text-dim">
                {text('collaboration.details.dependencies', 'Dependencies')}: {item.dependencies.join(', ')}
              </div>
            )}
          </div>
          <div role="cell" className="col-start-2 min-w-0 truncate text-[10.5px] text-aegis-text-muted sm:col-start-auto sm:self-center">
            {item.assignedAgentId ?? text('collaboration.card.unassignedAgent', 'Unassigned')}
          </div>
          <div role="cell" className="col-start-2 flex min-w-0 items-center gap-1.5 text-[10.5px] text-aegis-text-muted sm:col-start-auto sm:self-center">
            <span className="hidden sm:inline"><CollaborationWorkItemStatusIcon status={item.status} size={12} /></span>
            <span className="truncate">{collaborationWorkItemStatusLabel(item.status, text)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function attemptStatusLabel(status: CollaborationAttemptSnapshot['status'], text: CollaborationTranslate): string {
  return text(`collaboration.attemptStatus.${status}`, status.replaceAll('_', ' '));
}

function Attempts({
  attempts,
  items,
  text,
  locale,
}: {
  attempts: CollaborationAttemptSnapshot[];
  items: CollaborationWorkItemSnapshot[];
  text: CollaborationTranslate;
  locale?: string;
}) {
  const titlesById = new Map(items.flatMap((item) => [[item.id, item.title], [item.logicalId, item.title]]));
  return (
    <div role="list" className="space-y-0">
      {attempts.map((attempt) => {
        const duration = formatDuration(attempt.startedAt, attempt.endedAt);
        return (
          <div key={attempt.id} role="listitem" className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-aegis-border py-2.5 last:border-b-0">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-aegis-text-secondary">
                <span className="font-medium">{text(`collaboration.attemptKind.${attempt.kind}`, attempt.kind)}</span>
                <span className="font-mono text-[10px] text-aegis-text-dim">#{attempt.attemptNo}</span>
                <span className="truncate text-aegis-text-muted">{attempt.workerAgentId}</span>
              </div>
              <div className="mt-1 truncate text-[10px] text-aegis-text-dim">
                {attempt.workItemId
                  ? titlesById.get(attempt.workItemId) ?? attempt.workItemId
                  : text('collaboration.details.runLevelAttempt', 'Run-level attempt')}
              </div>
              <CollaborationAttemptIdentity
                attempt={attempt}
                translate={text}
                className="mt-2 border-t border-aegis-border/70 pt-1.5"
              />
              {attempt.lastError && (
                <div className="mt-1.5 break-words rounded-md bg-aegis-danger/[0.06] px-2 py-1 text-[10px] text-aegis-danger">
                  {attempt.lastError}
                </div>
              )}
            </div>
            <div className="text-end">
              <div className="text-[10.5px] font-medium text-aegis-text-muted">{attemptStatusLabel(attempt.status, text)}</div>
              <div className="mt-1 whitespace-nowrap font-mono text-[9.5px] tabular-nums text-aegis-text-dim" title={formatDateTime(attempt.startedAt, locale)}>
                {duration ?? formatDateTime(attempt.startedAt, locale)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EvidenceList({ evidence, text }: { evidence: Array<Record<string, unknown>>; text: CollaborationTranslate }) {
  return (
    <div role="list">
      {evidence.map((record, index) => {
        const title = readString(record, 'title', 'name') ?? text('collaboration.details.untitledEvidence', 'Untitled evidence');
        const type = readString(record, 'type', 'evidence_type');
        const reference = readString(record, 'reference', 'uri', 'path');
        const verification = readString(record, 'verification', 'verified_by');
        const warning = readString(record, 'warning');
        return (
          <div key={readString(record, 'id') ?? `${title}-${index}`} role="listitem" className="border-b border-aegis-border py-2.5 last:border-b-0">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="break-words text-[11.5px] font-medium text-aegis-text-secondary">{title}</span>
              {type && <span className="text-[10px] text-aegis-text-dim">{type}</span>}
            </div>
            {reference && <div className="mt-1 break-all font-mono text-[10px] text-aegis-primary">{reference}</div>}
            {verification && <div className="mt-1 break-words text-[10px] text-aegis-text-muted">{verification}</div>}
            {warning && (
              <div className="mt-1.5 flex items-start gap-1.5 rounded-md bg-aegis-warning/[0.07] px-2 py-1 text-[10px] text-aegis-warning">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden />
                <span className="break-words">{warning}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Interventions({
  interventions,
  text,
  locale,
}: {
  interventions: CollaborationInterventionSnapshot[];
  text: CollaborationTranslate;
  locale?: string;
}) {
  const sorted = [...interventions].sort((left, right) => Number(Boolean(left.resolvedAt)) - Number(Boolean(right.resolvedAt)) || right.createdAt - left.createdAt);
  return (
    <div role="list">
      {sorted.map((intervention) => {
        const resolved = Boolean(intervention.resolvedAt);
        return (
          <div key={intervention.id} role="listitem" className="border-b border-aegis-border py-2.5 last:border-b-0">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {resolved
                  ? <CheckCircle2 size={13} className="shrink-0 text-aegis-success" aria-hidden />
                  : <ShieldAlert size={13} className="shrink-0 text-aegis-warning" aria-hidden />}
                <span className="min-w-0 truncate font-mono text-[10.5px] font-medium text-aegis-text-secondary">{intervention.code}</span>
              </div>
              <span className={cn('text-[10px]', resolved ? 'text-aegis-success' : 'text-aegis-warning')}>
                {resolved
                  ? text('collaboration.details.resolved', 'Resolved')
                  : text('collaboration.details.actionRequired', 'Action required')}
              </span>
            </div>
            <div className="mt-1.5 break-words text-[11px] text-aegis-text-muted">{intervention.requiredAction}</div>
            <div className="mt-1 text-[9.5px] text-aegis-text-dim">
              {formatDateTime(intervention.createdAt, locale)}
            </div>
            {primitiveEntries(intervention.diagnostics).length > 0 && (
              <dl className="mt-2 grid min-w-0 grid-cols-1 gap-x-3 gap-y-1 text-[9.5px] sm:grid-cols-2">
                {primitiveEntries(intervention.diagnostics).map(([key, value]) => (
                  <div key={key} className="flex min-w-0 gap-1.5">
                    <dt className="shrink-0 text-aegis-text-dim">{key}</dt>
                    <dd className="min-w-0 truncate text-aegis-text-muted" title={value}>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        );
      })}
    </div>
  );
}

function deliveryStatusLabel(status: string, text: CollaborationTranslate): string {
  return text(`collaboration.deliveryStatus.${status}`, status.replaceAll('_', ' '));
}

function Deliveries({ deliveries, text }: { deliveries: CollaborationDeliverySnapshot[]; text: CollaborationTranslate }) {
  return (
    <div role="list">
      {deliveries.map((delivery) => (
        <div key={delivery.id} role="listitem" className="border-b border-aegis-border py-2.5 last:border-b-0">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span className="text-[11.5px] font-medium text-aegis-text-secondary">{deliveryStatusLabel(delivery.status, text)}</span>
            <span className="font-mono text-[10px] tabular-nums text-aegis-text-dim">
              {text('collaboration.details.targetRevision', 'Target revision {{revision}}', { revision: delivery.targetRevision })}
            </span>
          </div>
          <dl className="mt-2 grid min-w-0 grid-cols-1 gap-x-4 gap-y-1.5 text-[10px] sm:grid-cols-2">
            <div className="flex min-w-0 justify-between gap-2">
              <dt className="text-aegis-text-dim">{text('collaboration.details.transcript', 'Transcript')}</dt>
              <dd className="truncate text-aegis-text-muted">{text(`collaboration.transcriptStatus.${delivery.transcriptStatus}`, delivery.transcriptStatus)}</dd>
            </div>
            <div className="flex min-w-0 justify-between gap-2">
              <dt className="text-aegis-text-dim">{text('collaboration.details.channel', 'Channel')}</dt>
              <dd className="truncate text-aegis-text-muted">{text(`collaboration.channelStatus.${delivery.channelStatus}`, delivery.channelStatus)}</dd>
            </div>
            {primitiveEntries(delivery.target, 4).map(([key, value]) => (
              <div key={key} className="flex min-w-0 justify-between gap-2">
                <dt className="shrink-0 text-aegis-text-dim">{key}</dt>
                <dd className="min-w-0 truncate font-mono text-aegis-text-muted" title={value}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function AuditTimeline({
  events,
  text,
  locale,
}: {
  events: CollaborationEvent[];
  text: CollaborationTranslate;
  locale?: string;
}) {
  const ordered = [...events].sort((left, right) => right.sequence - left.sequence);
  return (
    <ol aria-label={text('collaboration.details.auditTimeline', 'Audit timeline')}>
      {ordered.map((event) => (
        <li key={`${event.runId}-${event.sequence}`} className="grid min-w-0 grid-cols-[54px_minmax(0,1fr)] gap-2 border-b border-aegis-border py-2.5 last:border-b-0">
          <span className="font-mono text-[9.5px] tabular-nums text-aegis-text-dim">#{event.sequence}</span>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className="break-words font-mono text-[10.5px] font-medium text-aegis-text-secondary">{event.eventType}</span>
              <span className="whitespace-nowrap text-[9.5px] text-aegis-text-dim">{formatDateTime(event.createdAt, locale)}</span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[9.5px] text-aegis-text-dim">
              <span>{text('collaboration.details.revision', 'Revision')} {event.runRevision}</span>
              {event.entityType && <span>{event.entityType}{event.entityId ? `: ${event.entityId}` : ''}</span>}
            </div>
            {primitiveEntries(event.payload, 3).length > 0 && (
              <div className="mt-1.5 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[9.5px] text-aegis-text-muted">
                {primitiveEntries(event.payload, 3).map(([key, value]) => (
                  <span key={key} className="max-w-full truncate" title={`${key}: ${value}`}>{key}: {value}</span>
                ))}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function PlanHistory({ plans, text, locale }: { plans: Array<Record<string, unknown>>; text: CollaborationTranslate; locale?: string }) {
  return (
    <div role="list">
      {plans.map((plan, index) => {
        const id = readString(plan, 'id', 'planRevisionId', 'plan_revision_id') ?? `plan-${index + 1}`;
        const revision = readString(plan, 'revisionNo', 'revision_no', 'revision') ?? String(index + 1);
        const actor = readString(plan, 'approvedBy', 'approved_by', 'createdBy', 'created_by', 'actor');
        const timestamp = Number(plan.approvedAt ?? plan.approved_at ?? plan.createdAt ?? plan.created_at ?? 0);
        return (
          <div key={id} role="listitem" className="flex min-w-0 items-start justify-between gap-3 border-b border-aegis-border py-2 last:border-b-0">
            <div className="min-w-0">
              <div className="font-mono text-[10.5px] font-medium text-aegis-text-secondary">
                {text('collaboration.details.planRevision', 'Plan revision {{revision}}', { revision })}
              </div>
              {actor && <div className="mt-0.5 truncate text-[10px] text-aegis-text-muted">{actor}</div>}
            </div>
            <span className="shrink-0 text-[9.5px] text-aegis-text-dim">{formatDateTime(timestamp, locale)}</span>
          </div>
        );
      })}
    </div>
  );
}

function decisionLabel(decisionType: string, text: CollaborationTranslate): string {
  const labels: Record<string, string> = {
    PLAN_APPROVED: 'Plan approved',
    WORKFLOW_TEMPLATE_CREATED: 'Template saved',
    WORKFLOW_TEMPLATE_INSTANTIATED: 'Template instantiated',
  };
  return text(`collaboration.decision.${decisionType}`, labels[decisionType] ?? decisionType.replaceAll('_', ' '));
}

function Decisions({
  decisions,
  text,
  locale,
}: {
  decisions: Array<Record<string, unknown>>;
  text: CollaborationTranslate;
  locale?: string;
}) {
  const ordered = [...decisions].sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0));
  return (
    <div role="list">
      {ordered.map((decision, index) => {
        const id = readString(decision, 'id') ?? `decision-${index}`;
        const decisionType = readString(decision, 'decisionType') ?? 'UNKNOWN';
        const actor = readString(decision, 'actor');
        const payload = decision.payload && typeof decision.payload === 'object' && !Array.isArray(decision.payload)
          ? decision.payload as Record<string, unknown>
          : undefined;
        const assignments = payload?.assignments && typeof payload.assignments === 'object' && !Array.isArray(payload.assignments)
          ? Object.entries(payload.assignments as Record<string, unknown>)
            .filter(([, agentId]) => typeof agentId === 'string' && agentId.trim())
            .map(([logicalId, agentId]) => `${logicalId}: ${agentId}`)
          : [];
        return (
          <div key={id} role="listitem" className="border-b border-aegis-border py-2.5 last:border-b-0">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className="break-words text-[11px] font-medium text-aegis-text-secondary">
                {decisionLabel(decisionType, text)}
              </span>
              <span className="shrink-0 text-[9.5px] text-aegis-text-dim">
                {formatDateTime(Number(decision.createdAt ?? 0), locale)}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[10px] text-aegis-text-muted">
              {actor && <span>{actor}</span>}
              {assignments.length > 0 && <span className="break-words font-mono">{assignments.join(', ')}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WorkflowTemplateSource({
  link,
  text,
  locale,
}: {
  link: NonNullable<CollaborationRunSnapshot['workflowTemplate']>;
  text: CollaborationTranslate;
  locale?: string;
}) {
  return (
    <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 text-[10.5px] sm:grid-cols-2">
      <div className="min-w-0 sm:col-span-2">
        <dt className="text-aegis-text-dim">{text('collaboration.details.template', 'Template')}</dt>
        <dd className="mt-0.5 break-words text-aegis-text-muted">{link.templateName}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-aegis-text-dim">{text('collaboration.details.templateVersion', 'Version')}</dt>
        <dd className="mt-0.5 font-mono text-aegis-text-muted">v{link.templateVersionNo}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-aegis-text-dim">{text('collaboration.details.instantiated', 'Instantiated')}</dt>
        <dd className="mt-0.5 text-aegis-text-muted">{formatDateTime(link.instantiatedAt, locale)}</dd>
      </div>
      <div className="min-w-0 sm:col-span-2">
        <dt className="text-aegis-text-dim">{text('collaboration.details.templateDigest', 'Template digest')}</dt>
        <dd className="mt-0.5 break-all font-mono text-[9.5px] text-aegis-text-muted">{link.templateDigest}</dd>
      </div>
    </dl>
  );
}

export function CollaborationDetails({
  snapshot,
  events = [],
  eventTimelineComplete,
  eventTimelineIncompleteReason,
  loading = false,
  error,
  workItemView,
  defaultWorkItemView = 'graph',
  pendingAction,
  disabledActions,
  translate,
  locale,
  onWorkItemViewChange,
  onAction,
  onRetry,
  className,
}: CollaborationDetailsProps) {
  const text = useCollaborationText(translate);
  const [internalView, setInternalView] = useState<CollaborationWorkItemView>(defaultWorkItemView);
  const activeView = workItemView ?? internalView;
  const sortedEvents = useMemo(() => [...events].sort((left, right) => left.sequence - right.sequence), [events]);
  const residualExecutionRisk = snapshot != null && hasUnresolvedResidualExecutionRisk(snapshot);

  const changeView = (view: CollaborationWorkItemView) => {
    if (workItemView === undefined) setInternalView(view);
    onWorkItemViewChange?.(view);
  };

  if (loading && !snapshot) {
    return (
      <div className={cn('w-full bg-aegis-bg p-5', className)} aria-busy="true" aria-label={text('collaboration.details.loading', 'Loading collaboration details')}>
        <div className="h-4 w-44 rounded-sm bg-[rgb(var(--aegis-overlay)/0.08)]" />
        <div className="mt-3 h-3 w-3/4 rounded-sm bg-[rgb(var(--aegis-overlay)/0.07)]" />
        <div className="mt-6 space-y-2">
          {[0, 1, 2].map((index) => <div key={index} className="h-10 rounded-md bg-[rgb(var(--aegis-overlay)/0.05)]" />)}
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className={cn('flex min-h-[220px] w-full flex-col items-center justify-center gap-3 bg-aegis-bg p-6 text-center', className)} role={error ? 'alert' : undefined}>
        <AlertTriangle size={24} className={error ? 'text-aegis-danger' : 'text-aegis-text-dim'} aria-hidden />
        <div className="max-w-[54ch] break-words text-[12px] text-aegis-text-muted">
          {error ?? text('collaboration.details.unavailable', 'Collaboration details are not available.')}
        </div>
        {onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-aegis-border px-2.5 py-1 text-[11px] font-medium text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.05)]">
            <RefreshCw size={13} aria-hidden />
            {text('collaboration.common.retry', 'Retry')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('w-full min-w-0 bg-aegis-bg text-aegis-text', className)} data-collaboration-details={snapshot.runId}>
      {error && (
        <div role="alert" className="m-3 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-aegis-danger/20 bg-aegis-danger/[0.06] px-3 py-2 text-[10.5px] text-aegis-danger sm:mx-5">
          <span className="min-w-0 break-words">{error}</span>
          {onRetry && (
            <button type="button" onClick={onRetry} className="inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 font-medium hover:bg-aegis-danger/[0.08]">
              <RefreshCw size={12} aria-hidden />
              {text('collaboration.common.retry', 'Retry')}
            </button>
          )}
        </div>
      )}
      <header className="px-4 py-4 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2 text-[11px] text-aegis-text-muted">
              <CollaborationRunStatusIcon status={snapshot.status} size={14} />
              <span>{collaborationRunStatusLabel(snapshot.status, text)}</span>
              <span className="font-mono text-[9.5px] text-aegis-text-dim">{snapshot.runId}</span>
            </div>
            <h2 className="mt-1.5 break-words text-[15px] font-semibold leading-5 text-aegis-text">
              {snapshot.goal || text('collaboration.card.untitled', 'Untitled collaboration')}
            </h2>
            <div className="mt-1 text-[10px] text-aegis-text-dim">
              {text('collaboration.details.updated', 'Updated {{time}}', { time: formatDateTime(snapshot.updatedAt, locale) })}
            </div>
          </div>
          <div className="shrink-0 text-end">
            <div className="font-mono text-[11px] tabular-nums text-aegis-text-secondary">
              {text('collaboration.details.revisionValue', 'Revision {{revision}}', { revision: snapshot.revision })}
            </div>
            <div className="mt-0.5 text-[9.5px] text-aegis-text-dim">{snapshot.dispatchState}</div>
          </div>
        </div>
        {residualExecutionRisk && (
          <CollaborationResidualExecutionRiskNotice text={text} className="mt-3" />
        )}
        <CollaborationActionBar
          run={snapshot}
          translate={translate}
          onAction={onAction}
          pendingAction={pendingAction}
          disabledActions={disabledActions}
          className="mt-3"
        />
      </header>

      <DetailSection title={text('collaboration.details.workGraph', 'Work graph')} icon={<Network size={14} />} count={snapshot.workItems.length}>
        <div className="mb-3 inline-flex rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.025)] p-0.5" role="group" aria-label={text('collaboration.details.viewMode', 'Work item view')}>
          <button
            type="button"
            onClick={() => changeView('graph')}
            aria-pressed={activeView === 'graph'}
            className={cn('inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap rounded-sm px-2 py-1 text-[10.5px]', activeView === 'graph' ? 'bg-aegis-elevated-solid text-aegis-text' : 'text-aegis-text-muted hover:text-aegis-text-secondary')}
          >
            <Network size={12} aria-hidden />
            {text('collaboration.details.graph', 'Graph')}
          </button>
          <button
            type="button"
            onClick={() => changeView('list')}
            aria-pressed={activeView === 'list'}
            className={cn('inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap rounded-sm px-2 py-1 text-[10.5px]', activeView === 'list' ? 'bg-aegis-elevated-solid text-aegis-text' : 'text-aegis-text-muted hover:text-aegis-text-secondary')}
          >
            <List size={12} aria-hidden />
            {text('collaboration.details.list', 'List')}
          </button>
        </div>
        {snapshot.workItems.length === 0
          ? <EmptySection>{text('collaboration.details.noWorkItems', 'No work items recorded.')}</EmptySection>
          : activeView === 'graph'
            ? <WorkItemGraph items={snapshot.workItems} text={text} />
            : <WorkItemList items={snapshot.workItems} text={text} />}
      </DetailSection>

      {snapshot.planRevisions && snapshot.planRevisions.length > 0 && (
        <DetailSection title={text('collaboration.details.planHistory', 'Plan history')} icon={<GitFork size={14} />} count={snapshot.planRevisions.length}>
          <PlanHistory plans={snapshot.planRevisions} text={text} locale={locale} />
        </DetailSection>
      )}

      {snapshot.workflowTemplate && (
        <DetailSection title={text('collaboration.details.templateSource', 'Template source')} icon={<Library size={14} />}>
          <WorkflowTemplateSource link={snapshot.workflowTemplate} text={text} locale={locale} />
        </DetailSection>
      )}

      {snapshot.decisions && snapshot.decisions.length > 0 && (
        <DetailSection title={text('collaboration.details.approvalHistory', 'Approval history')} icon={<CheckCircle2 size={14} />} count={snapshot.decisions.length}>
          <Decisions decisions={snapshot.decisions} text={text} locale={locale} />
        </DetailSection>
      )}

      <DetailSection title={text('collaboration.details.attempts', 'Attempts')} icon={<Bot size={14} />} count={snapshot.attempts.length}>
        {snapshot.attempts.length === 0
          ? <EmptySection>{text('collaboration.details.noAttempts', 'No attempts recorded.')}</EmptySection>
          : <Attempts attempts={snapshot.attempts} items={snapshot.workItems} text={text} locale={locale} />}
      </DetailSection>

      <DetailSection title={text('collaboration.details.evidence', 'Evidence')} icon={<FileCheck2 size={14} />} count={snapshot.evidence?.length ?? 0}>
        {!snapshot.evidence || snapshot.evidence.length === 0
          ? <EmptySection>{text('collaboration.details.noEvidence', 'No evidence recorded.')}</EmptySection>
          : <EvidenceList evidence={snapshot.evidence} text={text} />}
      </DetailSection>

      <DetailSection title={text('collaboration.details.interventions', 'Interventions')} icon={<ShieldAlert size={14} />} count={snapshot.interventions.length}>
        {snapshot.interventions.length === 0
          ? <EmptySection>{text('collaboration.details.noInterventions', 'No interventions recorded.')}</EmptySection>
          : <Interventions interventions={snapshot.interventions} text={text} locale={locale} />}
      </DetailSection>

      <DetailSection title={text('collaboration.details.delivery', 'Delivery')} icon={<Send size={14} />} count={snapshot.deliveries.length}>
        {snapshot.deliveries.length === 0
          ? <EmptySection>{text('collaboration.details.noDeliveries', 'No delivery attempts recorded.')}</EmptySection>
          : <Deliveries deliveries={snapshot.deliveries} text={text} />}
      </DetailSection>

      {snapshot.finalArtifact && primitiveEntries(snapshot.finalArtifact, 8).length > 0 && (
        <DetailSection title={text('collaboration.details.finalResult', 'Final result')} icon={<CheckCircle2 size={14} />}>
          <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 text-[10.5px] sm:grid-cols-2">
            {primitiveEntries(snapshot.finalArtifact, 8).map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="text-aegis-text-dim">{key}</dt>
                <dd className="mt-0.5 break-words text-aegis-text-muted">{value}</dd>
              </div>
            ))}
          </dl>
        </DetailSection>
      )}

      <DetailSection title={text('collaboration.details.auditTimeline', 'Audit timeline')} icon={<History size={14} />} count={sortedEvents.length}>
        {eventTimelineComplete === false && (
          <div role="status" className="mb-3 rounded-md border border-aegis-warning/25 bg-aegis-warning/[0.06] px-3 py-2.5 text-[10.5px] leading-4 text-aegis-text-muted">
            <div className="flex items-start gap-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-aegis-warning" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-aegis-warning">
                  {text('collaboration.details.timelineIncomplete', 'Audit timeline is incomplete')}
                </div>
                <p className="mt-0.5">
                  {text(
                    'collaboration.details.timelineIncompleteMessage',
                    'Some audit events are not available in this view. Refresh to confirm the latest authoritative run state.',
                  )}
                </p>
                {eventTimelineIncompleteReason && (
                  <code className="mt-1 block break-all font-mono text-[9.5px] text-aegis-text-dim">
                    {text('collaboration.details.timelineIncompleteReason', 'Reason')}: {eventTimelineIncompleteReason}
                  </code>
                )}
              </div>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium text-aegis-warning hover:bg-aegis-warning/[0.08]"
                >
                  <RefreshCw size={11} aria-hidden />
                  {text('collaboration.common.retry', 'Retry')}
                </button>
              )}
            </div>
          </div>
        )}
        {sortedEvents.length === 0
          ? <EmptySection>{text('collaboration.details.noEvents', 'No audit events loaded.')}</EmptySection>
          : <AuditTimeline events={sortedEvents} text={text} locale={locale} />}
      </DetailSection>
    </div>
  );
}
