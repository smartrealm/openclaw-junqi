import { useMemo } from 'react';
import {
  Archive,
  CircleDashed,
  GitFork,
  RefreshCw,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModalFocusScope } from '@/hooks/useModalFocusScope';
import { flowReconciliationAbandonmentAudit } from '@/services/collaboration/tombstoneAudit';
import type { CollaborationRunSummary, CollaborationTombstone } from '@/services/collaboration/types';
import {
  CollaborationRunStatusIcon,
  collaborationRunStatusLabel,
  useCollaborationText,
  type CollaborationTranslate,
} from './CollaborationCard';

export interface CollaborationHistoryDrawerProps {
  open: boolean;
  runs: CollaborationRunSummary[];
  tombstones?: CollaborationTombstone[];
  loading?: boolean;
  error?: string | null;
  selectedRunId?: string | null;
  retryingDeletionJobId?: string | null;
  translate?: CollaborationTranslate;
  locale?: string;
  onClose: () => void;
  onSelectRun?: (runId: string) => void;
  onRetry?: () => void;
  onRetryCleanup?: (tombstone: CollaborationTombstone) => void;
  className?: string;
}

function formatUpdatedAt(timestamp: number, locale?: string): string {
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

function abbreviatedDigest(digest: string): string {
  return digest.length > 24 ? `${digest.slice(0, 12)}...${digest.slice(-8)}` : digest;
}

export function CollaborationHistoryDrawer({
  open,
  runs,
  tombstones = [],
  loading = false,
  error,
  selectedRunId,
  retryingDeletionJobId,
  translate,
  locale,
  onClose,
  onSelectRun,
  onRetry,
  onRetryCleanup,
  className,
}: CollaborationHistoryDrawerProps) {
  const text = useCollaborationText(translate);
  const panelRef = useModalFocusScope<HTMLElement>({
    active: open,
    onEscape: onClose,
    initialFocus: 'container',
    layer: 20,
  });
  const sortedTombstones = useMemo(
    () => [...tombstones].sort((left, right) => right.deletedAt - left.deletedAt),
    [tombstones],
  );
  const deletedRunIds = useMemo(
    () => new Set(sortedTombstones.map((tombstone) => tombstone.runId)),
    [sortedTombstones],
  );
  const sortedRuns = useMemo(
    () => runs
      .filter((run) => !deletedRunIds.has(run.runId))
      .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt),
    [deletedRunIds, runs],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[2147481000] bg-[rgb(0_0_0/0.46)]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="collaboration-history-title"
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 end-0 flex w-[min(92vw,420px)] min-w-0 flex-col border-s border-aegis-border bg-aegis-bg-solid text-aegis-text shadow-float outline-none',
          className,
        )}
      >
        <header className="flex min-w-0 items-start justify-between gap-3 border-b border-aegis-border px-4 py-4">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <GitFork size={15} className="shrink-0 text-aegis-primary" aria-hidden />
              <h2 id="collaboration-history-title" className="truncate text-[14px] font-semibold text-aegis-text">
                {text('collaboration.drawer.title', 'Collaboration history')}
              </h2>
            </div>
            <p className="mt-1 text-[10.5px] leading-4 text-aegis-text-dim">
              {text('collaboration.drawer.subtitle', 'Runs remain available across chat sessions.')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={text('collaboration.common.close', 'Close')}
            title={text('collaboration.common.close', 'Close')}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text"
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        {error && (
          <div role="alert" className="m-3 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md bg-aegis-danger/[0.07] px-3 py-2 text-[11px] text-aegis-danger">
            <span className="min-w-0 break-words">{error}</span>
            {onRetry && (
              <button type="button" onClick={onRetry} className="inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 font-medium hover:bg-aegis-danger/[0.08]">
                <RefreshCw size={12} aria-hidden />
                {text('collaboration.common.retry', 'Retry')}
              </button>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading || undefined}>
          {loading && sortedRuns.length === 0 && sortedTombstones.length === 0 ? (
            <div className="space-y-0 px-4" aria-label={text('collaboration.drawer.loading', 'Loading collaboration history')}>
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="border-b border-aegis-border py-4">
                  <div className="h-3 w-3/4 rounded-sm bg-[rgb(var(--aegis-overlay)/0.08)]" />
                  <div className="mt-2 h-2.5 w-2/5 rounded-sm bg-[rgb(var(--aegis-overlay)/0.06)]" />
                </div>
              ))}
            </div>
          ) : sortedRuns.length === 0 && sortedTombstones.length === 0 ? (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2 px-6 text-center">
              <CircleDashed size={25} className="text-aegis-text-dim" aria-hidden />
              <div className="text-[12px] font-medium text-aegis-text-muted">
                {text('collaboration.drawer.empty', 'No collaboration runs yet.')}
              </div>
              <div className="max-w-[34ch] text-[10.5px] leading-4 text-aegis-text-dim">
                {text('collaboration.drawer.emptyHint', 'Runs created from Chat will appear here with their retained history.')}
              </div>
            </div>
          ) : (
            <div>
              {sortedRuns.length > 0 && (
                <section aria-labelledby="collaboration-runs-heading">
                  <h3 id="collaboration-runs-heading" className="border-b border-aegis-border bg-[rgb(var(--aegis-overlay)/0.025)] px-4 py-2 text-[10px] font-medium text-aegis-text-dim">
                    {text('collaboration.drawer.runsHeading', 'Runs')}
                  </h3>
                  <div role="list" aria-label={text('collaboration.drawer.runList', 'Collaboration runs')}>
                    {sortedRuns.map((run) => {
                      const selected = run.runId === selectedRunId;
                      return (
                        <div key={run.runId} role="listitem" className="border-b border-aegis-border">
                          <button
                            type="button"
                            onClick={() => onSelectRun?.(run.runId)}
                            disabled={!onSelectRun}
                            aria-current={selected ? 'true' : undefined}
                            className={cn(
                              'grid w-full min-w-0 grid-cols-[18px_minmax(0,1fr)] gap-x-2 px-4 py-3 text-start transition-colors',
                              'disabled:cursor-default disabled:opacity-100',
                              selected ? 'bg-aegis-primary/[0.08]' : 'hover:bg-[rgb(var(--aegis-overlay)/0.035)]',
                            )}
                          >
                            <span className="pt-0.5"><CollaborationRunStatusIcon status={run.status} size={13} /></span>
                            <span className="min-w-0">
                              <span className="flex min-w-0 items-start justify-between gap-2">
                                <span className="line-clamp-2 min-w-0 break-words text-[11.5px] font-medium leading-4 text-aegis-text-secondary">
                                  {run.goal || text('collaboration.card.untitled', 'Untitled collaboration')}
                                </span>
                                {run.archiveState === 'ARCHIVED' && (
                                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[rgb(var(--aegis-overlay)/0.05)] px-1.5 py-0.5 text-[9.5px] text-aegis-text-dim">
                                    <Archive size={10} aria-hidden />
                                    {text('collaboration.drawer.archived', 'Archived')}
                                  </span>
                                )}
                              </span>
                              <span className="mt-1.5 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[9.5px] text-aegis-text-dim">
                                <span>{collaborationRunStatusLabel(run.status, text)}</span>
                                <span className="font-mono tabular-nums">{formatUpdatedAt(run.updatedAt, locale)}</span>
                              </span>
                              <span className="mt-1 block min-w-0 truncate text-[9.5px] text-aegis-text-dim">
                                {run.origin.agentId} / {run.runId}
                              </span>
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {sortedTombstones.length > 0 && (
                <section aria-labelledby="collaboration-deleted-heading">
                  <h3 id="collaboration-deleted-heading" className="border-b border-aegis-border bg-[rgb(var(--aegis-overlay)/0.025)] px-4 py-2 text-[10px] font-medium text-aegis-text-dim">
                    {text('collaboration.drawer.deletedTitle', 'Deleted records')}
                  </h3>
                  <div role="list" aria-label={text('collaboration.drawer.deletedList', 'Deleted collaboration records')}>
                    {sortedTombstones.map((tombstone) => {
                      const cleanupPending = tombstone.cleanupStatus === 'PENDING';
                      const cleanupPartial = tombstone.cleanupStatus === 'PARTIAL';
                      const flowAbandonment = flowReconciliationAbandonmentAudit(tombstone);
                      return (
                        <div key={tombstone.id} role="listitem" className="grid min-w-0 grid-cols-[18px_minmax(0,1fr)] gap-x-2 border-b border-aegis-border px-4 py-3">
                          <Trash2 size={13} className="mt-0.5 text-aegis-text-dim" aria-hidden />
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                              <span className="text-[11.5px] font-medium leading-4 text-aegis-text-secondary">
                                {text('collaboration.drawer.deletedRecord', 'Deleted run')}
                              </span>
                              <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-aegis-text-dim">
                                {formatUpdatedAt(tombstone.deletedAt, locale)}
                              </span>
                            </div>
                            <div className="mt-1 min-w-0 truncate font-mono text-[9.5px] text-aegis-text-dim">
                              {tombstone.runId}
                            </div>
                            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[9.5px] text-aegis-text-dim">
                              <span>{text('collaboration.drawer.deletedBy', 'Deleted by {{actor}}', { actor: tombstone.actor })}</span>
                              <span className="max-w-full break-all font-mono" title={tombstone.contentDigest}>sha256:{abbreviatedDigest(tombstone.contentDigest)}</span>
                            </div>
                            {flowAbandonment && (
                              <section
                                role="note"
                                aria-label={text('collaboration.drawer.flowAbandonmentTitle', 'Flow reconciliation explicitly abandoned')}
                                data-flow-reconciliation-abandonment
                                className="mt-2 min-w-0 border-s-2 border-aegis-warning/65 bg-aegis-warning/[0.055] py-2 pe-2 ps-2.5 text-[9.5px] leading-4"
                              >
                                <div className="flex min-w-0 items-start gap-1.5 text-aegis-warning">
                                  <TriangleAlert size={11} className="mt-0.5 shrink-0" aria-hidden />
                                  <div className="min-w-0">
                                    <div className="font-medium">
                                      {text('collaboration.drawer.flowAbandonmentTitle', 'Flow reconciliation explicitly abandoned')}
                                    </div>
                                    <div className="mt-0.5 font-mono tabular-nums text-aegis-text-dim" data-flow-abandoned-at={flowAbandonment.abandonedAt}>
                                      {text('collaboration.drawer.flowAbandonmentTime', 'Abandoned {{time}}', {
                                        time: formatUpdatedAt(flowAbandonment.abandonedAt, locale),
                                      })}
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-1.5 min-w-0 break-words text-aegis-text-secondary">
                                  <span className="font-medium text-aegis-text-muted">
                                    {text('collaboration.drawer.flowAbandonmentReason', 'Reason')}: {' '}
                                  </span>
                                  <span data-flow-abandonment-reason>{flowAbandonment.reason}</span>
                                </div>
                                <dl className="mt-1.5 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-aegis-text-dim">
                                  <dt>{text('collaboration.drawer.flowCommandId', 'Command ID')}</dt>
                                  <dd className="min-w-0 break-all font-mono text-aegis-text-muted" data-flow-command-id>{flowAbandonment.commandId}</dd>
                                  <dt>{text('collaboration.drawer.managedFlowId', 'Managed Flow ID')}</dt>
                                  <dd className="min-w-0 break-all font-mono text-aegis-text-muted" data-managed-flow-id>
                                    {flowAbandonment.flowId ?? text('collaboration.drawer.notRecorded', 'Not recorded')}
                                  </dd>
                                  <dt>{text('collaboration.drawer.managedFlowRevision', 'Managed Flow revision')}</dt>
                                  <dd className="min-w-0 break-all font-mono text-aegis-text-muted" data-managed-flow-revision>
                                    {flowAbandonment.flowRevision ?? text('collaboration.drawer.notRecorded', 'Not recorded')}
                                  </dd>
                                  <dt>{text('collaboration.drawer.flowDiagnostic', 'Diagnostic')}</dt>
                                  <dd className="min-w-0 break-words text-aegis-text-muted" data-flow-diagnostic>
                                    {flowAbandonment.diagnostic ?? text('collaboration.drawer.notRecorded', 'Not recorded')}
                                  </dd>
                                </dl>
                              </section>
                            )}
                            {(cleanupPending || cleanupPartial) && (
                              <div role="status" className="mt-2 min-w-0 rounded-md bg-aegis-warning/[0.08] px-2 py-1.5 text-[9.5px] leading-4 text-aegis-warning">
                                <div className="flex min-w-0 items-start gap-1.5">
                                  <TriangleAlert size={11} className="mt-0.5 shrink-0" aria-hidden />
                                  <span className="min-w-0 break-words">
                                    {cleanupPartial
                                      ? text('collaboration.drawer.cleanupPartial', 'Some managed files still need cleanup.')
                                      : text('collaboration.drawer.cleanupPending', 'Managed file cleanup is pending.')}
                                  </span>
                                </div>
                                {tombstone.cleanupError && (
                                  <div className="mt-1 break-words text-aegis-text-muted">
                                    {text('collaboration.drawer.cleanupError', 'Cleanup detail: {{error}}', { error: tombstone.cleanupError })}
                                  </div>
                                )}
                                <div className="mt-1 text-aegis-text-dim">
                                  {text('collaboration.drawer.cleanupUpdated', 'Updated {{time}}', {
                                    time: formatUpdatedAt(tombstone.cleanupUpdatedAt, locale),
                                  })}
                                </div>
                                {cleanupPartial && tombstone.deletionJobId && onRetryCleanup && (
                                  <button
                                    type="button"
                                    onClick={() => onRetryCleanup(tombstone)}
                                    disabled={retryingDeletionJobId === tombstone.deletionJobId}
                                    aria-busy={retryingDeletionJobId === tombstone.deletionJobId || undefined}
                                    data-deletion-job-id={tombstone.deletionJobId}
                                    className="mt-2 inline-flex min-h-7 items-center gap-1.5 rounded-md border border-aegis-warning/25 px-2 py-1 font-medium text-aegis-warning hover:bg-aegis-warning/[0.08] disabled:cursor-wait disabled:opacity-55"
                                  >
                                    <RefreshCw
                                      size={11}
                                      className={retryingDeletionJobId === tombstone.deletionJobId ? 'animate-spin' : undefined}
                                      aria-hidden
                                    />
                                    {text('collaboration.drawer.retryCleanup', 'Retry cleanup')}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        <footer className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-aegis-border px-4 py-2.5 text-[9.5px] text-aegis-text-dim">
          <span>{text('collaboration.drawer.count', '{{count}} runs', { count: sortedRuns.length })}</span>
          {sortedTombstones.length > 0 && (
            <span>{text('collaboration.drawer.deletedCount', '{{count}} deleted', { count: sortedTombstones.length })}</span>
          )}
        </footer>
      </aside>
    </div>
  );
}
