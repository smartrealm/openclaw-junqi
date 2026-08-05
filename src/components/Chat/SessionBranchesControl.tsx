import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, GitBranch, LoaderCircle, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { showAlert, showConfirm } from '@/components/shared/AlertDialog';
import { useSessionTranscriptBranches } from '@/hooks/useSessionTranscriptBranches';
import { useChatStore } from '@/stores/chatStore';

interface SessionBranchesControlProps {
  readonly sessionKey: string;
  readonly agentId: string;
  readonly enabled?: boolean;
}

function branchTime(value: string | undefined, language: string): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(timestamp);
}

export function SessionBranchesControl({
  sessionKey,
  agentId,
  enabled = true,
}: SessionBranchesControlProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const historyLoader = useChatStore((state) => state.historyLoader);
  const { capabilities, branches, loading, error, refresh, switchBranch } = useSessionTranscriptBranches(
    sessionKey,
    agentId,
    open && enabled,
  );
  const [switchingLeafEntryId, setSwitchingLeafEntryId] = useState<string | null>(null);

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

  const confirmSwitch = (leafEntryId: string) => {
    if (!capabilities.branchSwitch || switchingLeafEntryId !== null) return;
    showConfirm(
      t('chat.sessionBranches.switchConfirmTitle'),
      t('chat.sessionBranches.switchConfirmMessage'),
      async () => {
        setSwitchingLeafEntryId(leafEntryId);
        try {
          await switchBranch(leafEntryId);
          if (historyLoader) {
            await historyLoader(sessionKey, { force: true });
          }
          await refresh();
          setOpen(false);
        } catch (cause) {
          const detail = cause instanceof Error && cause.message ? cause.message : String(cause);
          window.setTimeout(() => {
            showAlert(
              t('chat.sessionBranches.switchFailedTitle'),
              `${t('chat.sessionBranches.switchFailed')} ${detail}`,
              'error',
            );
          }, 0);
        } finally {
          setSwitchingLeafEntryId(null);
        }
      },
    );
  };

  if (!capabilities.branches) return null;

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
        title={t('chat.sessionBranches.open')}
        aria-label={t('chat.sessionBranches.open')}
      >
        <GitBranch size={11} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('chat.sessionBranches.title')}
          className="absolute top-full end-0 z-50 mt-2 flex w-[min(380px,calc(100vw-24px))] max-h-[min(520px,calc(100vh-88px))] flex-col overflow-hidden rounded-lg border border-aegis-menu-border bg-aegis-menu-bg"
          style={{ boxShadow: 'var(--aegis-menu-shadow)' }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-aegis-menu-border px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold text-aegis-text">{t('chat.sessionBranches.title')}</div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-aegis-text-dim" title={sessionKey}>{sessionKey}</div>
            </div>
            <button
              type="button"
              onClick={() => { void refresh(); }}
              disabled={loading || switchingLeafEntryId !== null}
              className="grid size-7 shrink-0 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text disabled:cursor-wait disabled:opacity-50"
              title={t('chat.sessionBranches.refresh')}
              aria-label={t('chat.sessionBranches.refresh')}
            >
              <RefreshCw size={12} className={clsx(loading && 'animate-spin')} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {loading && (
              <div className="flex items-center gap-2 py-5 text-[11px] text-aegis-text-muted">
                <LoaderCircle size={14} className="animate-spin" />
                <span>{t('chat.sessionBranches.loading')}</span>
              </div>
            )}

            {!loading && error && (
              <div className="space-y-2 rounded-md border border-aegis-danger/25 bg-aegis-danger/5 px-3 py-2.5 text-[11px] text-aegis-text-muted">
                <div className="flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0 text-aegis-danger" />
                  <span>{t('chat.sessionBranches.error')}</span>
                </div>
                <div className="break-words text-[10px] text-aegis-text-dim">{error}</div>
                <button
                  type="button"
                  onClick={() => { void refresh(); }}
                  className="rounded-md border border-aegis-border px-2 py-1 text-[10px] text-aegis-text-secondary transition-colors hover:border-aegis-border-hover hover:text-aegis-text"
                >
                  {t('chat.sessionBranches.retry')}
                </button>
              </div>
            )}

            {!loading && !error && branches.length === 0 && (
              <div className="py-5 text-center text-[10.5px] text-aegis-text-dim">{t('chat.sessionBranches.empty')}</div>
            )}

            {!loading && !error && branches.length > 0 && (
              <div className="space-y-1.5">
                {branches.map((branch) => {
                  const updatedAt = branchTime(branch.updatedAt, i18n.language);
                  const switching = switchingLeafEntryId === branch.leafEntryId;
                  return (
                    <button
                      key={branch.leafEntryId}
                      type="button"
                      onClick={() => !branch.active && confirmSwitch(branch.leafEntryId)}
                      disabled={branch.active || !capabilities.branchSwitch || switchingLeafEntryId !== null}
                      className={clsx(
                        'w-full rounded-md border px-2.5 py-2 text-start transition-colors disabled:cursor-default',
                        branch.active
                          ? 'border-aegis-primary/35 bg-aegis-primary/5'
                          : 'border-aegis-border hover:border-aegis-border-hover hover:bg-[rgb(var(--aegis-overlay)/0.025)] disabled:opacity-50',
                      )}
                      title={branch.active
                        ? t('chat.sessionBranches.active')
                        : capabilities.branchSwitch
                          ? t('chat.sessionBranches.switch')
                          : t('chat.sessionBranches.title')}
                    >
                      <div className="flex items-start gap-2">
                        {switching
                          ? <LoaderCircle size={13} className="mt-0.5 shrink-0 animate-spin text-aegis-primary" />
                          : branch.active
                            ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-aegis-primary" />
                            : <GitBranch size={13} className="mt-0.5 shrink-0 text-aegis-text-muted" />}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[10.5px] font-medium text-aegis-text">{branch.headline || t('chat.sessionBranches.untitled')}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-aegis-text-dim">
                            <span>{t('chat.sessionBranches.messageCount', { count: branch.messageCount })}</span>
                            {updatedAt ? <span>{updatedAt}</span> : null}
                            {branch.active ? <span className="text-aegis-primary">{t('chat.sessionBranches.active')}</span> : null}
                          </div>
                          <div className="mt-1 truncate font-mono text-[9px] text-aegis-text-dim">{branch.leafEntryId}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
