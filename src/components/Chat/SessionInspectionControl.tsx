import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, GitFork, History, LoaderCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useSessionInspection } from '@/hooks/useSessionInspection';
import { showAlert, showConfirm } from '@/components/shared/AlertDialog';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { notifyNativeSessionCommit } from '@/utils/sessionLifecycle';
import type {
  SessionCompactionCheckpoint,
  SessionPreviewItem,
} from '@/services/gateway/sessionInspection';

interface SessionInspectionControlProps {
  sessionKey: string;
  agentId: string;
}

const ROLE_KEYS: Record<SessionPreviewItem['role'], string> = {
  user: 'user',
  assistant: 'assistant',
  system: 'system',
  tool: 'tool',
  other: 'other',
};

const CHECKPOINT_REASON_KEYS: Record<SessionCompactionCheckpoint['reason'], string> = {
  manual: 'manual',
  'auto-threshold': 'autoThreshold',
  'overflow-retry': 'overflowRetry',
  'timeout-retry': 'timeoutRetry',
};

function checkpointTime(createdAt: number, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(createdAt));
}

export function SessionInspectionControl({ sessionKey, agentId }: SessionInspectionControlProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [activeCheckpointId, setActiveCheckpointId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const {
    preview,
    resolvedKey,
    checkpoints,
    loading,
    error,
    refresh,
    action,
    branchCheckpoint,
    restoreCheckpoint,
  } = useSessionInspection(sessionKey, agentId, open);

  const actionError = (operation: 'branch' | 'restore', cause: unknown) => {
    const detail = cause instanceof Error && cause.message ? cause.message : String(cause);
    window.setTimeout(() => {
      showAlert(
        t(`chat.sessionInspection.${operation}FailedTitle`),
        `${t(`chat.sessionInspection.${operation}Failed`)} ${detail}`,
        'error',
      );
    }, 0);
  };

  const addBranchToStores = (checkpoint: SessionCompactionCheckpoint, result: {
    key: string;
    sessionId: string;
    entry: { updatedAt: number };
  }) => {
    const normalizedAgentId = agentId.trim();
    const label = t('chat.sessionInspection.branchLabel', {
      checkpointId: checkpoint.checkpointId,
    });
    useChatStore.getState().addNativeSession({
      key: result.key,
      sessionId: result.sessionId,
      label,
      createdAt: result.entry.updatedAt,
      ...(normalizedAgentId ? { agentId: normalizedAgentId } : {}),
    });

    const gatewayStore = useGatewayDataStore.getState();
    gatewayStore.setSessions([
      ...gatewayStore.sessions.filter((session) => session.key !== result.key),
      {
        key: result.key,
        sessionId: result.sessionId,
        label,
        ...(normalizedAgentId ? { agentId: normalizedAgentId } : {}),
        createdAt: result.entry.updatedAt,
      },
    ]);
    notifyNativeSessionCommit();
  };

  const updateRestoredSessionInStores = (result: { key: string; sessionId: string }) => {
    const normalizedAgentId = agentId.trim();
    const chatStore = useChatStore.getState();
    const current = chatStore.sessions.find((session) => session.key === result.key);
    chatStore.clearQueue(result.key);
    chatStore.clearSessionMessages(result.key);
    chatStore.clearSessionTokens(result.key);
    chatStore.settleSessionRunUi(result.key);
    if (current?.sessionId) {
      chatStore.setSessionIdentity(result.key, result.sessionId, normalizedAgentId || undefined);
    } else {
      chatStore.setSessions(
        chatStore.sessions.map((session) => session.key === result.key
          ? { ...session, sessionId: result.sessionId, ...(normalizedAgentId ? { agentId: normalizedAgentId } : {}) }
          : session),
      );
    }

    const gatewayStore = useGatewayDataStore.getState();
    gatewayStore.setSessions(gatewayStore.sessions.map((session) => session.key === result.key
      ? { ...session, sessionId: result.sessionId, ...(normalizedAgentId ? { agentId: normalizedAgentId } : {}) }
      : session));
    window.dispatchEvent(new CustomEvent('aegis:session-reset', { detail: { sessionKey: result.key } }));
  };

  const confirmBranch = (checkpoint: SessionCompactionCheckpoint) => {
    showConfirm(
      t('chat.sessionInspection.branchConfirmTitle'),
      t('chat.sessionInspection.branchConfirmMessage', { checkpointId: checkpoint.checkpointId }),
      async () => {
        setActiveCheckpointId(checkpoint.checkpointId);
        try {
          const result = await branchCheckpoint(checkpoint.checkpointId);
          addBranchToStores(checkpoint, result);
          setOpen(false);
        } catch (cause) {
          actionError('branch', cause);
        } finally {
          setActiveCheckpointId(null);
        }
      },
    );
  };

  const confirmRestore = (checkpoint: SessionCompactionCheckpoint) => {
    showConfirm(
      t('chat.sessionInspection.restoreConfirmTitle'),
      t('chat.sessionInspection.restoreConfirmMessage', { checkpointId: checkpoint.checkpointId }),
      async () => {
        setActiveCheckpointId(checkpoint.checkpointId);
        try {
          const result = await restoreCheckpoint(checkpoint.checkpointId);
          updateRestoredSessionInStores(result);
          await refresh();
        } catch (cause) {
          actionError('restore', cause);
        } finally {
          setActiveCheckpointId(null);
        }
      },
    );
  };

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative no-drag">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={clsx(
          'inline-flex items-center rounded-md px-1.5 py-1 text-aegis-text-dim transition-colors',
          'hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary',
          open && 'bg-[rgb(var(--aegis-overlay)/0.07)] text-aegis-text',
        )}
        title={t('chat.sessionInspection.open')}
        aria-label={t('chat.sessionInspection.open')}
      >
        <Eye size={11} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('chat.sessionInspection.title')}
          className="absolute top-full end-0 z-50 mt-2 flex w-[min(440px,calc(100vw-24px))] max-h-[min(620px,calc(100vh-88px))] flex-col overflow-hidden rounded-lg border border-aegis-menu-border bg-aegis-menu-bg"
          style={{ boxShadow: 'var(--aegis-menu-shadow)' }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-aegis-menu-border px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold text-aegis-text">{t('chat.sessionInspection.title')}</div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-aegis-text-dim" title={sessionKey}>{sessionKey}</div>
            </div>
            <button
              type="button"
              onClick={() => { void refresh(); }}
              disabled={loading}
              className="grid size-7 shrink-0 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text disabled:cursor-wait disabled:opacity-50"
              title={t('chat.sessionInspection.refresh')}
              aria-label={t('chat.sessionInspection.refresh')}
            >
              <RefreshCw size={12} className={clsx(loading && 'animate-spin')} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {loading && (
              <div className="flex items-center gap-2 py-5 text-[11px] text-aegis-text-muted">
                <LoaderCircle size={14} className="animate-spin" />
                <span>{t('chat.sessionInspection.loading')}</span>
              </div>
            )}

            {!loading && error && (
              <div className="space-y-2 rounded-md border border-aegis-danger/25 bg-aegis-danger/5 px-3 py-2.5 text-[11px] text-aegis-text-muted">
                <div className="flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0 text-aegis-danger" />
                  <span>{t('chat.sessionInspection.error')}</span>
                </div>
                <div className="break-words text-[10px] text-aegis-text-dim">{error}</div>
                <button
                  type="button"
                  onClick={() => { void refresh(); }}
                  className="rounded-md border border-aegis-border px-2 py-1 text-[10px] text-aegis-text-secondary transition-colors hover:border-aegis-border-hover hover:text-aegis-text"
                >
                  {t('chat.sessionInspection.retry')}
                </button>
              </div>
            )}

            {!loading && !error && preview && (
              <>
                <section className="border-b border-aegis-border pb-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Eye size={13} className="text-aegis-text-muted" />
                    <h3 className="text-[11px] font-semibold text-aegis-text">{t('chat.sessionInspection.preview')}</h3>
                    <span className="ms-auto text-[10px] text-aegis-text-dim">
                      {t(`chat.sessionInspection.status.${preview.status}`)}
                    </span>
                  </div>
                  {preview.items.length > 0 ? (
                    <div className="space-y-1.5">
                      {preview.items.map((item, index) => (
                        <div key={`${item.role}-${index}`} className="rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.025)] px-2.5 py-2">
                          <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-aegis-text-dim">
                            {t(`chat.sessionInspection.role.${ROLE_KEYS[item.role]}`)}
                          </div>
                          <div className="whitespace-pre-wrap break-words text-[10.5px] leading-4 text-aegis-text-secondary">{item.text}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-2 text-[10.5px] text-aegis-text-dim">{t('chat.sessionInspection.noPreview')}</div>
                  )}
                </section>

                <section className="border-b border-aegis-border py-3">
                  <div className="mb-1 flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-aegis-success" />
                    <h3 className="text-[11px] font-semibold text-aegis-text">{t('chat.sessionInspection.resolved')}</h3>
                  </div>
                  <div className="break-all font-mono text-[10px] text-aegis-text-muted">
                    {resolvedKey || t('chat.sessionInspection.notResolved')}
                  </div>
                </section>

                <section className="pt-3">
                  <div className="mb-2 flex items-center gap-2">
                    <History size={13} className="text-aegis-text-muted" />
                    <h3 className="text-[11px] font-semibold text-aegis-text">{t('chat.sessionInspection.checkpoints')}</h3>
                    <span className="ms-auto font-mono text-[10px] text-aegis-text-dim">{checkpoints.length}</span>
                  </div>
                  {checkpoints.length > 0 ? (
                    <div className="space-y-1.5">
                      {checkpoints.map((checkpoint) => (
                        <div key={checkpoint.checkpointId} className="rounded-md border border-aegis-border px-2.5 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[10.5px] font-medium text-aegis-text">
                              {t(`chat.sessionInspection.reason.${CHECKPOINT_REASON_KEYS[checkpoint.reason]}`)}
                            </span>
                            <span className="shrink-0 text-[9px] text-aegis-text-dim">{checkpointTime(checkpoint.createdAt, i18n.language)}</span>
                          </div>
                          <div className="mt-1 break-all font-mono text-[9px] text-aegis-text-dim">{checkpoint.checkpointId}</div>
                          {checkpoint.summary && <div className="mt-1 text-[10px] leading-4 text-aegis-text-muted">{checkpoint.summary}</div>}
                          {(checkpoint.tokensBefore !== undefined || checkpoint.tokensAfter !== undefined) && (
                            <div className="mt-1 text-[9px] text-aegis-text-dim">
                              {t('chat.sessionInspection.tokens', {
                                before: checkpoint.tokensBefore ?? t('common.na'),
                                after: checkpoint.tokensAfter ?? t('common.na'),
                              })}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-aegis-border pt-2">
                            <button
                              type="button"
                              onClick={() => confirmBranch(checkpoint)}
                              disabled={action !== null}
                              className="inline-flex items-center gap-1 rounded-md border border-aegis-border px-2 py-1 text-[10px] text-aegis-text-secondary transition-colors hover:border-aegis-border-hover hover:text-aegis-text disabled:cursor-wait disabled:opacity-50"
                              title={t('chat.sessionInspection.branch')}
                              aria-label={t('chat.sessionInspection.branch')}
                            >
                              {action === 'branch' && activeCheckpointId === checkpoint.checkpointId
                                ? <LoaderCircle size={11} className="animate-spin" />
                                : <GitFork size={11} />}
                              <span>{t('chat.sessionInspection.branch')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => confirmRestore(checkpoint)}
                              disabled={action !== null}
                              className="inline-flex items-center gap-1 rounded-md border border-aegis-border px-2 py-1 text-[10px] text-aegis-text-secondary transition-colors hover:border-aegis-border-hover hover:text-aegis-text disabled:cursor-wait disabled:opacity-50"
                              title={t('chat.sessionInspection.restore')}
                              aria-label={t('chat.sessionInspection.restore')}
                            >
                              {action === 'restore' && activeCheckpointId === checkpoint.checkpointId
                                ? <LoaderCircle size={11} className="animate-spin" />
                                : <RotateCcw size={11} />}
                              <span>{t('chat.sessionInspection.restore')}</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-2 text-[10.5px] text-aegis-text-dim">{t('chat.sessionInspection.noCheckpoints')}</div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
