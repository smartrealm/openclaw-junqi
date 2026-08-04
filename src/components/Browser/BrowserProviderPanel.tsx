import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe2,
  Monitor,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { useBrowserRuntimeStatus, type NativeBrowserStatus } from '@/hooks/useBrowserRuntimeStatus';
import {
  BROWSER_PROVIDER_DESCRIPTORS,
  findEgoLiteProbe,
  isEgoLiteReady,
  type BrowserProviderProbeStatus,
} from '@/services/browser/browserProviders';
import { openEgoLite } from '@/services/browser/browserProviderRuntime';
import { EgoLiteSetupDialog } from './EgoLiteSetupDialog';

interface BrowserProviderPanelProps {
  compact?: boolean;
}

type DisplayStatus = NativeBrowserStatus | BrowserProviderProbeStatus | 'unknown';

async function openExternal(url: string): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function StatusIcon({ status }: { status: DisplayStatus }) {
  if (status === 'available') return <CheckCircle2 size={15} className="text-aegis-success" />;
  if (status === 'checking') return <RefreshCw size={15} className="animate-spin text-aegis-accent" />;
  if (status === 'unsupported' || status === 'unavailable') return <XCircle size={15} className="text-aegis-text-dim" />;
  return <AlertCircle size={15} className="text-aegis-warning" />;
}

function statusKey(status: DisplayStatus): string {
  return `browserProviders.status.${status}`;
}

