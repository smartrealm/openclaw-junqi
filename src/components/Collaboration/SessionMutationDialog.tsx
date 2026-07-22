import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CircleStop,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  SessionMutationCoordinatorError,
  sessionMutationCoordinator,
  type SessionMutationExecutionResult,
  type SessionMutationImpact,
  type SessionMutationStrategy,
} from '@/services/collaboration/SessionMutationCoordinator';
import {
  reportSessionCoreCommit,
  settleSessionMutationDialog,
  useSessionMutationDialogStore,
} from '@/services/collaboration/sessionMutationDialogStore';

const STRATEGY_ORDER: SessionMutationStrategy[] = [
  'PROCEED',
  'CANCEL_AND_WAIT',
  'STOP_AND_RETARGET_LATER',
  'RECOVER',
];

function defaultStrategy(impact: SessionMutationImpact): SessionMutationStrategy | null {
  if (impact.activeMutation?.status === 'PREPARED') return impact.activeMutation.policy;
  return STRATEGY_ORDER.find((strategy) => impact.strategies.includes(strategy)) ?? null;
}

export function SessionMutationDialog() {
  const { t } = useTranslation();
  const entry = useSessionMutationDialogStore((state) => state.current);
  const [impact, setImpact] = useState<SessionMutationImpact | null>(null);
  const [strategy, setStrategy] = useState<SessionMutationStrategy | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOutcome, setPendingOutcome] = useState<SessionMutationExecutionResult | null>(null);

  useEffect(() => {
    if (!entry) {
      setImpact(null);
      setStrategy(null);
      setError(null);
      setLoading(false);
      setSubmitting(false);
      setPendingOutcome(null);
      return;
    }
    let current = true;
    setImpact(null);
    setStrategy(null);
    setError(null);
    setPendingOutcome(null);
    setLoading(true);
    void sessionMutationCoordinator.inspectImpact(entry.request)
      .then((nextImpact) => {
        if (!current) return;
        setImpact(nextImpact);
        setStrategy(defaultStrategy(nextImpact));
      })
      .catch((cause) => {
        if (!current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [entry?.id]);

  const selectableStrategies = useMemo(
    () => impact?.activeMutation?.status === 'PREPARED'
      ? [impact.activeMutation.policy]
      : STRATEGY_ORDER.filter((candidate) => impact?.strategies.includes(candidate)),
    [impact],
  );

  if (!entry) return null;

  const deleting = entry.request.action === 'delete';
  const completionPending = entry.committedResult !== null;
  const outcomePending = pendingOutcome !== null;
  const recoveryPending = completionPending || outcomePending;
  const ActionIcon = deleting ? Trash2 : RotateCcw;
  const close = () => {
    if (!submitting && !recoveryPending) settleSessionMutationDialog(entry.id, null);
  };
  const reloadImpact = async () => {
    setLoading(true);
    setError(null);
    try {
      const nextImpact = await sessionMutationCoordinator.inspectImpact(entry.request);
      setImpact(nextImpact);
      setStrategy(defaultStrategy(nextImpact));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };
  const submit = async () => {
    if (submitting || (!recoveryPending && !strategy)) return;
    setSubmitting(true);
    setError(null);
    try {
      const request = {
        ...entry.request,
        operationId: entry.operationId,
        timeoutMs: 120_000,
        pollIntervalMs: 750,
      };
      const result = completionPending
        ? await sessionMutationCoordinator.completeCommittedMutation(request, entry.committedResult!)
        : outcomePending
          ? await sessionMutationCoordinator.resolvePendingCoreMutation(request, pendingOutcome)
          : await sessionMutationCoordinator.execute(request, strategy!);
      settleSessionMutationDialog(entry.id, result);
    } catch (cause) {
      const detail = cause instanceof SessionMutationCoordinatorError
        && cause.code === 'CORE_RPC_OUTCOME_UNKNOWN'
        ? t(
          'collaboration.sessionMutation.outcomeUnknown',
          'OpenClaw may have completed this change, but the result is not yet verifiable. Keep this dialog open and retry verification.',
        )
        : cause instanceof Error ? cause.message : String(cause);
      const pendingCommit = cause instanceof SessionMutationCoordinatorError
        ? cause.committedResult
        : undefined;
      const unresolvedOutcome = cause instanceof SessionMutationCoordinatorError
        ? cause.pendingResult
        : undefined;
      if (pendingCommit) {
        setPendingOutcome(null);
        reportSessionCoreCommit(entry.id, pendingCommit);
      } else if (unresolvedOutcome) {
        setPendingOutcome(unresolvedOutcome);
      } else if (outcomePending) {
        setPendingOutcome(null);
      }
      let refreshedImpact: SessionMutationImpact | null = null;
      try {
        const nextImpact = await sessionMutationCoordinator.inspectImpact(entry.request);
        refreshedImpact = nextImpact;
        setImpact(nextImpact);
        setStrategy(defaultStrategy(nextImpact));
      } catch {
        // Keep the last authoritative impact visible when the refresh also fails.
      }
      const recoveryHint = pendingCommit?.collaborationRecoveryRequired
        ? t(
          'collaboration.sessionMutation.ledgerRecoveryRequired',
          'The session change completed in OpenClaw, but the collaboration ledger still needs recovery. Keep this dialog open and retry recovery.',
        )
        : '';
      const fenceHint = refreshedImpact?.mutationFenceActive === true
        ? t(
          'collaboration.sessionMutation.fenceRetained',
          'The collaboration fence remains active. Retry recovery before changing this session.',
        )
        : '';
      setError([detail, recoveryHint, fenceHint].filter(Boolean).join(' '));
    } finally {
      setSubmitting(false);
    }
  };

  const strategyText: Record<Exclude<SessionMutationStrategy, 'ABORT'>, { title: string; detail: string }> = {
    PROCEED: {
      title: t('collaboration.sessionMutation.proceed', 'Continue'),
      detail: t('collaboration.sessionMutation.proceedDetail', 'No active collaboration run is bound to this exact session.'),
    },
    CANCEL_AND_WAIT: {
      title: t('collaboration.sessionMutation.cancelAndWait', 'Cancel collaboration and continue'),
      detail: t('collaboration.sessionMutation.cancelAndWaitDetail', 'Cancel affected runs, wait for terminal confirmation, then change the session.'),
    },
    STOP_AND_RETARGET_LATER: {
      title: t('collaboration.sessionMutation.stopAndRetarget', 'Keep runs for later recovery'),
      detail: t('collaboration.sessionMutation.stopAndRetargetDetail', 'Stop new dispatch, delete the session, and resolve delivery targets from collaboration history.'),
    },
    RECOVER: {
      title: t('collaboration.sessionMutation.recover', 'Recover interrupted change'),
      detail: t('collaboration.sessionMutation.recoverDetail', 'Continue the existing fenced operation instead of starting another one.'),
    },
  };

  return (
    <div
      className="fixed inset-0 z-[2147481200] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-mutation-title"
        className="flex max-h-[90vh] w-[min(560px,96vw)] min-w-0 flex-col overflow-hidden rounded-lg border border-aegis-border bg-aegis-bg-solid text-aegis-text shadow-float"
      >
        <header className="flex min-w-0 items-start justify-between gap-3 border-b border-aegis-border px-4 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-aegis-warning/25 bg-aegis-warning/[0.08] text-aegis-warning">
              <ActionIcon size={16} aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id="session-mutation-title" className="text-[14px] font-semibold leading-5">
                {deleting
                  ? t('collaboration.sessionMutation.deleteTitle', 'Delete session')
                  : t('collaboration.sessionMutation.resetTitle', 'Reset session')}
              </h2>
              <p className="mt-1 break-all font-mono text-[10px] text-aegis-text-dim">{entry.request.sessionKey}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={submitting || recoveryPending}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text disabled:opacity-40"
            title={t('common.cancel', 'Cancel')}
            aria-label={t('common.cancel', 'Cancel')}
          >
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto px-4 py-4">
          {loading && !impact && (
            <div className="flex min-h-28 items-center justify-center gap-2 text-[11.5px] text-aegis-text-muted" aria-busy="true">
              <Loader2 size={15} className="animate-spin" />
              {t('collaboration.sessionMutation.checking', 'Checking collaboration impact...')}
            </div>
          )}

          {impact && (
            <>
              <div className="flex items-start gap-2.5 border-b border-aegis-border pb-4">
                {impact.activeRuns.length > 0 ? (
                  <ShieldAlert size={16} className="mt-0.5 shrink-0 text-aegis-warning" />
                ) : (
                  <CircleStop size={16} className="mt-0.5 shrink-0 text-aegis-text-muted" />
                )}
                <div className="min-w-0">
                  <p className="text-[11.5px] font-medium text-aegis-text-secondary">
                    {impact.activeRuns.length > 0
                      ? t('collaboration.sessionMutation.affectedRuns', '{{count}} active collaboration run(s) are affected.', { count: impact.activeRuns.length })
                      : t('collaboration.sessionMutation.noAffectedRuns', 'No active collaboration run is affected.')}
                  </p>
                  {impact.mutationFenceActive && (
                    <p className="mt-1 text-[10.5px] leading-4 text-aegis-warning">
                      {t('collaboration.sessionMutation.fenceActive', 'An earlier session change is fenced and must be recovered.')}
                    </p>
                  )}
                </div>
              </div>

              {impact.activeRuns.length > 0 && (
                <div className="border-b border-aegis-border py-3" role="list" aria-label={t('collaboration.sessionMutation.runs', 'Affected runs')}>
                  {impact.activeRuns.map((run) => (
                    <div key={run.runId} role="listitem" className="flex min-w-0 items-start justify-between gap-3 py-1.5">
                      <div className="min-w-0">
                        <div className="line-clamp-2 break-words text-[11px] text-aegis-text-secondary">{run.goal}</div>
                        <div className="mt-0.5 font-mono text-[9.5px] text-aegis-text-dim">{run.runId}</div>
                      </div>
                      <span className="shrink-0 text-[9.5px] text-aegis-text-muted">{run.status}</span>
                    </div>
                  ))}
                </div>
              )}

              <fieldset className="pt-3">
                <legend className="mb-2 text-[10.5px] font-medium text-aegis-text-muted">
                  {t('collaboration.sessionMutation.strategy', 'Choose how to continue')}
                </legend>
                <div className="space-y-1.5">
                  {selectableStrategies.map((candidate) => {
                    const copy = strategyText[candidate as Exclude<SessionMutationStrategy, 'ABORT'>];
                    if (!copy) return null;
                    return (
                      <label
                        key={candidate}
                        className="flex min-w-0 cursor-pointer items-start gap-2.5 rounded-md border border-aegis-border px-3 py-2.5 hover:border-aegis-border-hover"
                      >
                        <input
                          type="radio"
                          name="session-mutation-strategy"
                          value={candidate}
                          checked={strategy === candidate}
                          onChange={() => setStrategy(candidate)}
                          disabled={submitting}
                          className="mt-0.5 accent-aegis-primary"
                        />
                        <span className="min-w-0">
                          <span className="block text-[11.5px] font-medium text-aegis-text-secondary">{copy.title}</span>
                          <span className="mt-0.5 block text-[10px] leading-4 text-aegis-text-dim">{copy.detail}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </>
          )}

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-aegis-danger/25 bg-aegis-danger/[0.06] px-3 py-2.5 text-[10.5px] leading-4 text-aegis-danger" role="alert">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}
        </div>

        <footer className={`flex shrink-0 items-center gap-3 border-t border-aegis-border px-4 py-3 ${recoveryPending ? 'justify-end' : 'justify-between'}`}>
          {!recoveryPending && (
            <button
              type="button"
              onClick={() => void reloadImpact()}
              disabled={loading || submitting}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text disabled:opacity-40"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              {t('common.refresh', 'Refresh')}
            </button>
          )}
          <div className="flex items-center gap-2">
            {!recoveryPending && (
              <button
                type="button"
                onClick={close}
                disabled={submitting}
                className="h-8 rounded-md px-3 text-[11px] text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text disabled:opacity-40"
              >
                {t('common.cancel', 'Cancel')}
              </button>
            )}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={(!recoveryPending && (!impact || !strategy)) || loading || submitting}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-aegis-danger/30 bg-aegis-danger/[0.08] px-3 text-[11px] font-medium text-aegis-danger hover:bg-aegis-danger/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : <ActionIcon size={13} />}
              {recoveryPending
                ? t('common.retry', 'Retry')
                : deleting
                  ? t('collaboration.sessionMutation.confirmDelete', 'Delete')
                  : t('collaboration.sessionMutation.confirmReset', 'Reset')}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
