import {
  Archive,
  ArchiveRestore,
  Ban,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleDashed,
  CircleX,
  Clock3,
  Copy,
  Download,
  GitFork,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  RotateCw,
  Send,
  Trash2,
  UserRoundCog,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { hasUnresolvedResidualExecutionRisk } from '@/services/collaboration/types';
import type {
  CollaborationRunSnapshot,
  CollaborationRunStatus,
  CollaborationRunSummary,
  CollaborationWorkItemSnapshot,
  CollaborationWorkItemStatus,
} from '@/services/collaboration/types';

export type CollaborationTranslate = (
  key: string,
  fallback: string,
  values?: Record<string, string | number>,
) => string;

type IconComponent = LucideIcon;

interface StatusPresentation {
  icon: IconComponent;
  tone: string;
  surface: string;
}

const RUN_STATUS_PRESENTATION: Record<CollaborationRunStatus, StatusPresentation> = {
  DRAFT: { icon: CircleDashed, tone: 'text-aegis-text-muted', surface: 'bg-[rgb(var(--aegis-overlay)/0.04)]' },
  PLANNING: { icon: GitFork, tone: 'text-aegis-primary', surface: 'bg-aegis-primary/[0.08]' },
  AWAITING_APPROVAL: { icon: Clock3, tone: 'text-aegis-warning', surface: 'bg-aegis-warning/[0.08]' },
  PROVISIONING: { icon: CircleDashed, tone: 'text-aegis-primary', surface: 'bg-aegis-primary/[0.08]' },
  RUNNING: { icon: Play, tone: 'text-aegis-primary', surface: 'bg-aegis-primary/[0.08]' },
  AWAITING_INTERVENTION: { icon: CircleAlert, tone: 'text-aegis-warning', surface: 'bg-aegis-warning/[0.08]' },
  SYNTHESIZING: { icon: GitFork, tone: 'text-aegis-primary', surface: 'bg-aegis-primary/[0.08]' },
  FINALIZING: { icon: Send, tone: 'text-aegis-primary', surface: 'bg-aegis-primary/[0.08]' },
  DELIVERY_PENDING: { icon: CircleAlert, tone: 'text-aegis-warning', surface: 'bg-aegis-warning/[0.08]' },
  COMPLETED: { icon: CheckCircle2, tone: 'text-aegis-success', surface: 'bg-aegis-success/[0.08]' },
  CANCELLING: { icon: Clock3, tone: 'text-aegis-warning', surface: 'bg-aegis-warning/[0.08]' },
  CANCELLED: { icon: Ban, tone: 'text-aegis-text-dim', surface: 'bg-[rgb(var(--aegis-overlay)/0.04)]' },
  FAILED: { icon: CircleX, tone: 'text-aegis-danger', surface: 'bg-aegis-danger/[0.08]' },
};

const WORK_ITEM_STATUS_PRESENTATION: Record<CollaborationWorkItemStatus, StatusPresentation> = {
  PLANNED: { icon: CircleDashed, tone: 'text-aegis-text-dim', surface: '' },
  BLOCKED: { icon: Ban, tone: 'text-aegis-text-dim', surface: '' },
  READY: { icon: Circle, tone: 'text-aegis-primary', surface: '' },
  DISPATCHING: { icon: Send, tone: 'text-aegis-primary', surface: '' },
  RUNNING: { icon: Play, tone: 'text-aegis-primary', surface: '' },
  SUCCEEDED: { icon: CheckCircle2, tone: 'text-aegis-success', surface: '' },
  NEEDS_INTERVENTION: { icon: CircleAlert, tone: 'text-aegis-warning', surface: '' },
  CANCELLING: { icon: Clock3, tone: 'text-aegis-warning', surface: '' },
  CANCELLED: { icon: Ban, tone: 'text-aegis-text-dim', surface: '' },
  WAIVED: { icon: Check, tone: 'text-aegis-text-muted', surface: '' },
};

const ACTION_DEFINITIONS: Record<string, { fallback: string; icon: IconComponent; intent: 'primary' | 'neutral' | 'danger' }> = {
  PLAN_REVISE: { fallback: 'Revise plan', icon: Pencil, intent: 'neutral' },
  PLAN_APPROVE: { fallback: 'Start', icon: Play, intent: 'primary' },
  CANCEL: { fallback: 'Cancel', icon: CircleX, intent: 'danger' },
  DISPATCH_STOP: { fallback: 'Stop dispatch', icon: Pause, intent: 'neutral' },
  DISPATCH_RESUME: { fallback: 'Resume dispatch', icon: Play, intent: 'primary' },
  WORK_ITEM_INPUT_APPEND: { fallback: 'Add input', icon: MessageSquarePlus, intent: 'neutral' },
  WORK_ITEM_CANCEL: { fallback: 'Cancel work item', icon: Ban, intent: 'danger' },
  WORK_ITEM_RETRY: { fallback: 'Retry work', icon: RotateCw, intent: 'primary' },
  WORK_ITEM_REASSIGN: { fallback: 'Reassign', icon: UserRoundCog, intent: 'neutral' },
  PARTIAL: { fallback: 'Accept partial', icon: Check, intent: 'neutral' },
  RECONCILE: { fallback: 'Reconcile', icon: RefreshCw, intent: 'primary' },
  DELIVERY_RETRY: { fallback: 'Retry delivery', icon: RotateCw, intent: 'primary' },
  DELIVERY_RETARGET: { fallback: 'Change target', icon: Send, intent: 'neutral' },
  DELIVERY_ABANDON: { fallback: 'Abandon delivery', icon: Ban, intent: 'danger' },
  EXPORT: { fallback: 'Export', icon: Download, intent: 'neutral' },
  CLONE: { fallback: 'Clone', icon: Copy, intent: 'neutral' },
  ARCHIVE: { fallback: 'Archive', icon: Archive, intent: 'neutral' },
  UNARCHIVE: { fallback: 'Unarchive', icon: ArchiveRestore, intent: 'neutral' },
  DELETE: { fallback: 'Delete', icon: Trash2, intent: 'danger' },
};

function humanize(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function useCollaborationText(translate?: CollaborationTranslate): CollaborationTranslate {
  const { t } = useTranslation();
  return (key, fallback, values = {}) => {
    if (translate) return translate(key, fallback, values);
    return String(t(key, { defaultValue: fallback, ...values }));
  };
}

export function collaborationRunStatusLabel(
  status: CollaborationRunStatus,
  text: CollaborationTranslate,
): string {
  return text(`collaboration.status.${status}`, humanize(status));
}

export function collaborationWorkItemStatusLabel(
  status: CollaborationWorkItemStatus,
  text: CollaborationTranslate,
): string {
  return text(`collaboration.workItemStatus.${status}`, humanize(status));
}

export function CollaborationRunStatusIcon({
  status,
  size = 15,
  className,
}: {
  status: CollaborationRunStatus;
  size?: number;
  className?: string;
}) {
  const presentation = RUN_STATUS_PRESENTATION[status];
  const Icon = presentation.icon;
  return <Icon size={size} className={cn(presentation.tone, className)} aria-hidden />;
}

export function CollaborationWorkItemStatusIcon({
  status,
  size = 14,
}: {
  status: CollaborationWorkItemStatus;
  size?: number;
}) {
  const presentation = WORK_ITEM_STATUS_PRESENTATION[status];
  const Icon = presentation.icon;
  return <Icon size={size} className={presentation.tone} aria-hidden />;
}

export function CollaborationResidualExecutionRiskNotice({
  text,
  compact = false,
  className,
}: {
  text: CollaborationTranslate;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      data-collaboration-residual-execution-risk="true"
      className={cn(
        'flex min-w-0 items-start gap-2 rounded-md border-s-2 border-aegis-warning/60 bg-aegis-warning/[0.07] px-2.5 py-2 text-[10.5px] leading-4',
        className,
      )}
    >
      <CircleAlert size={13} className="mt-0.5 shrink-0 text-aegis-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="break-words font-semibold text-aegis-warning">
          {text(
            'collaboration.residualExecutionRisk.title',
            'Cancelled locally; OpenClaw Task termination unconfirmed',
          )}
        </div>
        <p className="mt-0.5 break-words text-aegis-text-muted">
          {compact
            ? text(
                'collaboration.residualExecutionRisk.summary',
                'JunQi closed this run locally, but the OpenClaw Task may still finish or cause side effects. Keep this audit record.',
              )
            : text(
                'collaboration.residualExecutionRisk.details',
                'JunQi cancelled and closed this run locally. OpenClaw Task termination is unconfirmed; external work or side effects may continue. Automatic retention and deletion remain blocked to preserve this audit trail.',
              )}
        </p>
      </div>
    </div>
  );
}

export interface CollaborationActionContext {
  runId: string;
  action: string;
  run: CollaborationRunSummary;
}

export interface CollaborationActionBarProps {
  run: CollaborationRunSummary;
  onAction?: (context: CollaborationActionContext) => void;
  translate?: CollaborationTranslate;
  pendingAction?: string | null;
  disabledActions?: readonly string[];
  className?: string;
}

export function CollaborationActionBar({
  run,
  onAction,
  translate,
  pendingAction,
  disabledActions = [],
  className,
}: CollaborationActionBarProps) {
  const text = useCollaborationText(translate);
  if (run.allowedActions.length === 0) return null;

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)} aria-label={text('collaboration.card.actions', 'Run actions')}>
      {run.allowedActions.map((action) => {
        const definition = ACTION_DEFINITIONS[action] ?? {
          fallback: humanize(action),
          icon: MoreHorizontal,
          intent: 'neutral' as const,
        };
        const Icon = definition.icon;
        const pending = pendingAction === action;
        const disabled = !onAction || Boolean(pendingAction) || disabledActions.includes(action);
        return (
          <button
            key={action}
            type="button"
            data-collaboration-action={action}
            onClick={() => onAction?.({ runId: run.runId, action, run })}
            disabled={disabled}
            aria-busy={pending || undefined}
            className={cn(
              'inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
              'focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45',
              definition.intent === 'primary' && 'border-aegis-primary/35 bg-aegis-primary/[0.09] text-aegis-primary hover:bg-aegis-primary/[0.15]',
              definition.intent === 'danger' && 'border-aegis-danger/30 bg-aegis-danger/[0.06] text-aegis-danger hover:bg-aegis-danger/[0.11]',
              definition.intent === 'neutral' && 'border-aegis-border bg-[rgb(var(--aegis-overlay)/0.025)] text-aegis-text-secondary hover:border-aegis-border-hover hover:bg-[rgb(var(--aegis-overlay)/0.06)]',
            )}
          >
            {pending ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Icon size={13} aria-hidden />}
            <span>{text(`collaboration.actions.${action}`, definition.fallback)}</span>
          </button>
        );
      })}
    </div>
  );
}

