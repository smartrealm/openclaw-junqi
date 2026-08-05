import { Gauge, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';

interface ProviderUsagePresentation {
  readonly providers: ReadonlyArray<{
    readonly provider: string;
    readonly displayName: string;
    readonly windows: ReadonlyArray<{
      readonly label: string;
      readonly usedPercent: number;
      readonly resetAt?: number;
    }>;
  }>;
}

interface OpenClawProviderUsagePanelProps {
  readonly usage: ProviderUsagePresentation | null;
  readonly loading: boolean;
  readonly failure: 'unavailable' | 'invalid' | null;
  readonly onRefresh: () => void;
}

function quotaTone(usedPercent: number): string {
  if (usedPercent < 70) return 'bg-aegis-success';
  if (usedPercent < 90) return 'bg-aegis-warning';
  return 'bg-aegis-danger';
}

export function OpenClawProviderUsagePanel({
  usage,
  loading,
  failure,
  onRefresh,
}: OpenClawProviderUsagePanelProps) {
  const { t, i18n } = useTranslation();
  const percentage = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const resetTime = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <section className="mt-4 border-t border-aegis-border pt-4" aria-labelledby="openclaw-provider-usage-title">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id="openclaw-provider-usage-title" className="flex items-center gap-2 text-xs font-semibold text-aegis-text">
            <Gauge size={14} className="text-aegis-primary" aria-hidden="true" />
            {t('config.gatewayUsageStatus.title')}
          </h3>
          <p className="mt-1 text-[11px] leading-5 text-aegis-text-muted">
            {t('config.gatewayUsageStatus.description')}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-aegis-border text-aegis-text-muted transition-colors hover:border-aegis-primary/60 hover:text-aegis-primary disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t('config.gatewayUsageStatus.refresh')}
          title={t('config.gatewayUsageStatus.refresh')}
        >
          {loading ? <LoadingIndicator size={13} /> : <RefreshCw size={14} aria-hidden="true" />}
        </button>
      </div>

      {failure && (
        <p className="mt-3 text-[12px] text-aegis-warning">
          {failure === 'unavailable'
            ? t('config.gatewayUsageStatus.unavailable')
            : t('config.gatewayUsageStatus.invalid')}
        </p>
      )}

      {usage && (usage.providers.length === 0 ? (
        <p className="mt-3 text-[12px] text-aegis-text-muted">{t('config.gatewayUsageStatus.empty')}</p>
      ) : (
        <ul className="mt-3 grid gap-2" aria-label={t('config.gatewayUsageStatus.title')}>
          {usage.providers.map((provider) => (
            <li key={provider.provider} className="border border-aegis-border/70 bg-aegis-surface/50 px-3 py-2.5">
              <p className="min-w-0 break-words text-[12px] font-medium text-aegis-text">{provider.displayName}</p>
              {provider.windows.length === 0 ? (
                <p className="mt-1 text-[11px] text-aegis-text-muted">{t('config.gatewayUsageStatus.noWindows')}</p>
              ) : (
                <ul className="mt-2 grid gap-2">
                  {provider.windows.map((window) => {
                    const used = percentage.format(window.usedPercent);
                    return (
                      <li key={`${provider.provider}:${window.label}`}>
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] text-aegis-text-muted">
                          <span>{window.label}</span>
                          <span>{t('config.gatewayUsageStatus.used', { value: used })}</span>
                        </div>
                        <div
                          className="mt-1 h-1.5 overflow-hidden bg-aegis-border/70"
                          role="progressbar"
                          aria-label={window.label}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={window.usedPercent}
                        >
                          <div className={`h-full ${quotaTone(window.usedPercent)}`} style={{ width: `${window.usedPercent}%` }} />
                        </div>
                        {window.resetAt !== undefined && (
                          <p className="mt-1 text-[10px] text-aegis-text-dim">
                            {t('config.gatewayUsageStatus.resetAt', { value: resetTime.format(new Date(window.resetAt)) })}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
}
