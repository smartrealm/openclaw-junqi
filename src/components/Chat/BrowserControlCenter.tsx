import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronDown,
  CircleStop,
  Focus,
  Globe2,
  LoaderCircle,
  PanelTop,
  Play,
  RefreshCw,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useAlertStore } from '@/components/shared/alertStore';
import {
  browserProfileNeedsLoginConfirmation,
  useOpenClawBrowserControl,
} from '@/hooks/useOpenClawBrowserControl';
import { ChatIconButton } from './ChatIconButton';

function snapshotText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const snapshot = (value as Record<string, unknown>).snapshot;
    if (typeof snapshot === 'string') return snapshot;
  }
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
}

export function BrowserControlCenter() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const browser = useOpenClawBrowserControl(open);
  const selectedProfileUsesLogin = browserProfileNeedsLoginConfirmation(browser.selectedProfile);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const confirmExistingSession = (action: () => Promise<void>) => {
    if (!selectedProfileUsesLogin) {
      void action();
      return;
    }
    useAlertStore.getState().confirm({
      title: t('chat.browserControl.existingSessionTitle'),
      message: t('chat.browserControl.existingSessionMessage'),
      variant: 'confirm',
      confirmLabel: t('chat.browserControl.existingSessionConfirm'),
      onConfirm: action,
    });
  };

  const submitOpen = () => {
    const target = url.trim();
    if (!target) return;
    confirmExistingSession(async () => {
      const result = await browser.open(target, label.trim() || undefined);
      if (result) {
        setUrl('');
        setLabel('');
      }
    });
  };

  const busy = browser.operation !== null;
  const snapshot = browser.snapshot === null ? null : snapshotText(browser.snapshot);

  return (
    <div ref={rootRef} className="relative no-drag">
      <ChatIconButton
        type="button"
        label={t('chat.browserControl.open')}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={clsx(
          'inline-flex items-center rounded-md px-1.5 py-1 text-aegis-text-dim transition-colors',
          'hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary',
          open && 'bg-[rgb(var(--aegis-overlay)/0.07)] text-aegis-text',
        )}
      >
        <Globe2 size={11} aria-hidden="true" />
      </ChatIconButton>

      {open && (
        <section
          role="dialog"
          aria-label={t('chat.browserControl.title')}
          className="absolute end-0 top-full z-50 mt-2 flex w-[min(520px,calc(100vw-24px))] max-h-[min(660px,calc(100vh-88px))] flex-col overflow-hidden rounded-lg border border-aegis-menu-border bg-aegis-menu-bg"
          style={{ boxShadow: 'var(--aegis-menu-shadow)' }}
        >
          <header className="flex items-center justify-between gap-2 border-b border-aegis-menu-border px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <Globe2 size={14} className="shrink-0 text-aegis-primary" aria-hidden="true" />
              <h2 className="truncate text-[12px] font-semibold text-aegis-text">{t('chat.browserControl.title')}</h2>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => { void browser.refresh(); }}
                disabled={browser.loading || busy}
                title={t('chat.browserControl.refresh')}
                aria-label={t('chat.browserControl.refresh')}
                className="grid size-7 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text disabled:cursor-wait disabled:opacity-50"
              >
                <RefreshCw size={12} className={clsx(browser.loading && 'animate-spin')} />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title={t('chat.browserControl.close')}
                aria-label={t('chat.browserControl.close')}
                className="grid size-7 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text"
              >
                <X size={13} />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {browser.loading && !browser.status && (
              <div className="flex items-center gap-2 py-5 text-[11px] text-aegis-text-muted">
                <LoaderCircle size={14} className="animate-spin" />
                <span>{t('chat.browserControl.loading')}</span>
              </div>
            )}

            {browser.error && (
              <div className="mb-3 space-y-2 rounded-md border border-aegis-danger/25 bg-aegis-danger/5 px-3 py-2.5 text-[11px] text-aegis-text-muted">
                <p>{t('chat.browserControl.error')}</p>
                <p className="break-words text-[10px] text-aegis-text-dim">{browser.error}</p>
                <button
                  type="button"
                  onClick={() => { void browser.refresh(); }}
                  className="rounded-md border border-aegis-border px-2 py-1 text-[10px] text-aegis-text-secondary transition-colors hover:border-aegis-border-hover hover:text-aegis-text"
                >
                  {t('chat.browserControl.retry')}
                </button>
              </div>
            )}

            {!browser.loading && !browser.error && browser.profiles.length === 0 && (
              <p className="py-4 text-center text-[11px] text-aegis-text-dim">{t('chat.browserControl.noProfiles')}</p>
            )}

            {browser.profiles.length > 0 && (
              <div className="space-y-3">
                <label className="block text-[10px] text-aegis-text-dim">
                  <span className="mb-1 block">{t('chat.browserControl.profile')}</span>
                  <span className="relative block">
                    <select
                      value={browser.profileName}
                      onChange={(event) => browser.setProfileName(event.target.value)}
                      disabled={busy}
                      className="w-full appearance-none rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.035)] px-2.5 py-2 pr-8 text-[11px] text-aegis-text outline-none focus:border-aegis-primary disabled:cursor-wait disabled:opacity-60"
                    >
                      {browser.profiles.map((profile) => (
                        <option key={profile.name} value={profile.name}>
                          {profile.name} · {profile.driver}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-aegis-text-dim" />
                  </span>
                </label>

                <div className="flex items-center justify-between gap-3 rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.035)] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-aegis-text">
                      <span className={clsx('size-1.5 rounded-full', browser.status?.running ? 'bg-aegis-success' : 'bg-aegis-text-dim')} />
                      {browser.status?.running ? t('chat.browserControl.running') : t('chat.browserControl.stopped')}
                    </div>
                    <p className="mt-1 text-[10px] text-aegis-text-dim">
                      {browser.status?.pageReady ? t('chat.browserControl.ready') : t('chat.browserControl.notReady')}
                    </p>
                  </div>
                  {browser.status?.running ? (
                    <button
                      type="button"
                      onClick={() => { void browser.stop(); }}
                      disabled={busy}
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-aegis-border px-2.5 text-[10px] font-medium text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] disabled:cursor-wait disabled:opacity-60"
                    >
                      {browser.operation === 'stop' ? <LoaderCircle size={12} className="animate-spin" /> : <CircleStop size={12} />}
                      {t('chat.browserControl.stop')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { void browser.start(); }}
                      disabled={busy}
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-aegis-primary/30 bg-aegis-primary/10 px-2.5 text-[10px] font-medium text-aegis-primary transition-colors hover:bg-aegis-primary/15 disabled:cursor-wait disabled:opacity-60"
                    >
                      {browser.operation === 'start' ? <LoaderCircle size={12} className="animate-spin" /> : <Play size={12} />}
                      {t('chat.browserControl.start')}
                    </button>
                  )}
                </div>

                <div className="rounded-md border border-aegis-border p-2.5">
                  <p className="mb-2 text-[10px] font-medium text-aegis-text-secondary">{t('chat.browserControl.openUrl')}</p>
                  <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.62fr)_auto]">
                    <input
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder={t('chat.browserControl.urlPlaceholder')}
                      inputMode="url"
                      disabled={busy}
                      className="min-w-0 rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.035)] px-2 py-1.5 text-[10px] text-aegis-text outline-none placeholder:text-aegis-text-dim focus:border-aegis-primary disabled:cursor-wait"
                    />
                    <input
                      value={label}
                      onChange={(event) => setLabel(event.target.value)}
                      placeholder={t('chat.browserControl.tabLabelPlaceholder')}
                      disabled={busy}
                      className="min-w-0 rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.035)] px-2 py-1.5 text-[10px] text-aegis-text outline-none placeholder:text-aegis-text-dim focus:border-aegis-primary disabled:cursor-wait"
                    />
                    <button
                      type="button"
                      onClick={submitOpen}
                      disabled={!url.trim() || busy}
                      title={t('chat.browserControl.openTab')}
                      aria-label={t('chat.browserControl.openTab')}
                      className="grid size-7 place-items-center rounded-md border border-aegis-primary/30 bg-aegis-primary/10 text-aegis-primary transition-colors hover:bg-aegis-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {browser.operation === 'open' ? <LoaderCircle size={12} className="animate-spin" /> : <PanelTop size={12} />}
                    </button>
                  </div>
                </div>

                <section className="rounded-md border border-aegis-border">
                  <header className="flex items-center justify-between gap-2 border-b border-aegis-border px-2.5 py-2">
                    <h3 className="text-[10px] font-medium text-aegis-text-secondary">{t('chat.browserControl.tabs')}</h3>
                    <button
                      type="button"
                      onClick={() => confirmExistingSession(async () => { await browser.snapshot(); })}
                      disabled={!browser.status?.running || busy}
                      title={t('chat.browserControl.snapshot')}
                      aria-label={t('chat.browserControl.snapshot')}
                      className="grid size-6 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {browser.operation === 'snapshot' ? <LoaderCircle size={11} className="animate-spin" /> : <Camera size={11} />}
                    </button>
                  </header>
                  {browser.tabs.length === 0 ? (
                    <p className="px-2.5 py-3 text-[10px] text-aegis-text-dim">{t('chat.browserControl.noTabs')}</p>
                  ) : (
                    <div className="max-h-44 overflow-y-auto px-2.5">
                      {browser.tabs.map((tab) => {
                        const reference = tab.suggestedTargetId ?? tab.tabId ?? tab.targetId;
                        return (
                          <div key={tab.targetId} className="flex min-w-0 items-center gap-2 border-b border-[rgb(var(--aegis-overlay)/0.05)] py-2 last:border-b-0">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[10px] font-medium text-aegis-text" title={tab.title ?? tab.url}>{tab.label ?? tab.title ?? tab.url ?? reference}</p>
                              {tab.url && <p className="mt-0.5 truncate text-[9px] text-aegis-text-dim" title={tab.url}>{tab.url}</p>}
                            </div>
                            <button
                              type="button"
                              onClick={() => confirmExistingSession(async () => { await browser.focus(reference); })}
                              disabled={busy}
                              title={t('chat.browserControl.focusTab')}
                              aria-label={t('chat.browserControl.focusTab')}
                              className="grid size-6 shrink-0 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-primary/10 hover:text-aegis-primary disabled:cursor-wait disabled:opacity-50"
                            >
                              <Focus size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={() => confirmExistingSession(async () => { await browser.close(reference); })}
                              disabled={busy}
                              title={t('chat.browserControl.closeTab')}
                              aria-label={t('chat.browserControl.closeTab')}
                              className="grid size-6 shrink-0 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-danger/10 hover:text-aegis-danger disabled:cursor-wait disabled:opacity-50"
                            >
                              <X size={11} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {snapshot !== null && (
                  <section className="rounded-md border border-aegis-border">
                    <h3 className="border-b border-aegis-border px-2.5 py-2 text-[10px] font-medium text-aegis-text-secondary">{t('chat.browserControl.snapshotTitle')}</h3>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words p-2.5 font-mono text-[9px] leading-relaxed text-aegis-text-muted">{snapshot}</pre>
                  </section>
                )}

                <p className="text-[10px] leading-relaxed text-aegis-text-dim">{t('chat.browserControl.advancedHint')}</p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
