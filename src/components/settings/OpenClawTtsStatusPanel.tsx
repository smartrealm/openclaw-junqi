import { RefreshCw, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';

interface OpenClawTtsStatusPresentation {
  readonly enabled: boolean;
  readonly auto: 'off' | 'always' | 'inbound' | 'tagged';
  readonly provider: string;
  readonly persona: string | null;
  readonly providerStates: ReadonlyArray<{ readonly id: string; readonly label: string; readonly configured: boolean }>;
  readonly personas: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly provider: string;
  }>;
}

interface OpenClawTtsStatusPanelProps {
  readonly status: OpenClawTtsStatusPresentation | null;
  readonly loading: boolean;
  readonly failure: 'unavailable' | 'invalid' | null;
  readonly connected: boolean;
  readonly onRefresh: () => void;
}

function statusValue(value: boolean, enabled: string, disabled: string): string {
  return value ? enabled : disabled;
}

export function OpenClawTtsStatusPanel({
  status,
  loading,
  failure,
  connected,
  onRefresh,
}: OpenClawTtsStatusPanelProps) {
  const { t } = useTranslation();
  const persona = status?.persona
    ? status.personas.find((entry) => entry.id === status.persona) ?? null
    : null;
  const personaValue = status?.persona
    ? persona?.label ?? status.persona
    : t('settings.openClawTtsStatus.none');
  const configuredProviders = status?.providerStates
    .filter((provider) => provider.configured)
    .map((provider) => provider.label)
    .join(', ');

  return (
    <section className="border-t border-aegis-border/70 pt-4" aria-labelledby="openclaw-tts-status-title">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h4 id="openclaw-tts-status-title" className="flex items-center gap-2 text-[13px] font-semibold text-aegis-text">
            <Volume2 size={14} className="text-aegis-primary" aria-hidden="true" />
            {t('settings.openClawTtsStatus.title')}
          </h4>
          <p className="mt-1 text-[11px] leading-5 text-aegis-text-dim">
            {t('settings.openClawTtsStatus.description')}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={!connected || loading}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-aegis-border/70 text-aegis-text-dim transition-colors hover:border-aegis-primary/60 hover:text-aegis-primary disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t('settings.openClawTtsStatus.refresh')}
          title={t('settings.openClawTtsStatus.refresh')}
        >
          {loading ? <LoadingIndicator size={13} /> : <RefreshCw size={14} aria-hidden="true" />}
        </button>
      </div>

      {!connected && (
        <p className="mt-3 text-[12px] text-aegis-text-muted">
          {t('settings.openClawTtsStatus.disconnected')}
        </p>
      )}

      {connected && failure && (
        <p className="mt-3 text-[12px] text-aegis-warning">
          {failure === 'unavailable'
            ? t('settings.openClawTtsStatus.unavailable')
            : t('settings.openClawTtsStatus.invalid')}
        </p>
      )}

      {status && (
        <dl className="mt-3 grid grid-cols-[minmax(104px,auto)_minmax(0,1fr)] gap-x-4 gap-y-2 text-[12px] leading-5">
          <dt className="text-aegis-text-dim">{t('settings.openClawTtsStatus.enabled')}</dt>
          <dd className="min-w-0 text-aegis-text">
            {statusValue(status.enabled, t('settings.openClawTtsStatus.enabledValue'), t('settings.openClawTtsStatus.disabledValue'))}
          </dd>
          <dt className="text-aegis-text-dim">{t('settings.openClawTtsStatus.auto')}</dt>
          <dd className="min-w-0 break-words text-aegis-text">
            {t(`settings.openClawTtsStatus.autoValues.${status.auto}`)}
          </dd>
          <dt className="text-aegis-text-dim">{t('settings.openClawTtsStatus.provider')}</dt>
          <dd className="min-w-0 break-words text-aegis-text">{status.provider}</dd>
          <dt className="text-aegis-text-dim">{t('settings.openClawTtsStatus.persona')}</dt>
          <dd className="min-w-0 break-words text-aegis-text">{personaValue}</dd>
          <dt className="text-aegis-text-dim">{t('settings.openClawTtsStatus.configuredProviders')}</dt>
          <dd className="min-w-0 break-words text-aegis-text">
            {configuredProviders || t('settings.openClawTtsStatus.none')}
          </dd>
        </dl>
      )}
    </section>
  );
}
