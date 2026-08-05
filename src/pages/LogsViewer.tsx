import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageTransition } from '@/components/shared/PageTransition';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { useOpenClawSessionUsageLogs } from '@/hooks/useOpenClawSessionUsageLogs';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore, type SessionInfo } from '@/stores/gatewayDataStore';
import type {
  OpenClawSessionUsageLogEntry,
  OpenClawSessionUsageLogRole,
} from '@/services/gateway/OpenClawSessionUsageLogsClient';
import { formatTokens } from '@/utils/format';

interface SessionOption {
  readonly key: string;
  readonly label: string;
}

export function resolveSessionUsageLogSelection(
  activeSessionKey: string | null | undefined,
  sessions: readonly SessionInfo[],
): { readonly options: readonly SessionOption[]; readonly preferredKey: string | null } {
  const options = sessions.flatMap((session) => {
    const key = session.key.trim();
    if (!key) return [];
    const label = typeof session.label === 'string' && session.label.trim() ? session.label.trim() : key;
    return [{ key, label }];
  });
  const activeKey = activeSessionKey?.trim() || null;
  if (activeKey && !options.some((option) => option.key === activeKey)) {
    options.unshift({ key: activeKey, label: activeKey });
  }
  return { options, preferredKey: activeKey ?? options[0]?.key ?? null };
}

function roleTone(role: OpenClawSessionUsageLogRole): string {
  switch (role) {
    case 'user': return 'border-aegis-primary/30 bg-aegis-primary/10 text-aegis-primary';
    case 'assistant': return 'border-aegis-success/30 bg-aegis-success/10 text-aegis-success';
    case 'tool': return 'border-aegis-warning/30 bg-aegis-warning/10 text-aegis-warning';
    case 'toolResult': return 'border-aegis-border bg-aegis-bg/60 text-aegis-text-muted';
  }
}

function formatTimestamp(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}

function UsageLogRow({ entry, locale }: { entry: OpenClawSessionUsageLogEntry; locale: string }) {
  const { t } = useTranslation();
  return (
    <article className="border-b border-aegis-border/35 px-4 py-3 last:border-b-0 sm:px-5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <time className="font-mono text-[11px] tabular-nums text-aegis-text-dim">
          {formatTimestamp(entry.timestamp, locale)}
        </time>
        <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${roleTone(entry.role)}`}>
          {t(`logsViewer.roles.${entry.role}`)}
        </span>
        {entry.tokens !== undefined && (
          <span className="font-mono text-[10px] tabular-nums text-aegis-text-dim">
            {t('logsViewer.tokens', { value: formatTokens(entry.tokens) })}
          </span>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-aegis-text-secondary">
        {entry.content}
      </p>
    </article>
  );
}

export function LogsViewerPage() {
  const { t, i18n } = useTranslation();
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const sessions = useGatewayDataStore((state) => state.sessions);
  const selection = useMemo(
    () => resolveSessionUsageLogSelection(activeSessionKey, sessions),
    [activeSessionKey, sessions],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    setSelectedKey((current) => {
      if (current && selection.options.some((option) => option.key === current)) return current;
      return selection.preferredKey;
    });
  }, [selection]);

  const usageLogs = useOpenClawSessionUsageLogs(selectedKey);

  return (
    <PageTransition className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-aegis-border/55 px-4 py-3 sm:px-5">
        <div className="min-w-0 flex items-center gap-2">
          <ScrollText size={18} className="shrink-0 text-aegis-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold text-aegis-text">{t('logsViewer.title')}</h1>
            <p className="text-[11px] text-aegis-text-dim">{t('logsViewer.description')}</p>
          </div>
        </div>

        <label className="ml-auto flex min-w-0 items-center gap-2 text-[11px] text-aegis-text-dim">
          <span className="shrink-0">{t('logsViewer.session')}</span>
          <select
            value={selectedKey ?? ''}
            onChange={(event) => setSelectedKey(event.target.value || null)}
            disabled={selection.options.length === 0}
            className="h-8 max-w-[260px] rounded-md border border-aegis-border bg-aegis-input px-2 text-[12px] text-aegis-text outline-none transition-colors focus:border-aegis-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {selection.options.length === 0 && <option value="">{t('logsViewer.noSession')}</option>}
            {selection.options.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => void usageLogs.refresh()}
          disabled={!selectedKey || usageLogs.loading}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-aegis-border/70 text-aegis-text-dim transition-colors hover:border-aegis-primary/60 hover:text-aegis-primary disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t('logsViewer.refresh')}
          title={t('logsViewer.refresh')}
        >
          {usageLogs.loading ? <LoadingIndicator size={13} /> : <RefreshCw size={14} aria-hidden="true" />}
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {!selectedKey && (
          <div className="flex h-full min-h-[180px] items-center justify-center px-6 text-center text-[12px] text-aegis-text-muted">
            {t('logsViewer.noSession')}
          </div>
        )}

        {selectedKey && usageLogs.loading && usageLogs.logs.length === 0 && (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-3 text-[12px] text-aegis-text-muted">
            <LoadingIndicator size={20} />
            {t('logsViewer.loading')}
          </div>
        )}

        {selectedKey && !usageLogs.loading && usageLogs.failure && (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 px-6 text-center">
            <ScrollText size={22} className="text-aegis-warning" aria-hidden="true" />
            <p className="text-[12px] text-aegis-warning">
              {usageLogs.failure === 'unavailable'
                ? t('logsViewer.unavailable')
                : t('logsViewer.invalid')}
            </p>
          </div>
        )}

        {selectedKey && !usageLogs.loading && !usageLogs.failure && usageLogs.logs.length === 0 && (
          <div className="flex h-full min-h-[180px] items-center justify-center px-6 text-center text-[12px] text-aegis-text-muted">
            {t('logsViewer.empty')}
          </div>
        )}

        {usageLogs.logs.length > 0 && (
          <section aria-label={t('logsViewer.entries')}>
            {usageLogs.logs.map((entry, index) => (
              <UsageLogRow key={`${entry.timestamp}-${entry.role}-${index}`} entry={entry} locale={i18n.language} />
            ))}
          </section>
        )}
      </main>

      <footer className="flex shrink-0 items-center gap-3 border-t border-aegis-border/45 px-4 py-2 font-mono text-[11px] text-aegis-text-dim sm:px-5">
        <span>{t('logsViewer.entries', { count: usageLogs.logs.length })}</span>
        <span className="min-w-0 flex-1 truncate text-right">{selectedKey ?? ''}</span>
      </footer>
    </PageTransition>
  );
}
