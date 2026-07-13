import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  BookOpenText,
  Bot,
  ChevronDown,
  Clock,
  ExternalLink,
  KeyRound,
  MessageSquare,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { CopyButton } from '@/components/shared/copy-button';
import { PageTransition } from '@/components/shared/PageTransition';
import { useNotificationStore } from '@/stores/notificationStore';
import { OPENCLAW_CLI_INDEX_URL, OPENCLAW_COMMANDS } from './commands';
import {
  OPENCLAW_COMMAND_CATEGORIES,
  type OpenClawCommandCategory,
  type OpenClawCommandImpact,
} from './types';

type CategoryFilter = 'all' | OpenClawCommandCategory;

const IMPACT_STYLES: Record<OpenClawCommandImpact, string> = {
  read: 'border-aegis-success/25 bg-aegis-success/10 text-aegis-success',
  live: 'border-aegis-primary/25 bg-aegis-primary/10 text-aegis-primary',
  action: 'border-aegis-warning/30 bg-aegis-warning/10 text-aegis-warning',
  mixed: 'border-aegis-border bg-aegis-overlay/[0.04] text-aegis-text-secondary',
};

const CATEGORY_ICONS = {
  setup: Settings2,
  gateway: Server,
  diagnostics: Activity,
  models: Bot,
  auth: KeyRound,
  channels: MessageSquare,
  automation: Clock,
} as const;

function isCommandCategory(value: string | null): value is OpenClawCommandCategory {
  return OPENCLAW_COMMAND_CATEGORIES.some((category) => category === value);
}