export function BrowserProviderPanel({ compact = false }: BrowserProviderPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    probes,
    probeLoading,
    probeError,
    refresh,
    nativeStatus,
    nativeToolError,
  } = useBrowserRuntimeStatus();
  const [copied, setCopied] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const egoProbe = findEgoLiteProbe(probes);
  const egoStatus: DisplayStatus = probeLoading
    ? 'checking'
    : egoProbe?.status === 'available' && !isEgoLiteReady(egoProbe)
      ? 'notInstalled'
      : egoProbe?.status ?? (probeError ? 'unknown' : 'unknown');
  const nativeDescriptor = BROWSER_PROVIDER_DESCRIPTORS.find((provider) => provider.id === 'openclaw-native');
  const egoDescriptor = BROWSER_PROVIDER_DESCRIPTORS.find((provider) => provider.id === 'ego-lite');

  async function copyInstallCommand(): Promise<void> {
    if (!egoDescriptor?.installCommand) return;
    try {
      await navigator.clipboard.writeText(egoDescriptor.installCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  async function openApplication(): Promise<void> {
    if (!egoProbe?.applicationPath || opening) return;
    setOpening(true);
    setOpenError(null);
    try {
      await openEgoLite();
      setSetupOpen(false);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpening(false);
    }
  }

  return (
    <section
      className={clsx(
        'rounded-xl border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.03)]',
        compact ? 'p-4' : 'p-5',
      )}
      aria-labelledby="browser-provider-panel-title"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-lg bg-aegis-accent/10 p-2 text-aegis-accent">
            <Globe2 size={18} />
          </div>
          <div className="min-w-0">
            <h2 id="browser-provider-panel-title" className="text-[14px] font-semibold text-aegis-text-primary">
              {t('browserProviders.title')}
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-aegis-text-muted">
              {t('browserProviders.subtitle')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={probeLoading}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-aegis-text-muted transition-colors hover:bg-aegis-hover hover:text-aegis-text-primary disabled:cursor-wait disabled:opacity-50"
          title={t('browserProviders.refresh')}
          aria-label={t('browserProviders.refresh')}
        >
          <RefreshCw size={14} className={probeLoading ? 'animate-spin' : ''} />
        </button>
      </header>

      <div className={clsx('mt-4 grid gap-3', compact ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2')}>
        {nativeDescriptor ? (
          <article className="rounded-lg border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.025)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <Monitor size={16} className="mt-0.5 shrink-0 text-aegis-accent" />
                <div className="min-w-0">
                  <h3 className="truncate text-[12px] font-semibold text-aegis-text-primary">
                    {t(nativeDescriptor.nameKey)}
                  </h3>
                  <p className="mt-1 text-[11px] leading-4 text-aegis-text-muted">
                    {t(nativeDescriptor.descriptionKey)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-aegis-text-muted">
                <StatusIcon status={nativeStatus} />
                <span>{t(statusKey(nativeStatus))}</span>
              </div>
            </div>
            <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-4 text-aegis-text-dim">
              <ShieldCheck size={13} className="mt-0.5 shrink-0" />
              <span>{nativeToolError ? t('browserProviders.nativeToolError') : t(nativeDescriptor.capabilityKey)}</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate('/tools')}
                className="rounded-md border border-aegis-border px-2.5 py-1.5 text-[11px] text-aegis-text-secondary transition-colors hover:bg-aegis-hover"
              >
                {t('browserProviders.openTools')}
              </button>
              <button
                type="button"
                onClick={() => void openExternal(nativeDescriptor.docsUrl)}
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] text-aegis-accent transition-colors hover:bg-aegis-accent/10"
              >
                <ExternalLink size={12} />
                {t('browserProviders.openDocs')}
              </button>
            </div>
          </article>
        ) : null}

        {egoDescriptor ? (
          <article className="rounded-lg border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.025)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <Globe2 size={16} className="mt-0.5 shrink-0 text-aegis-accent" />
                <div className="min-w-0">
                  <h3 className="truncate text-[12px] font-semibold text-aegis-text-primary">
                    {t(egoDescriptor.nameKey)}
                  </h3>
                  <p className="mt-1 text-[11px] leading-4 text-aegis-text-muted">
                    {t(egoDescriptor.descriptionKey)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-aegis-text-muted">
                <StatusIcon status={egoStatus} />
                <span>{t(statusKey(egoStatus))}</span>
              </div>
            </div>
            <p className="mt-3 text-[10px] leading-4 text-aegis-text-dim">
              {egoProbe?.executablePath
                ? t('browserProviders.detectedPath', { path: egoProbe.executablePath })
                : egoProbe?.platform
                  ? t('browserProviders.detectedPlatform', { platform: egoProbe.platform })
                  : t(egoDescriptor.capabilityKey)}
            </p>
            {egoProbe?.applicationPath ? (
              <p className="mt-1 text-[10px] leading-4 text-aegis-text-dim">
                {t('browserProviders.detectedApplication', { path: egoProbe.applicationPath })}
              </p>
            ) : null}
            {egoStatus === 'notInstalled' && egoDescriptor.installCommand ? (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.04)] px-2.5 py-2">
                <code className="min-w-0 flex-1 truncate text-[10px] text-aegis-text-secondary">
                  {egoDescriptor.installCommand}
                </code>
                <button
                  type="button"
                  onClick={() => void copyInstallCommand()}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-aegis-text-muted hover:bg-aegis-hover hover:text-aegis-text-primary"
                  title={t(copied ? 'browserProviders.copied' : 'browserProviders.copyInstallCommand')}
                  aria-label={t(copied ? 'browserProviders.copied' : 'browserProviders.copyInstallCommand')}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpenError(null);
                  setSetupOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-md bg-aegis-accent px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:brightness-105"
              >
                <ExternalLink size={12} />
                {t('browserProviders.openSetup')}
              </button>
              <button
                type="button"
                onClick={() => void openExternal(egoDescriptor.docsUrl)}
                className="inline-flex items-center gap-1 rounded-md border border-aegis-border px-2.5 py-1.5 text-[11px] text-aegis-text-secondary transition-colors hover:bg-aegis-hover"
              >
                <ExternalLink size={12} />
                {t('browserProviders.openDocs')}
              </button>
            </div>
          </article>
        ) : null}
      </div>

      {probeError ? (
        <p className="mt-3 flex items-center gap-1.5 text-[10px] text-aegis-warning">
          <AlertCircle size={13} />
          {t('browserProviders.probeError')}
        </p>
      ) : null}
      {openError && !setupOpen ? (
        <p role="alert" className="mt-3 text-[10px] text-aegis-danger">
          {t('browserProviders.openError')}
        </p>
      ) : null}
      <EgoLiteSetupDialog
        open={setupOpen}
        applicationPath={egoProbe?.applicationPath}
        executablePath={egoProbe?.executablePath}
        opening={opening}
        error={openError}
        onClose={() => setSetupOpen(false)}
        onOpenApplication={() => void openApplication()}
        onOpenDocs={() => void openExternal(egoDescriptor?.docsUrl ?? 'https://github.com/citrolabs/ego-lite')}
        onRefresh={() => void refresh()}
      />
    </section>
  );
}
