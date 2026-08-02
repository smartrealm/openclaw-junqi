import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, FolderOpen, RefreshCw, Search, X } from 'lucide-react';
import { PageTransition } from '@/components/shared/PageTransition';
import type { OpenClawWorkspaceMemoryItem } from '@/services/openclawWorkspaceMemory';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { useOpenClawWorkspaceMemories } from './useOpenClawWorkspaceMemories';

function displayTitle(item: OpenClawWorkspaceMemoryItem): string {
  const firstLine = item.content
    .split('\n')
    .find((line) => line.trim().length > 0)
    ?.replace(/^\s*[#>*-]+\s*/, '')
    .trim();
  return firstLine || item.name;
}

function displayTimestamp(value: string | undefined, language: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function MemoryDetail({
  item,
  language,
  onClose,
}: {
  item: OpenClawWorkspaceMemoryItem | null;
  language: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!item) return null;
  const timestamp = displayTimestamp(item.recordedAt, language);
  const sourceLabel = item.kind === 'primary'
    ? t('memoryExplorer.primaryMemory', 'Primary memory')
    : t('memoryExplorer.sessionMemory', 'Session memory');

  return (
    <aside className="flex w-full shrink-0 flex-col border-s border-aegis-border bg-aegis-surface lg:w-[420px]">
      <header className="flex items-start justify-between gap-3 border-b border-aegis-border px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs text-aegis-text-dim">{sourceLabel}</p>
          <h2 className="mt-1 truncate text-base font-semibold text-aegis-text">{displayTitle(item)}</h2>
          <p className="mt-1 truncate font-mono text-[11px] text-aegis-text-dim" title={item.path}>{item.path}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          title={t('common.close', 'Close')}
          aria-label={t('common.close', 'Close')}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {timestamp && <p className="mb-4 text-xs text-aegis-text-dim">{timestamp}</p>}
        <pre className="whitespace-pre-wrap break-words font-[var(--font-editor,var(--font-mono))] text-sm leading-6 text-aegis-text">
          {item.content}
        </pre>
      </div>
    </aside>
  );
}

export function MemoryExplorerPage() {
  const { t, i18n } = useTranslation();
  const { snapshot, loading, error, refresh } = useOpenClawWorkspaceMemories();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = snapshot?.items ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const normalizedQuery = query.trim().toLocaleLowerCase(i18n.language);
  const filtered = useMemo(() => {
    if (!normalizedQuery) return items;
    return items.filter((item) => (
      item.name.toLocaleLowerCase(i18n.language).includes(normalizedQuery)
      || item.content.toLocaleLowerCase(i18n.language).includes(normalizedQuery)
    ));
  }, [i18n.language, items, normalizedQuery]);

  return (
    <PageTransition>
      <main className="flex min-h-0 flex-1 flex-col bg-aegis-bg">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-aegis-border px-6 py-4">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-aegis-text">{t('memoryExplorer.title', 'Memory Explorer')}</h1>
            <p className="mt-1 truncate text-sm text-aegis-text-dim" title={snapshot?.workspacePath}>
              {snapshot?.workspacePath ?? t('memoryExplorer.workspaceLoading', 'Loading OpenClaw workspace memory')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            title={t('common.refresh', 'Refresh')}
            aria-label={t('common.refresh', 'Refresh')}
            className="grid h-9 w-9 place-items-center rounded-md border border-aegis-border text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <section className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
            <label className="relative mb-5 block max-w-xl">
              <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-aegis-text-dim" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('memoryExplorer.searchWorkspace', 'Search workspace memory')}
                className="h-10 w-full rounded-md border border-aegis-border bg-aegis-surface ps-10 pe-3 text-sm text-aegis-text outline-none placeholder:text-aegis-text-dim focus:border-aegis-primary"
              />
            </label>

            {loading ? (
              <div className="grid min-h-48 place-items-center"><LoadingIndicator size={24} /></div>
            ) : error ? (
              <div className="max-w-2xl rounded-md border border-aegis-danger/30 bg-aegis-danger/10 px-4 py-3 text-sm text-aegis-text">
                <p className="font-medium">{t('memoryExplorer.loadFailed', 'Unable to load workspace memory')}</p>
                <p className="mt-1 text-aegis-text-dim">{error}</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="grid min-h-48 place-items-center rounded-md border border-dashed border-aegis-border px-5 text-center text-sm text-aegis-text-dim">
                <div>
                  <FolderOpen size={24} className="mx-auto mb-3" aria-hidden="true" />
                  <p>{query ? t('memoryExplorer.noSearchResults', 'No matching memory files') : t('memoryExplorer.noWorkspaceMemory', 'No MEMORY.md or memory/*.md files in this OpenClaw workspace')}</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {filtered.map((item) => {
                  const timestamp = displayTimestamp(item.recordedAt, i18n.language);
                  const sourceLabel = item.kind === 'primary'
                    ? t('memoryExplorer.primaryMemory', 'Primary memory')
                    : t('memoryExplorer.sessionMemory', 'Session memory');
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className="min-w-0 rounded-md border border-aegis-border bg-aegis-surface p-4 text-start transition-colors hover:border-aegis-primary hover:bg-aegis-hover"
                    >
                      <div className="flex items-start gap-3">
                        <FileText size={18} className="mt-0.5 shrink-0 text-aegis-primary" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-aegis-text">{displayTitle(item)}</p>
                          <p className="mt-1 text-xs text-aegis-text-dim">{sourceLabel}{timestamp ? ` · ${timestamp}` : ''}</p>
                          <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-5 text-aegis-text-dim">{item.content}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
          <MemoryDetail item={selected} language={i18n.language} onClose={() => setSelectedId(null)} />
        </div>
      </main>
    </PageTransition>
  );
}