async function openOfficialDocs(url: string): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function OpenClawCommandsPage() {
  const { t } = useTranslation();
  const addToast = useNotificationStore((state) => state.addToast);
  const [query, setQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedCategory = searchParams.get('category');
  const category: CategoryFilter = isCommandCategory(requestedCategory) ? requestedCategory : 'all';
  const categoryOptions: readonly CategoryFilter[] = ['all', ...OPENCLAW_COMMAND_CATEGORIES];

  const filteredCommands = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return OPENCLAW_COMMANDS.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (!needle) return true;
      const summary = t(item.summaryKey);
      return [item.command, summary, ...item.keywords]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [category, query, t]);

  const groupedCommands = useMemo(() => OPENCLAW_COMMAND_CATEGORIES
    .map((categoryId) => ({
      categoryId,
      commands: filteredCommands.filter((item) => item.category === categoryId),
    }))
    .filter((group) => group.commands.length > 0), [filteredCommands]);

  const selectCategory = (nextCategory: CategoryFilter) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextCategory === 'all') nextParams.delete('category');
    else nextParams.set('category', nextCategory);
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <PageTransition className="min-h-full bg-aegis-bg">
      <div className="min-h-full">
        <header className="sticky top-0 z-10 border-b border-aegis-border bg-aegis-bg">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-aegis-primary/12 text-aegis-primary ring-1 ring-inset ring-aegis-primary/20">
                  <BookOpenText size={18} />
                </span>
                <div className="min-w-0">
                  <h1 className="truncate text-[18px] font-semibold leading-6 text-aegis-text">
                    {t('openclawCommands.title')}
                  </h1>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-aegis-text-dim">
                    <ShieldCheck size={12.5} className="shrink-0 text-aegis-success" />
                    <span className="truncate">{t('openclawCommands.verifiedSource')}</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void openOfficialDocs(OPENCLAW_CLI_INDEX_URL)}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 self-start rounded-md border border-aegis-border bg-aegis-surface px-3 text-[12px] font-medium text-aegis-text-secondary transition-colors hover:border-aegis-primary/35 hover:text-aegis-primary active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40 sm:self-auto"
              >
                <ExternalLink size={13.5} />
                {t('openclawCommands.officialIndex')}
              </button>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(180px,240px)_auto]">
              <div className="relative min-w-0">
                <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-aegis-text-dim" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('openclawCommands.searchPlaceholder')}
                  aria-label={t('openclawCommands.searchLabel')}
                  className="h-10 w-full rounded-md border border-aegis-border bg-aegis-surface ps-9 pe-9 text-[13px] text-aegis-text outline-none transition-colors placeholder:text-aegis-text-dim focus:border-aegis-primary/60 focus:ring-2 focus:ring-aegis-primary/15"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute end-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-aegis-text-dim transition-colors hover:bg-aegis-hover/40 hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35"
                    aria-label={t('openclawCommands.clearSearch')}
                    title={t('openclawCommands.clearSearch')}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <label className="relative block min-w-0">
                <span className="sr-only">{t('openclawCommands.categoryLabel')}</span>
                <select
                  value={category}
                  onChange={(event) => selectCategory(event.target.value as CategoryFilter)}
                  className="h-10 w-full appearance-none rounded-md border border-aegis-border bg-aegis-surface ps-3 pe-8 text-[12.5px] font-medium text-aegis-text-secondary outline-none transition-colors focus:border-aegis-primary/60 focus:ring-2 focus:ring-aegis-primary/15"
                >
                  {categoryOptions.map((option) => (
                    <option key={option} value={option}>
                      {t(`openclawCommands.categories.${option}`)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-aegis-text-dim" />
              </label>

              <div className="flex h-10 items-center justify-start px-1 text-[11.5px] tabular-nums text-aegis-text-dim sm:justify-end sm:px-0">
                {t('openclawCommands.resultCount', { count: filteredCommands.length })}
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 lg:px-8">
          {groupedCommands.length === 0 ? (
            <div className="py-16 text-center">
              <Search size={20} className="mx-auto text-aegis-text-dim" />
              <p className="mt-3 text-[13px] text-aegis-text-secondary">{t('openclawCommands.empty')}</p>
            </div>
          ) : (
            <div className="space-y-7 pb-8">
              {groupedCommands.map((group) => {
                const CategoryIcon = CATEGORY_ICONS[group.categoryId];
                return (
                  <section key={group.categoryId} aria-labelledby={`openclaw-command-group-${group.categoryId}`}>
                    <div className="mb-2.5 flex items-center gap-2">
                      <CategoryIcon size={14} className="shrink-0 text-aegis-primary" />
                      <h2 id={`openclaw-command-group-${group.categoryId}`} className="text-[13px] font-semibold text-aegis-text">
                        {t(`openclawCommands.categories.${group.categoryId}`)}
                      </h2>
                      <span className="text-[11px] tabular-nums text-aegis-text-dim">{group.commands.length}</span>
                      <span className="h-px min-w-6 flex-1 bg-aegis-border" aria-hidden="true" />
                    </div>

                    <div className="grid gap-2 2xl:grid-cols-2">
                      {group.commands.map((item) => (
                        <article
                          key={item.id}
                          className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border border-aegis-border bg-aegis-surface/45 px-4 py-3.5 transition-colors hover:border-aegis-primary/25 hover:bg-aegis-surface"
                        >
                          <div className="min-w-0">
                            <div className="flex min-h-7 min-w-0 flex-wrap items-start gap-2">
                              <code className="break-words font-mono text-[12.5px] font-semibold leading-5 text-aegis-text">
                                {item.command}
                              </code>
                              <span className={clsx('shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-4', IMPACT_STYLES[item.impact])}>
                                {t(`openclawCommands.impacts.${item.impact}`)}
                              </span>
                            </div>
                            <p className="mt-1 text-[12px] leading-5 text-aegis-text-secondary">
                              {t(item.summaryKey)}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-start gap-0.5">
                            <CopyButton
                              text={item.copyCommand ?? item.command}
                              onCopySuccess={(value) => addToast(
                                'task_complete',
                                t('openclawCommands.copySuccess'),
                                value,
                              )}
                              onCopyError={() => addToast(
                                'error',
                                t('openclawCommands.copyFailed'),
                                t('openclawCommands.copyFailedBody'),
                              )}
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8"
                              aria-label={t(item.copyCommand ? 'openclawCommands.copySafeTemplate' : 'openclawCommands.copyCommand')}
                              title={t(item.copyCommand ? 'openclawCommands.copySafeTemplate' : 'openclawCommands.copyCommand')}
                            />
                            <button
                              type="button"
                              onClick={() => void openOfficialDocs(item.docsUrl)}
                              className="flex h-8 w-8 items-center justify-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-primary/10 hover:text-aegis-primary active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35"
                              title={t('openclawCommands.openOfficialDocs')}
                              aria-label={t('openclawCommands.openOfficialDocs')}
                            >
                              <ExternalLink size={13.5} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </PageTransition>
  );
}
