import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  FolderOpen,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { PageTransition } from '@/components/shared/PageTransition';
import type { OpenClawWorkspaceMemoryItem } from '@/services/openclawWorkspaceMemory';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { useOpenClawWorkspaceMemories } from './useOpenClawWorkspaceMemories';
import { useOpenClawMemoryDiagnostics } from './useOpenClawMemoryDiagnostics';
import type { MemoryRemHarnessResult, MemoryStatusResult } from '@/services/gateway/memoryDoctor';

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

function formatCount(value: number | undefined, language: string): string {
  if (value === undefined) return '-';
  return new Intl.NumberFormat(language).format(value);
}

function MemoryDiagnosticsPanel({
  status,
  remHarness,
  loading,
  statusError,
  remHarnessError,
  language,
}: {
  status: MemoryStatusResult | null;
  remHarness: MemoryRemHarnessResult | null;
  loading: boolean;
  statusError: string | null;
  remHarnessError: string | null;
  language: string;
}) {
  const { t } = useTranslation();
  const dreaming = status?.dreaming;
  const remSuccess = remHarness?.ok === true ? remHarness : null;
  const remFailure = remHarness?.ok === false ? remHarness : null;
  const phaseRows = dreaming
    ? [
      ['light', dreaming.phases.light],
      ['deep', dreaming.phases.deep],
      ['rem', dreaming.phases.rem],
    ] as const
    : [];

  return (
    <section className="shrink-0 border-b border-aegis-border bg-aegis-surface px-6 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-aegis-text-dim">
            {t('memoryExplorer.gatewayDiagnostics', 'OpenClaw Gateway diagnostics')}
          </p>
          <p className="mt-1 text-sm text-aegis-text-dim">
            {status?.agentId
              ? t('memoryExplorer.gatewayAgent', 'Agent: {{agentId}}', { agentId: status.agentId })
              : t('memoryExplorer.gatewayDiagnosticsReadOnly', 'Read-only status from the selected Gateway')}
          </p>
        </div>
        {loading && <LoadingIndicator size={18} />}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-md border border-aegis-border bg-aegis-bg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-aegis-text">
            {status?.embedding.ok ? (
              <CheckCircle2 size={16} className="text-aegis-success" aria-hidden="true" />
            ) : (
              <AlertCircle size={16} className="text-aegis-danger" aria-hidden="true" />
            )}
            {t('memoryExplorer.embeddingStatus', 'Embedding readiness')}
          </div>
          <p className="mt-2 text-sm text-aegis-text-dim">
            {status
              ? status.embedding.ok
                ? t('memoryExplorer.embeddingReady', 'Ready')
                : status.embedding.error || t('memoryExplorer.embeddingUnavailable', 'Unavailable')
              : statusError || t('memoryExplorer.gatewayUnavailable', 'Gateway diagnostics unavailable')}
          </p>
          {status?.provider && (
            <p className="mt-1 text-xs text-aegis-text-dim">
              {t('memoryExplorer.embeddingProvider', 'Provider: {{provider}}', { provider: status.provider })}
            </p>
          )}
          {dreaming && (
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-aegis-border pt-3 text-xs text-aegis-text-dim">
              <span>{t('memoryExplorer.totalSignals', 'Signals')}</span>
              <span className="text-end text-aegis-text">{formatCount(dreaming.totalSignalCount, language)}</span>
              <span>{t('memoryExplorer.promotedMemory', 'Promoted')}</span>
              <span className="text-end text-aegis-text">{formatCount(dreaming.promotedTotal, language)}</span>
              <span>{t('memoryExplorer.promotedToday', 'Promoted today')}</span>
              <span className="text-end text-aegis-text">{formatCount(dreaming.promotedToday, language)}</span>
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-md border border-aegis-border bg-aegis-bg p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-aegis-text">
              {t('memoryExplorer.dreamingPhases', 'Dreaming phases')}
            </p>
            {dreaming && (
              <span className="text-xs text-aegis-text-dim">
                {dreaming.enabled ? t('memoryExplorer.enabled', 'Enabled') : t('memoryExplorer.disabled', 'Disabled')}
              </span>
            )}
          </div>
          {phaseRows.length > 0 ? (
            <div className="mt-3 divide-y divide-aegis-border text-xs">
              {phaseRows.map(([name, phase]) => (
                <div key={name} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="text-aegis-text-dim">{name}</span>
                  <span className={phase.enabled ? 'text-aegis-success' : 'text-aegis-text-dim'}>
                    {phase.enabled ? t('memoryExplorer.phaseReady', 'enabled') : t('memoryExplorer.phaseDisabled', 'disabled')}
                    {phase.managedCronPresent ? ` · ${t('memoryExplorer.cronManaged', 'cron managed')}` : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-aegis-text-dim">
              {statusError || t('memoryExplorer.noDreamingStatus', 'Dreaming status was not returned by Gateway')}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 rounded-md border border-aegis-border bg-aegis-bg p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-aegis-text">
            {t('memoryExplorer.remHarnessPreview', 'REM harness preview')}
          </p>
          {remSuccess && (
            <span className="text-xs text-aegis-text-dim">
              {t('memoryExplorer.remCandidateCount', '{{count}} candidates', {
                count: remSuccess.deep.candidates.length,
              })}
            </span>
          )}
        </div>
        {remSuccess ? (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="min-w-0">
              <p className="text-xs text-aegis-text-dim">
                {t('memoryExplorer.remTruths', 'Candidate truths')}
              </p>
              {remSuccess.rem.candidateTruths.length > 0 ? (
                <ul className="mt-2 space-y-2 text-sm text-aegis-text">
                  {remSuccess.rem.candidateTruths.slice(0, 3).map((entry, index) => (
                    <li key={`${entry.snippet}-${index}`} className="line-clamp-2">
                      {entry.snippet}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-aegis-text-dim">{t('memoryExplorer.noRemTruths', 'No candidate truths')}</p>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-aegis-text-dim">
                {t('memoryExplorer.deepCandidates', 'Deep candidates')}
              </p>
              {remSuccess.deep.candidates.length > 0 ? (
                <ul className="mt-2 space-y-2 text-sm text-aegis-text">
                  {remSuccess.deep.candidates.slice(0, 3).map((candidate) => (
                    <li key={candidate.key} className="min-w-0">
                      <p className="truncate">{candidate.snippet || candidate.path}</p>
                      <p className="mt-0.5 truncate text-xs text-aegis-text-dim" title={candidate.path}>
                        {candidate.path} · {t('memoryExplorer.recallCount', '{{count}} recalls', { count: candidate.recallCount })}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-aegis-text-dim">{t('memoryExplorer.noDeepCandidates', 'No deep candidates')}</p>
              )}
            </div>
          </div>
        ) : remFailure ? (
          <p className="mt-2 text-sm text-aegis-danger">{remFailure.error}</p>
        ) : (
          <p className="mt-2 text-sm text-aegis-text-dim">
            {remHarnessError || t('memoryExplorer.remUnavailable', 'REM preview unavailable')}
          </p>
        )}
      </div>
    </section>
  );
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
  const {
    status: diagnosticsStatus,
    remHarness,
    loading: diagnosticsLoading,
    statusError: diagnosticsStatusError,
    remHarnessError: diagnosticsRemHarnessError,
    refresh: refreshDiagnostics,
  } = useOpenClawMemoryDiagnostics();
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
            onClick={() => {
              void refresh();
              void refreshDiagnostics();
            }}
            disabled={loading || diagnosticsLoading}
            title={t('common.refresh', 'Refresh')}
            aria-label={t('common.refresh', 'Refresh')}
            className="grid h-9 w-9 place-items-center rounded-md border border-aegis-border text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
        </header>

        <MemoryDiagnosticsPanel
          status={diagnosticsStatus}
          remHarness={remHarness}
          loading={diagnosticsLoading}
          statusError={diagnosticsStatusError}
          remHarnessError={diagnosticsRemHarnessError}
          language={i18n.language}
        />

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
