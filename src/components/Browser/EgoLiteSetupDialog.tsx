import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Info, Play, ShieldCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface EgoLiteSetupDialogProps {
  open: boolean;
  applicationPath?: string;
  executablePath?: string;
  opening: boolean;
  error: string | null;
  onClose: () => void;
  onOpenApplication: () => void;
  onOpenDocs: () => void;
  onRefresh: () => void;
}

export function EgoLiteSetupDialog({
  open,
  applicationPath,
  executablePath,
  opening,
  error,
  onClose,
  onOpenApplication,
  onOpenDocs,
  onRefresh,
}: EgoLiteSetupDialogProps) {
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (open) setConfirmed(false);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ego-lite-setup-title"
        className="w-full max-w-lg overflow-hidden rounded-xl border border-aegis-border bg-aegis-bg shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-aegis-border px-5 py-4">
          <div className="min-w-0">
            <h2 id="ego-lite-setup-title" className="text-[15px] font-semibold text-aegis-text-primary">
              {t('browserProviders.setupTitle')}
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-aegis-text-muted">
              {t('browserProviders.setupDescription')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-aegis-text-muted hover:bg-aegis-hover hover:text-aegis-text-primary"
            title={t('browserProviders.closeSetup')}
            aria-label={t('browserProviders.closeSetup')}
          >
            <X size={15} />
          </button>
        </header>

        <div className="space-y-3 px-5 py-4">
          <ol className="space-y-3">
            <li className="flex items-start gap-2.5">
              <CheckCircle2 size={16} className={executablePath ? 'mt-0.5 text-aegis-success' : 'mt-0.5 text-aegis-text-dim'} />
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-aegis-text-primary">{t('browserProviders.setupInstallTitle')}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-aegis-text-muted">
                  {executablePath
                    ? t('browserProviders.setupInstallDetected', { path: executablePath })
                    : t('browserProviders.setupInstallDescription')}
                </p>
              </div>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckCircle2 size={16} className={applicationPath ? 'mt-0.5 text-aegis-success' : 'mt-0.5 text-aegis-text-dim'} />
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-aegis-text-primary">{t('browserProviders.setupAppTitle')}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-aegis-text-muted">
                  {applicationPath
                    ? t('browserProviders.setupAppDetected', { path: applicationPath })
                    : t('browserProviders.setupAppDescription')}
                </p>
              </div>
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-aegis-accent" />
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-aegis-text-primary">{t('browserProviders.setupMigrationTitle')}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-aegis-text-muted">
                  {t('browserProviders.setupMigrationDescription')}
                </p>
              </div>
            </li>
          </ol>

          <div className="flex items-start gap-2 rounded-lg border border-aegis-accent/25 bg-aegis-accent/5 px-3 py-2.5 text-[11px] leading-5 text-aegis-text-secondary">
            <Info size={14} className="mt-0.5 shrink-0 text-aegis-accent" />
            <span>{t('browserProviders.setupBoundary')}</span>
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-5 text-aegis-text-secondary">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-1 accent-[var(--aegis-accent)]"
            />
            <span>{t('browserProviders.setupConsent')}</span>
          </label>

          {error ? (
            <p role="alert" className="text-[11px] leading-4 text-aegis-danger">
              {t('browserProviders.openError')}
            </p>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-aegis-border px-5 py-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onOpenDocs}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-aegis-accent hover:bg-aegis-accent/10"
            >
              <ExternalLink size={12} />
              {t('browserProviders.openDocs')}
            </button>
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-md px-2.5 py-1.5 text-[11px] text-aegis-text-muted hover:bg-aegis-hover hover:text-aegis-text-primary"
            >
              {t('browserProviders.refresh')}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-aegis-border px-2.5 py-1.5 text-[11px] text-aegis-text-secondary hover:bg-aegis-hover"
            >
              {t('browserProviders.closeSetup')}
            </button>
            <button
              type="button"
              onClick={onOpenApplication}
              disabled={!applicationPath || !confirmed || opening}
              className="inline-flex items-center gap-1.5 rounded-md bg-aegis-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Play size={12} />
              {opening ? t('browserProviders.opening') : t('browserProviders.openSetupApp')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
