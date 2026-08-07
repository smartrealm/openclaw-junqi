import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, FileDiff, LoaderCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { gateway, type OpenClawSessionDiff } from '@/services/gateway';

interface SessionDiffControlProps {
  sessionKey: string;
  agentId: string;
}

interface SessionDiffState {
  loading: boolean;
  value: OpenClawSessionDiff | null;
  error: string | null;
}

const initialState: SessionDiffState = {
  loading: false,
  value: null,
  error: null,
};

function statusClass(status: OpenClawSessionDiff['files'][number]['status']): string {
  switch (status) {
    case 'added':
      return 'text-aegis-success';
    case 'deleted':
      return 'text-aegis-danger';
    default:
      return 'text-aegis-text-muted';
  }
}

export function SessionDiffControl({ sessionKey, agentId }: SessionDiffControlProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SessionDiffState>(initialState);
  const rootRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const value = await gateway.getSessionDiff(sessionKey, agentId);
      if (requestId === requestIdRef.current) {
        setState({ loading: false, value, error: null });
      }
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setState({
          loading: false,
          value: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }, [agentId, sessionKey]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

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

  const diff = state.value;
  const refLabel = [diff?.baseRef, diff?.branch].filter(Boolean).join(' -> ');

  return (
    <div ref={rootRef} className="relative no-drag">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t('chat.sessionDiff.open')}
        aria-label={t('chat.sessionDiff.open')}
        className={clsx(
          'inline-flex items-center rounded-md px-1.5 py-1 text-aegis-text-dim transition-colors',
          'hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary',
          open && 'bg-[rgb(var(--aegis-overlay)/0.07)] text-aegis-text',
        )}
      >
        <FileDiff size={11} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('chat.sessionDiff.title')}
          className="absolute end-0 top-full z-50 mt-2 flex max-h-[min(620px,calc(100vh-88px))] w-[min(520px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border border-aegis-menu-border bg-aegis-menu-bg"
          style={{ boxShadow: 'var(--aegis-menu-shadow)' }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-aegis-menu-border px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold text-aegis-text">
                {t('chat.sessionDiff.title')}
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-aegis-text-dim" title={sessionKey}>
                {sessionKey}
              </div>
            </div>
            <button
              type="button"
              onClick={() => { void load(); }}
              disabled={state.loading}
              title={t('chat.sessionDiff.refresh')}
              aria-label={t('chat.sessionDiff.refresh')}
              className="grid size-7 shrink-0 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text disabled:cursor-wait disabled:opacity-50"
            >
              <RefreshCw size={12} className={clsx(state.loading && 'animate-spin')} aria-hidden="true" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[11px]">
            {state.loading && !diff && (
              <div className="flex items-center gap-2 py-5 text-aegis-text-muted" role="status">
                <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
                <span>{t('chat.sessionDiff.loading')}</span>
              </div>
            )}

            {!state.loading && state.error && (
              <div className="space-y-2 rounded-md border border-aegis-danger/25 bg-aegis-danger/5 px-3 py-2.5 text-aegis-text-muted">
                <div className="flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0 text-aegis-danger" aria-hidden="true" />
                  <span>{t('chat.sessionDiff.error')}</span>
                </div>
                <div className="break-words font-mono text-[10px] text-aegis-text-dim">{state.error}</div>
                <button
                  type="button"
                  onClick={() => { void load(); }}
                  className="rounded-md border border-aegis-border px-2 py-1 text-[10px] text-aegis-text-secondary transition-colors hover:border-aegis-border-hover hover:text-aegis-text"
                >
                  {t('chat.sessionDiff.retry')}
                </button>
              </div>
            )}

            {diff && (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-aegis-text-muted">
                  {refLabel && <span>{refLabel}</span>}
                  <span className="text-aegis-success">+{diff.additions}</span>
                  <span className="text-aegis-danger">-{diff.deletions}</span>
                </div>

                {diff.truncated && (
                  <p className="mb-3 rounded-md border border-aegis-warning/25 bg-aegis-warning/5 px-2.5 py-2 text-aegis-warning">
                    {t('chat.sessionDiff.resultTruncated')}
                  </p>
                )}

                {diff.unavailableReason === 'not_git' && (
                  <p className="py-5 text-center text-aegis-text-dim">{t('chat.sessionDiff.notGit')}</p>
                )}
                {diff.unavailableReason === 'unknown_session' && (
                  <p className="py-5 text-center text-aegis-text-dim">{t('chat.sessionDiff.unknownSession')}</p>
                )}
                {!diff.unavailableReason && diff.files.length === 0 && (
                  <p className="py-5 text-center text-aegis-text-dim">{t('chat.sessionDiff.empty')}</p>
                )}
                {!diff.unavailableReason && diff.files.length > 0 && (
                  <div className="space-y-1.5">
                    {diff.files.map((file) => (
                      <section key={`${file.oldPath ?? ''}:${file.path}`} className="rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.025)] p-2.5">
                        <div className="flex items-start gap-2">
                          <span className={clsx('shrink-0 text-[10px]', statusClass(file.status))}>
                            {t(`chat.sessionDiff.status.${file.status}`)}
                          </span>
                          <span className="min-w-0 flex-1 break-all font-mono text-aegis-text">
                            {file.oldPath ? `${file.oldPath} -> ` : ''}{file.path}
                          </span>
                          <span className="shrink-0 font-mono text-aegis-success">+{file.additions}</span>
                          <span className="shrink-0 font-mono text-aegis-danger">-{file.deletions}</span>
                        </div>
                        {(file.untracked || file.binary || file.truncated) && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[9px] text-aegis-text-dim">
                            {file.untracked && <span>{t('chat.sessionDiff.untracked')}</span>}
                            {file.binary && <span>{t('chat.sessionDiff.binary')}</span>}
                            {file.truncated && <span>{t('chat.sessionDiff.fileTruncated')}</span>}
                          </div>
                        )}
                        {file.patch ? (
                          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words border-t border-aegis-border pt-2 font-mono text-[10px] text-aegis-text-muted">
                            {file.patch}
                          </pre>
                        ) : !file.binary && (
                          <p className="mt-2 text-[10px] text-aegis-text-dim">{t('chat.sessionDiff.patchUnavailable')}</p>
                        )}
                      </section>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
