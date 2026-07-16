import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, CircleAlert, Download, ExternalLink, RefreshCw, TerminalSquare } from 'lucide-react';
import clsx from 'clsx';
import { useOpenclawUpdate } from '@/hooks/useOpenclawUpdate';
import { resolveOpenclawUpdateIndicator } from './openclawUpdateIndicator';
import { Alert } from './alert';
import { Button } from './button';

const OFFICIAL_UPDATE_GUIDE = 'https://docs.openclaw.ai/install/updating';

export interface OpenClawUpdatePanelProps {
  currentVersion?: string | null;
  compact?: boolean;
  onUpdated?: (version: string | null) => void | Promise<void>;
}

async function openOfficialUpdateGuide(): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(OFFICIAL_UPDATE_GUIDE);
  } catch {
    window.open(OFFICIAL_UPDATE_GUIDE, '_blank', 'noopener,noreferrer');
  }
}

export function OpenClawUpdatePanel({
  currentVersion,
  compact = false,
  onUpdated,
}: OpenClawUpdatePanelProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const update = useOpenclawUpdate();
  const [confirming, setConfirming] = useState(false);
  const status = update.status;
  const displayedVersion = status?.currentVersion || update.result?.afterVersion || currentVersion || null;
  const indicator = resolveOpenclawUpdateIndicator(update.phase, status);
  const available = indicator === 'available';
  const upToDate = indicator === 'current';

  const channelLabel = status?.channel
    ? t(`setup.openclawUpdate.channel.${status.channel}`, { defaultValue: status.channel })
    : null;
  const installLabel = status?.installKind === 'git'
    ? t('setup.openclawUpdate.installGit')
    : status?.installKind === 'package'
      ? (status.packageManager?.toUpperCase() || t('setup.openclawUpdate.installPackage'))
      : null;
  const npmRegistryKind = status?.npmRegistryKind || update.result?.npmRegistryKind || null;
  const npmRegistry = status?.npmRegistry || update.result?.npmRegistry || null;
  const npmRegistryLabel = npmRegistryKind
    ? t(`setup.openclawUpdate.registry.${npmRegistryKind}`)
    : npmRegistry;
  const progressPercent = Math.max(0, Math.min(100, Math.round(update.progress ?? 0)));

  const handleUpdate = async () => {
    setConfirming(false);
    const completion = await update.apply();
    if (!completion?.result.success) return;
    const version = completion.status?.currentVersion || completion.result.afterVersion || null;
    try {
      await onUpdated?.(version);
    } catch {
      // The official update already succeeded. Runtime polling will reconcile
      // on its next normal cycle if this immediate UI refresh fails.
    }
  };

  const action = (() => {
    if (update.checking) {
      return (
        <Button size="sm" variant="outline" loading disabled>
          {t('setup.openclawUpdate.checking')}
        </Button>
      );
    }
    if (update.updating) {
      return (
        <Button size="sm" variant="solid" tone="primary" loading disabled>
          {t('setup.openclawUpdate.updating')}
        </Button>
      );
    }
    if (update.phase === 'error') {
      return (
        <Button
          size="sm"
          variant="outline"
          leadingIcon={<RefreshCw size={14} />}
          onClick={() => {
            setConfirming(false);
            void update.check();
          }}
        >
          {t('setup.openclawUpdate.retry')}
        </Button>
      );
    }
    if (available) {
      return (
        <Button
          size="sm"
          variant="solid"
          tone="primary"
          leadingIcon={<Download size={14} />}
          onClick={() => setConfirming(true)}
        >
          {status?.latestVersion
            ? t('setup.openclawUpdate.updateTo', { version: status.latestVersion })
            : t('setup.openclawUpdate.updateNow')}
        </Button>
      );
    }
    return (
      <Button
        size="sm"
        variant="outline"
        leadingIcon={<RefreshCw size={14} />}
        onClick={() => {
          setConfirming(false);
          void update.check();
        }}
      >
        {t('setup.openclawUpdate.check')}
      </Button>
    );
  })();

  return (
    <section
      className={clsx(
        'border-y border-aegis-border/40 bg-aegis-surface/20',
        compact ? 'px-3 py-3' : 'px-4 py-4',
      )}
      aria-labelledby={titleId}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              data-testid="openclaw-update-status-icon"
              data-state={indicator}
              className="inline-flex shrink-0"
              aria-hidden="true"
            >
              {indicator === 'current' ? (
                <CheckCircle2 size={15} className="text-aegis-success" />
              ) : indicator === 'available' ? (
                <Download size={15} className="text-aegis-warning" />
              ) : indicator === 'error' ? (
                <CircleAlert size={15} className="text-aegis-danger" />
              ) : (
                <RefreshCw
                  size={15}
                  className={clsx('text-aegis-primary', indicator === 'busy' && 'animate-spin')}
                />
              )}
            </span>
            <h3 id={titleId} className="text-sm font-semibold text-aegis-text">
              {t('setup.openclawUpdate.title')}
            </h3>
            {upToDate && (
              <span className="inline-flex items-center text-[11px] font-medium text-aegis-success">
                {t('setup.openclawUpdate.upToDate')}
              </span>
            )}
            {available && (
              <span className="inline-flex items-center text-[11px] font-medium text-aegis-warning">
                {t('setup.openclawUpdate.available')}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-aegis-text-dim">
            {t('setup.openclawUpdate.subtitle')}
          </p>
        </div>
        <div className="shrink-0">{action}</div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-aegis-text-dim">
        <span>
          {t('setup.openclawUpdate.currentVersion')}
          <strong className="ms-1.5 font-mono font-semibold text-aegis-text">
            {displayedVersion ? `v${displayedVersion}` : t('setup.openclawUpdate.unknown')}
          </strong>
        </span>
        {available && status?.latestVersion && (
          <span>
            {t('setup.openclawUpdate.latestVersion')}
            <strong className="ms-1.5 font-mono font-semibold text-aegis-warning">
              v{status.latestVersion}
            </strong>
          </span>
        )}
        {status?.hasGitUpdate && status.gitBehind != null && (
          <span>{t('setup.openclawUpdate.gitBehind', { count: status.gitBehind })}</span>
        )}
        {channelLabel && <span>{t('setup.openclawUpdate.channelLabel', { channel: channelLabel })}</span>}
        {installLabel && <span>{t('setup.openclawUpdate.installLabel', { install: installLabel })}</span>}
        {npmRegistryLabel && (
          <span>{t('setup.openclawUpdate.registryLabel', { registry: npmRegistryLabel })}</span>
        )}
      </div>

      {confirming && !update.updating && (
        <div className="mt-3">
          <Alert
            tone="warning"
            size="sm"
            title={t('setup.openclawUpdate.confirmTitle')}
            actions={(
              <>
                <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
                  {t('setup.openclawUpdate.cancel')}
                </Button>
                <Button size="xs" variant="solid" tone="primary" onClick={() => void handleUpdate()}>
                  {t('setup.openclawUpdate.confirm')}
                </Button>
              </>
            )}
          >
            {t('setup.openclawUpdate.confirmHint')}
          </Alert>
        </div>
      )}

      {update.updating && (
        <div className="mt-3" aria-live="polite">
          <Alert tone="info" size="sm" title={t('setup.openclawUpdate.updating')}>
            {t('setup.openclawUpdate.restartHint')}
          </Alert>
        </div>
      )}

      {(update.checking || update.updating || update.logs.length > 0) && (
        <div className="mt-3 border-t border-aegis-border/50 pt-3" aria-live="polite">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs text-aegis-text-dim">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <TerminalSquare size={13} className="shrink-0" />
              <span className="truncate">
                {update.logs[update.logs.length - 1] || t('setup.openclawUpdate.preparing')}
              </span>
            </span>
            <span className="shrink-0 font-mono tabular-nums">
              {progressPercent}%
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-[rgb(var(--aegis-overlay)/0.14)]"
            role="progressbar"
            aria-label={t('setup.openclawUpdate.progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
          >
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{
                width: `${progressPercent}%`,
                backgroundColor: 'rgb(var(--aegis-primary))',
              }}
            />
          </div>
          {update.logs.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto bg-black/20 px-3 py-2 font-mono text-xs leading-5 text-aegis-text-dim">
              {update.logs.map((line, index) => (
                <div key={`${index}-${line}`} className="break-all">{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {update.phase === 'success' && update.result && (
        <div className="mt-3" aria-live="polite">
          <Alert
            tone={update.result.gatewayError ? 'warning' : 'success'}
            size="sm"
            title={t('setup.openclawUpdate.success')}
          >
            {update.result.gatewayError
              ? t('setup.openclawUpdate.gatewayRestartFailed', { error: update.result.gatewayError })
              : t('setup.openclawUpdate.successHint', {
                version: update.result.afterVersion || displayedVersion || t('setup.openclawUpdate.unknown'),
              })}
          </Alert>
        </div>
      )}

      {update.phase === 'error' && update.error && (
        <div className="mt-3" aria-live="assertive">
          <Alert tone="danger" size="sm" title={t('setup.openclawUpdate.failed')}>
            <span className="break-words">{update.error}</span>
          </Alert>
        </div>
      )}

      <button
        type="button"
        onClick={() => void openOfficialUpdateGuide()}
        className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-aegis-text-dim transition-colors hover:text-aegis-primary"
      >
        <ExternalLink size={12} />
        {t('setup.openclawUpdate.officialGuide')}
      </button>
    </section>
  );
}
