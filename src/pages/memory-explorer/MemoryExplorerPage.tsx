import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  CircleAlert,
  Database,
  Eye,
  FileText,
  FolderOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { PageTransition } from '@/components/shared/PageTransition';
import type { OpenClawWorkspaceMemoryItem } from '@/services/openclawWorkspaceMemory';
import {
  previewOpenClawMemoryRemHarness,
  refreshOpenClawMemoryDiagnostics,
  searchOpenClawMemory,
  useGatewayDataStore,
} from '@/stores/gatewayDataStore';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { useOpenClawWorkspaceMemories } from './useOpenClawWorkspaceMemories';
import type { MemoryRemHarnessResult, MemoryStatusResult } from '@/services/gateway/memoryDoctor';

type MemoryView = 'workspace' | 'gateway' | 'diagnostics';

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

export function MemoryDiagnosticsLegacyPanel({
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

function nativeBooleanLabel(
  value: boolean | undefined,
  t: (key: string, fallback: string) => string,
): string | null {
  if (value === undefined) return null;
  return value ? t('memoryExplorer.yes', 'Yes') : t('memoryExplorer.no', 'No');
}

function MemoryDiagnosticsPanel() {
  const { t } = useTranslation();
  const status = useGatewayDataStore((state) => state.memoryDiagnostics);
  const statusLoading = useGatewayDataStore((state) => state.memoryDiagnosticsLoading);
  const statusError = useGatewayDataStore((state) => state.memoryDiagnosticsError);
  const remHarness = useGatewayDataStore((state) => state.memoryRemHarness);
  const remLoading = useGatewayDataStore((state) => state.memoryRemHarnessLoading);
  const remError = useGatewayDataStore((state) => state.memoryRemHarnessError);
  const [includeGrounded, setIncludeGrounded] = useState(false);
  const [includePromoted, setIncludePromoted] = useState(false);

  const statusErrorLabel = statusError === 'OPENCLAW_MEMORY_DIAGNOSTICS_UNSUPPORTED'
    ? t('memoryExplorer.diagnosticsUnsupported', 'This Gateway does not advertise memory diagnostics')
    : statusError === 'OPENCLAW_MEMORY_DIAGNOSTICS_UNAVAILABLE'
      ? t('memoryExplorer.diagnosticsUnavailable', 'Connect to an OpenClaw Gateway to inspect memory readiness')
      : statusError === 'OPENCLAW_MEMORY_DIAGNOSTICS_RESPONSE_INVALID'
        ? t('memoryExplorer.diagnosticsInvalid', 'The Gateway returned an invalid memory diagnostics response')
        : t('memoryExplorer.diagnosticsFailed', 'Gateway memory diagnostics failed');

  const remErrorLabel = remError === 'OPENCLAW_MEMORY_DIAGNOSTICS_UNSUPPORTED'
    ? t('memoryExplorer.remUnsupported', 'This Gateway does not advertise the REM harness preview')
    : remError === 'OPENCLAW_MEMORY_DIAGNOSTICS_UNAVAILABLE'
      ? t('memoryExplorer.diagnosticsUnavailable', 'Connect to an OpenClaw Gateway to inspect memory readiness')
      : remError === 'OPENCLAW_MEMORY_DIAGNOSTICS_RESPONSE_INVALID'
        ? t('memoryExplorer.diagnosticsInvalid', 'The Gateway returned an invalid memory diagnostics response')
        : t('memoryExplorer.remFailed', 'Gateway REM harness preview failed');

  return (
    <div className="max-w-5xl space-y-5">
      <section className="border-b border-aegis-border pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-aegis-text">
              <ShieldCheck size={18} aria-hidden="true" />
              <h2 className="text-base font-semibold">{t('memoryExplorer.diagnosticsTitle', 'OpenClaw memory diagnostics')}</h2>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-aegis-text-dim">
              {t('memoryExplorer.diagnosticsDescription', 'Read-only status from the connected Gateway. Status checks use cached readiness unless you explicitly request a provider probe.')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshOpenClawMemoryDiagnostics()}
            disabled={statusLoading}
            title={t('memoryExplorer.checkStatus', 'Check status')}
            aria-label={t('memoryExplorer.checkStatus', 'Check status')}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-aegis-border px-3 text-sm text-aegis-text-dim hover:border-aegis-primary hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={15} className={statusLoading ? 'animate-spin' : ''} aria-hidden="true" />
            {t('memoryExplorer.checkStatus', 'Check status')}
          </button>
        </div>

        {statusLoading ? (
          <div className="grid min-h-36 place-items-center"><LoadingIndicator size={24} /></div>
        ) : statusError ? (
          <div className="mt-5 max-w-2xl rounded-md border border-aegis-danger/30 bg-aegis-danger/10 px-4 py-3 text-sm text-aegis-text">
            <div className="flex items-start gap-2">
              <CircleAlert size={17} className="mt-0.5 shrink-0 text-aegis-danger" aria-hidden="true" />
              <div>
                <p className="font-medium">{statusErrorLabel}</p>
                <p className="mt-1 font-mono text-xs text-aegis-text-dim">{statusError}</p>
              </div>
            </div>
          </div>
        ) : !status ? (
          <div className="mt-5 grid min-h-36 place-items-center rounded-md border border-dashed border-aegis-border px-5 text-center text-sm text-aegis-text-dim">
            <div>
              <Activity size={24} className="mx-auto mb-3" aria-hidden="true" />
              <p>{t('memoryExplorer.diagnosticsHint', 'Check the Gateway to read native memory readiness.')}</p>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-md border border-aegis-border bg-aegis-surface p-4">
                <p className="text-xs text-aegis-text-dim">{t('memoryExplorer.embeddingReadiness', 'Embedding readiness')}</p>
                <div className="mt-2 flex items-center gap-2 text-sm text-aegis-text">
                  {status.embedding.ok
                    ? <CheckCircle2 size={17} className="text-aegis-success" aria-hidden="true" />
                    : <CircleAlert size={17} className="text-aegis-warning" aria-hidden="true" />}
                  {status.embedding.ok
                    ? t('memoryExplorer.available', 'Available')
                    : t('memoryExplorer.unavailable', 'Unavailable')}
                </div>
                {status.embedding.error && <p className="mt-2 break-words text-xs text-aegis-text-dim">{status.embedding.error}</p>}
              </div>
              <div className="rounded-md border border-aegis-border bg-aegis-surface p-4">
                <p className="text-xs text-aegis-text-dim">{t('memoryExplorer.provider', 'Provider')}</p>
                <p className="mt-2 break-words font-mono text-sm text-aegis-text">{status.provider ?? t('memoryExplorer.notReported', 'Not reported')}</p>
                <p className="mt-2 font-mono text-xs text-aegis-text-dim">{status.agentId}</p>
              </div>
              <div className="rounded-md border border-aegis-border bg-aegis-surface p-4">
                <p className="text-xs text-aegis-text-dim">{t('memoryExplorer.cacheState', 'Cache state')}</p>
                <div className="mt-2 space-y-1 text-sm text-aegis-text">
                  {status.embedding.checked !== undefined && <p>{t('memoryExplorer.checked', 'Checked')}: {nativeBooleanLabel(status.embedding.checked, t) ?? ''}</p>}
                  {status.embedding.cached !== undefined && <p>{t('memoryExplorer.cached', 'Cached')}: {nativeBooleanLabel(status.embedding.cached, t) ?? ''}</p>}
                  {status.embedding.checkedAtMs !== undefined && <p className="font-mono text-xs text-aegis-text-dim">{t('memoryExplorer.checkedAt', 'Checked at')}: {status.embedding.checkedAtMs}</p>}
                </div>
              </div>
            </div>
            {status.embeddingRuntime && (
              <div className="rounded-md border border-aegis-border bg-aegis-surface p-4">
                <p className="text-xs text-aegis-text-dim">{t('memoryExplorer.embeddingRuntime', 'Embedding runtime')}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-aegis-text-dim">
                  <span>{status.embeddingRuntime.engine}</span>
                  <span>{status.embeddingRuntime.state}</span>
                  {status.embeddingRuntime.backend && <span>{status.embeddingRuntime.backend}</span>}
                  {status.embeddingRuntime.buildType && <span>{status.embeddingRuntime.buildType}</span>}
                  {status.embeddingRuntime.context && <span>{t('memoryExplorer.contextSize', 'Context')}: {status.embeddingRuntime.context.requestedSize}</span>}
                </div>
                {status.embeddingRuntime.loadError && <p className="mt-2 break-words text-xs text-aegis-text-dim">{status.embeddingRuntime.loadError}</p>}
              </div>
            )}
          </div>
        )}
      </section>

      <section>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-aegis-text">
              <Eye size={18} aria-hidden="true" />
              <h2 className="text-base font-semibold">{t('memoryExplorer.remTitle', 'REM harness preview')}</h2>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-aegis-text-dim">
              {t('memoryExplorer.remDescription', 'Explicit, bounded preview returned by OpenClaw. It is read-only and remains separate from workspace browsing and memory search.')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void previewOpenClawMemoryRemHarness({
              ...(includeGrounded ? { grounded: true } : {}),
              ...(includePromoted ? { includePromoted: true } : {}),
            })}
            disabled={remLoading}
            title={t('memoryExplorer.previewRem', 'Preview REM harness')}
            aria-label={t('memoryExplorer.previewRem', 'Preview REM harness')}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-aegis-border px-3 text-sm text-aegis-text-dim hover:border-aegis-primary hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Eye size={15} aria-hidden="true" />
            {t('memoryExplorer.previewRem', 'Preview REM harness')}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-sm text-aegis-text-dim">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={includeGrounded} onChange={(event) => setIncludeGrounded(event.target.checked)} />
            {t('memoryExplorer.includeGrounded', 'Include grounded files')}
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={includePromoted} onChange={(event) => setIncludePromoted(event.target.checked)} />
            {t('memoryExplorer.includePromoted', 'Include promoted candidates')}
          </label>
        </div>

        {remLoading ? (
          <div className="grid min-h-36 place-items-center"><LoadingIndicator size={24} /></div>
        ) : remError ? (
          <div className="mt-5 max-w-2xl rounded-md border border-aegis-danger/30 bg-aegis-danger/10 px-4 py-3 text-sm text-aegis-text">
            <div className="flex items-start gap-2">
              <CircleAlert size={17} className="mt-0.5 shrink-0 text-aegis-danger" aria-hidden="true" />
              <div>
                <p className="font-medium">{remErrorLabel}</p>
                <p className="mt-1 font-mono text-xs text-aegis-text-dim">{remError}</p>
              </div>
            </div>
          </div>
        ) : !remHarness ? (
          <div className="mt-5 grid min-h-36 place-items-center rounded-md border border-dashed border-aegis-border px-5 text-center text-sm text-aegis-text-dim">
            <div>
              <Eye size={24} className="mx-auto mb-3" aria-hidden="true" />
              <p>{t('memoryExplorer.remHint', 'Run an explicit preview to inspect the native REM harness output.')}</p>
            </div>
          </div>
        ) : !remHarness.ok ? (
          <div className="mt-5 rounded-md border border-aegis-warning/30 bg-aegis-warning/10 px-4 py-3 text-sm text-aegis-text">
            <p className="font-medium">{t('memoryExplorer.remNativeError', 'OpenClaw reported a REM harness error')}</p>
            <p className="mt-1 break-words text-aegis-text-dim">{remHarness.error}</p>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-aegis-text-dim">
              <span>{t('memoryExplorer.agent', 'Agent')}: {remHarness.agentId}</span>
              <span className="break-all font-mono" title={remHarness.workspaceDir}>{remHarness.workspaceDir}</span>
              <span>{t('memoryExplorer.remSourceEntries', 'Source entries')}: {remHarness.rem.sourceEntryCount}</span>
              <span>{t('memoryExplorer.remCandidates', 'Candidates')}: {remHarness.deep.candidates.length}</span>
              {remHarness.deep.truncated && <span className="text-aegis-warning">{t('memoryExplorer.remTruncated', 'Preview truncated')}</span>}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {remHarness.deep.candidates.map((candidate) => (
                <article key={candidate.key} className="rounded-md border border-aegis-border bg-aegis-surface p-4">
                  <p className="truncate font-mono text-xs text-aegis-text" title={candidate.path}>{candidate.path}</p>
                  <p className="mt-1 text-xs text-aegis-text-dim">
                    {t('memoryExplorer.nativeLines', 'Lines {{start}}-{{end}}', { start: candidate.startLine, end: candidate.endLine })}
                    {' · '}{t('memoryExplorer.remScore', 'Average {{score}}', { score: candidate.avgScore.toFixed(3) })}
                    {' · '}{candidate.promoted ? t('memoryExplorer.promoted', 'Promoted') : t('memoryExplorer.notPromoted', 'Not promoted')}
                  </p>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-5 text-aegis-text-dim">{candidate.snippet}</p>
                </article>
              ))}
            </div>
            {remHarness.rem.candidateTruths.length > 0 && (
              <div className="rounded-md border border-aegis-border bg-aegis-surface p-4">
                <p className="text-xs text-aegis-text-dim">{t('memoryExplorer.remTruths', 'Candidate truths')}</p>
                <ul className="mt-3 space-y-2 text-sm text-aegis-text-dim">
                  {remHarness.rem.candidateTruths.map((truth, index) => (
                    <li key={`${truth.snippet}:${index}`} className="whitespace-pre-wrap break-words">{truth.snippet} <span className="font-mono text-xs">({truth.confidence.toFixed(3)})</span></li>
                  ))}
                </ul>
              </div>
            )}
            {remHarness.grounded && remHarness.grounded.files.length > 0 && (
              <div className="space-y-3">
                {remHarness.grounded.files.map((file) => (
                  <article key={file.path} className="rounded-md border border-aegis-border bg-aegis-surface p-4">
                    <p className="truncate font-mono text-xs text-aegis-text" title={file.path}>{file.path}</p>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm leading-5 text-aegis-text-dim">{file.renderedMarkdown}</pre>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export function MemoryExplorerPage() {
  const { t, i18n } = useTranslation();
  const { snapshot, loading, error, refresh } = useOpenClawWorkspaceMemories();
  const nativeSearch = useGatewayDataStore((state) => state.memorySearch);
  const nativeSearchLoading = useGatewayDataStore((state) => state.memorySearchLoading);
  const nativeSearchError = useGatewayDataStore((state) => state.memorySearchError);
  const nativeDiagnosticsLoading = useGatewayDataStore((state) => state.memoryDiagnosticsLoading);
  const nativeRemLoading = useGatewayDataStore((state) => state.memoryRemHarnessLoading);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<MemoryView>('workspace');
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

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (view === 'gateway') void searchOpenClawMemory(query);
  }

  const nativeErrorLabel = nativeSearchError === 'OPENCLAW_MEMORY_SEARCH_UNSUPPORTED'
    ? t('memoryExplorer.nativeUnsupported', 'This Gateway does not advertise memory.search')
    : nativeSearchError === 'OPENCLAW_MEMORY_SEARCH_UNAVAILABLE'
      ? t('memoryExplorer.nativeUnavailable', 'Connect to an OpenClaw Gateway to search indexed memory')
      : nativeSearchError === 'OPENCLAW_MEMORY_SEARCH_RESPONSE_INVALID'
        ? t('memoryExplorer.nativeInvalid', 'The Gateway returned an invalid memory.search response')
        : t('memoryExplorer.nativeFailed', 'Gateway memory search failed');

  return (
    <PageTransition>
      <main className="flex min-h-0 flex-1 flex-col bg-aegis-bg">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-aegis-border px-6 py-4">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-aegis-text">{t('memoryExplorer.title', 'Memory Explorer')}</h1>
            <p className="mt-1 truncate text-sm text-aegis-text-dim" title={view === 'workspace' ? snapshot?.workspacePath : view === 'gateway' ? nativeSearch?.provider : t('memoryExplorer.diagnosticsTitle', 'OpenClaw memory diagnostics')}>
              {view === 'workspace'
                ? (snapshot?.workspacePath ?? t('memoryExplorer.workspaceLoading', 'Loading OpenClaw workspace memory'))
                : view === 'gateway'
                  ? (nativeSearch?.provider ?? t('memoryExplorer.gatewaySearchHint', 'OpenClaw Gateway memory index'))
                  : t('memoryExplorer.diagnosticsTitle', 'OpenClaw memory diagnostics')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (view === 'workspace') void refresh();
              else if (view === 'gateway' && query.trim()) void searchOpenClawMemory(query);
              else if (view === 'diagnostics') void refreshOpenClawMemoryDiagnostics();
            }}
            disabled={view === 'workspace'
              ? loading
              : view === 'gateway'
                ? nativeSearchLoading || !query.trim()
                : nativeDiagnosticsLoading || nativeRemLoading}
            title={t('common.refresh', 'Refresh')}
            aria-label={t('common.refresh', 'Refresh')}
            className="grid h-9 w-9 place-items-center rounded-md border border-aegis-border text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading || nativeSearchLoading || nativeDiagnosticsLoading || nativeRemLoading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
        </header>

        <MemoryDiagnosticsPanel />

        <div className="flex min-h-0 flex-1">
          <section className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="mb-5 flex flex-wrap items-center gap-2" role="tablist" aria-label={t('memoryExplorer.viewModes', 'Memory views')}>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'workspace'}
                onClick={() => setView('workspace')}
                className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors ${view === 'workspace'
                  ? 'border-aegis-primary bg-aegis-primary/10 text-aegis-text'
                  : 'border-aegis-border text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text'}`}
              >
                <FileText size={15} aria-hidden="true" />
                {t('memoryExplorer.workspaceMode', 'Workspace files')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'gateway'}
                onClick={() => setView('gateway')}
                className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors ${view === 'gateway'
                  ? 'border-aegis-primary bg-aegis-primary/10 text-aegis-text'
                  : 'border-aegis-border text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text'}`}
              >
                <Database size={15} aria-hidden="true" />
                {t('memoryExplorer.gatewayMode', 'Gateway search')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'diagnostics'}
                onClick={() => setView('diagnostics')}
                className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors ${view === 'diagnostics'
                  ? 'border-aegis-primary bg-aegis-primary/10 text-aegis-text'
                  : 'border-aegis-border text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text'}`}
              >
                <ShieldCheck size={15} aria-hidden="true" />
                {t('memoryExplorer.diagnosticsMode', 'Gateway diagnostics')}
              </button>
            </div>

            {view !== 'diagnostics' && <form className="mb-5 flex max-w-xl gap-2" onSubmit={submitSearch}>
              <label className="relative block min-w-0 flex-1">
                <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-aegis-text-dim" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={view === 'workspace'
                    ? t('memoryExplorer.searchWorkspace', 'Search workspace memory')
                    : t('memoryExplorer.searchGateway', 'Search Gateway memory')}
                  className="h-10 w-full rounded-md border border-aegis-border bg-aegis-surface ps-10 pe-3 text-sm text-aegis-text outline-none placeholder:text-aegis-text-dim focus:border-aegis-primary"
                />
              </label>
              {view === 'gateway' && (
                <button
                  type="submit"
                  disabled={nativeSearchLoading || !query.trim()}
                  title={t('common.search', 'Search')}
                  aria-label={t('common.search', 'Search')}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-aegis-border bg-aegis-surface text-aegis-text-dim hover:border-aegis-primary hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Search size={16} aria-hidden="true" />
                </button>
              )}
            </form>}

            {view === 'diagnostics' ? (
              <MemoryDiagnosticsPanel />
            ) : view === 'gateway' ? (
              nativeSearchLoading ? (
                <div className="grid min-h-48 place-items-center"><LoadingIndicator size={24} /></div>
              ) : nativeSearchError ? (
                <div className="max-w-2xl rounded-md border border-aegis-danger/30 bg-aegis-danger/10 px-4 py-3 text-sm text-aegis-text">
                  <p className="font-medium">{nativeErrorLabel}</p>
                  <p className="mt-1 font-mono text-xs text-aegis-text-dim">{nativeSearchError}</p>
                </div>
              ) : !nativeSearch ? (
                <div className="grid min-h-48 place-items-center rounded-md border border-dashed border-aegis-border px-5 text-center text-sm text-aegis-text-dim">
                  <div>
                    <Database size={24} className="mx-auto mb-3" aria-hidden="true" />
                    <p>{t('memoryExplorer.gatewaySearchHint', 'Search the memory index exposed by the OpenClaw Gateway')}</p>
                  </div>
                </div>
              ) : (
                <div className="max-w-4xl space-y-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-aegis-text-dim">
                    <span>{t('memoryExplorer.provider', 'Provider')}: {nativeSearch.provider}</span>
                    <span>{t('memoryExplorer.agent', 'Agent')}: {nativeSearch.agentId}</span>
                    <span>{t('memoryExplorer.searchMode', 'Mode')}: {nativeSearch.searchMode}</span>
                    {nativeSearch.stale && <span className="text-aegis-warning">{t('memoryExplorer.stale', 'Index may be stale')}</span>}
                  </div>
                  {(nativeSearch.warning || nativeSearch.action) && (
                    <div className="rounded-md border border-aegis-warning/30 bg-aegis-warning/10 px-4 py-3 text-sm text-aegis-text">
                      {nativeSearch.warning && <p>{nativeSearch.warning}</p>}
                      {nativeSearch.action && <p className="mt-1 font-mono text-xs text-aegis-text-dim">{nativeSearch.action}</p>}
                    </div>
                  )}
                  {nativeSearch.results.length === 0 ? (
                    <div className="grid min-h-48 place-items-center rounded-md border border-dashed border-aegis-border px-5 text-center text-sm text-aegis-text-dim">
                      <p>{t('memoryExplorer.noGatewayResults', 'No Gateway memory results')}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {nativeSearch.results.map((result, index) => (
                        <article key={`${result.path}:${result.startLine}:${result.endLine}:${index}`} className="rounded-md border border-aegis-border bg-aegis-surface p-4">
                          <div className="flex items-start gap-3">
                            <Database size={18} className="mt-0.5 shrink-0 text-aegis-primary" aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-mono text-sm text-aegis-text" title={result.path}>{result.path}</p>
                              <p className="mt-1 text-xs text-aegis-text-dim">
                                {result.source === 'memory'
                                  ? t('memoryExplorer.sourceMemory', 'Durable memory')
                                  : t('memoryExplorer.sourceSessions', 'Session transcript')}
                                {' · '}{t('memoryExplorer.nativeLines', 'Lines {{start}}-{{end}}', { start: result.startLine, end: result.endLine })}
                                {' · '}{t('memoryExplorer.nativeScore', 'Score {{score}}', { score: result.score.toFixed(3) })}
                              </p>
                              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-5 text-aegis-text-dim">{result.snippet}</p>
                              {result.citation && <p className="mt-3 truncate font-mono text-[11px] text-aegis-text-dim" title={result.citation}>{result.citation}</p>}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              )
            ) : loading ? (
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
          {view === 'workspace' && <MemoryDetail item={selected} language={i18n.language} onClose={() => setSelectedId(null)} />}
        </div>
      </main>
    </PageTransition>
  );
}