function progressFor(items: CollaborationWorkItemSnapshot[]): { completed: number; total: number } {
  return {
    completed: items.filter((item) => item.status === 'SUCCEEDED' || item.status === 'WAIVED').length,
    total: items.length,
  };
}

export interface CollaborationCardProps {
  run: CollaborationRunSummary;
  snapshot?: CollaborationRunSnapshot | null;
  loading?: boolean;
  error?: string | null;
  maxVisibleWorkItems?: number;
  pendingAction?: string | null;
  disabledActions?: readonly string[];
  translate?: CollaborationTranslate;
  onAction?: (context: CollaborationActionContext) => void;
  onOpenDetails?: (runId: string) => void;
  onRetry?: (runId: string) => void;
  className?: string;
}

export function CollaborationCard({
  run,
  snapshot,
  loading = false,
  error,
  maxVisibleWorkItems = 4,
  pendingAction,
  disabledActions,
  translate,
  onAction,
  onOpenDetails,
  onRetry,
  className,
}: CollaborationCardProps) {
  const text = useCollaborationText(translate);
  const presentation = RUN_STATUS_PRESENTATION[run.status];
  const items = snapshot?.workItems ?? [];
  const progress = progressFor(items);
  const visibleItems = items.slice(0, Math.max(0, maxVisibleWorkItems));
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  const residualExecutionRisk = snapshot != null && hasUnresolvedResidualExecutionRisk({
    status: run.status,
    interventions: snapshot.interventions,
  });

  return (
    <article
      className={cn(
        'w-full overflow-hidden rounded-lg border border-aegis-border bg-aegis-surface-solid text-aegis-text',
        className,
      )}
      aria-label={text('collaboration.card.ariaLabel', 'Collaboration run: {{goal}}', { goal: run.goal })}
      data-collaboration-run-id={run.runId}
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-2 border-b border-aegis-border px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-aegis-text-muted">
            <GitFork size={13} className="shrink-0" aria-hidden />
            <span className="font-medium">{text('collaboration.card.title', 'Collaboration run')}</span>
            <span aria-hidden className="text-aegis-text-dim">/</span>
            <span
              className={cn('inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5', presentation.tone, presentation.surface)}
              aria-live="polite"
            >
              <CollaborationRunStatusIcon status={run.status} size={12} />
              <span className="truncate">{collaborationRunStatusLabel(run.status, text)}</span>
            </span>
          </div>
          <h3 className="mt-1.5 line-clamp-2 text-[13px] font-semibold leading-5 text-aegis-text">
            {run.goal || text('collaboration.card.untitled', 'Untitled collaboration')}
          </h3>
        </div>
        <div className="shrink-0 text-end">
          <div className="font-mono text-[13px] font-semibold tabular-nums text-aegis-text-secondary">
            {progress.total > 0 ? `${progress.completed} / ${progress.total}` : '-'}
          </div>
          <div className="text-[10px] text-aegis-text-dim">{text('collaboration.card.completed', 'completed')}</div>
        </div>
      </header>

      <div className="px-3.5 py-2.5">
        {residualExecutionRisk && (
          <CollaborationResidualExecutionRiskNotice text={text} compact className="mb-2.5" />
        )}
        {loading && items.length === 0 ? (
          <div className="space-y-2" aria-label={text('collaboration.card.loading', 'Loading run details')} aria-busy="true">
            {[0, 1].map((index) => (
              <div key={index} className="flex items-center gap-2 py-1.5">
                <span className="h-3.5 w-3.5 rounded-sm bg-[rgb(var(--aegis-overlay)/0.08)]" />
                <span className="h-3 flex-1 rounded-sm bg-[rgb(var(--aegis-overlay)/0.08)]" />
                <span className="h-3 w-16 rounded-sm bg-[rgb(var(--aegis-overlay)/0.08)]" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md bg-aegis-danger/[0.06] px-2.5 py-2 text-[11px] text-aegis-danger">
            <span className="min-w-0 break-words">{error}</span>
            {onRetry && (
              <button type="button" onClick={() => onRetry(run.runId)} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 font-medium hover:bg-aegis-danger/[0.08]">
                <RotateCw size={12} aria-hidden />
                {text('collaboration.common.retry', 'Retry')}
              </button>
            )}
          </div>
        ) : visibleItems.length > 0 ? (
          <div role="list" aria-label={text('collaboration.card.workItems', 'Work items')}>
            {visibleItems.map((item) => (
              <div
                key={item.id}
                role="listitem"
                className="grid min-w-0 grid-cols-[18px_minmax(0,1fr)] gap-x-2 border-b border-aegis-border py-2 last:border-b-0 sm:grid-cols-[18px_minmax(0,1fr)_minmax(84px,auto)]"
              >
                <span className="pt-0.5"><CollaborationWorkItemStatusIcon status={item.status} /></span>
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium text-aegis-text-secondary" title={item.title}>{item.title}</div>
                  <div className="mt-0.5 text-[10px] text-aegis-text-dim">{collaborationWorkItemStatusLabel(item.status, text)}</div>
                </div>
                <div className="col-start-2 mt-1 min-w-0 truncate text-[10.5px] text-aegis-text-muted sm:col-start-3 sm:mt-0 sm:self-center sm:text-end" title={item.assignedAgentId ?? undefined}>
                  {item.assignedAgentId ?? text('collaboration.card.unassignedAgent', 'Unassigned')}
                </div>
              </div>
            ))}
            {hiddenCount > 0 && (
              <div className="pt-1.5 text-[10.5px] text-aegis-text-dim">
                {text('collaboration.card.moreItems', '{{count}} more work items', { count: hiddenCount })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 py-2 text-[11px] text-aegis-text-dim">
            <CircleDashed size={14} aria-hidden />
            <span>{text('collaboration.card.noWorkItems', 'The work plan is not available yet.')}</span>
          </div>
        )}
      </div>

      <footer className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-aegis-border px-3.5 py-2.5">
        <CollaborationActionBar
          run={run}
          translate={translate}
          onAction={onAction}
          pendingAction={pendingAction}
          disabledActions={disabledActions}
          className="flex-1"
        />
        {onOpenDetails && (
          <button
            type="button"
            onClick={() => onOpenDetails(run.runId)}
            className="ms-auto inline-flex min-h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.05)] hover:text-aegis-text"
          >
            <span>{text('collaboration.card.openDetails', 'Details')}</span>
            <ChevronRight size={13} className="rtl:rotate-180" aria-hidden />
          </button>
        )}
      </footer>
    </article>
  );
}
