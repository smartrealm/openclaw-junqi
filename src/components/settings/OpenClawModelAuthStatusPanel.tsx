import { KeyRound, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';

type AuthenticationStatus = 'ok' | 'expiring' | 'expired' | 'missing' | 'static';

interface ModelAuthStatusPresentation {
  readonly providers: ReadonlyArray<{
    readonly provider: string;
    readonly displayName: string;
    readonly status: AuthenticationStatus;
    readonly expiry?: { readonly label: string };
    readonly profiles: ReadonlyArray<{
      readonly type: 'oauth' | 'token' | 'api_key';
      readonly status: AuthenticationStatus;
      readonly expiry?: { readonly label: string };
    }>;
  }>;
}

interface OpenClawModelAuthStatusPanelProps {
  readonly status: ModelAuthStatusPresentation | null;
  readonly loading: boolean;
  readonly failure: 'unavailable' | 'invalid' | null;
  readonly onRefresh: () => void;
}

function statusClass(status: AuthenticationStatus): string {
  if (status === 'ok' || status === 'static') return 'border-aegis-success/30 bg-aegis-success/10 text-aegis-success';
  if (status === 'expiring') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return 'border-red-500/30 bg-red-500/10 text-red-300';
}

export function OpenClawModelAuthStatusPanel({
  status,
  loading,
  failure,
  onRefresh,
}: OpenClawModelAuthStatusPanelProps) {
  const { t } = useTranslation();

  return (
    <section className="mt-4 border-t border-aegis-border pt-4" aria-labelledby="openclaw-model-auth-status-title">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id="openclaw-model-auth-status-title" className="flex items-center gap-2 text-xs font-semibold text-aegis-text">
            <KeyRound size={14} className="text-aegis-primary" aria-hidden="true" />
            {t('config.gatewayAuthStatus.title')}
          </h3>
          <p className="mt-1 text-[11px] leading-5 text-aegis-text-muted">
            {t('config.gatewayAuthStatus.description')}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-aegis-border text-aegis-text-muted transition-colors hover:border-aegis-primary/60 hover:text-aegis-primary disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t('config.gatewayAuthStatus.refresh')}
          title={t('config.gatewayAuthStatus.refresh')}
        >
          {loading ? <LoadingIndicator size={13} /> : <RefreshCw size={14} aria-hidden="true" />}
        </button>
      </div>

      {failure && (
        <p className="mt-3 text-[12px] text-aegis-warning">
          {failure === 'unavailable'
            ? t('config.gatewayAuthStatus.unavailable')
            : t('config.gatewayAuthStatus.invalid')}
        </p>
      )}

      {status && (status.providers.length === 0 ? (
        <p className="mt-3 text-[12px] text-aegis-text-muted">{t('config.gatewayAuthStatus.empty')}</p>
      ) : (
        <ul className="mt-3 grid gap-2" aria-label={t('config.gatewayAuthStatus.title')}>
          {status.providers.map((provider) => (
            <li key={provider.provider} className="border border-aegis-border/70 bg-aegis-surface/50 px-3 py-2.5">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words text-[12px] font-medium text-aegis-text">{provider.displayName}</span>
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${statusClass(provider.status)}`}>
                  {t(`config.gatewayAuthStatus.status.${provider.status}`)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-aegis-text-muted">
                {provider.expiry && <span>{t('config.gatewayAuthStatus.expiresIn', { value: provider.expiry.label })}</span>}
                {provider.profiles.length > 0 && (
                  <span>{t('config.gatewayAuthStatus.profileCount', { count: provider.profiles.length })}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
}
