import { Globe2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassCard } from '@/components/shared/GlassCard';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import {
  OPENCLAW_RUNTIME_LOCALES,
  type OpenClawRuntimeLocale,
  type OpenClawRuntimeLanguageMessage,
} from '@/types/openclawRuntimeLocale';
import clsx from 'clsx';

interface OpenClawRuntimeLanguagePanelProps {
  connected: boolean;
  currentLocale: OpenClawRuntimeLocale | null;
  selectedLocale: OpenClawRuntimeLocale | null;
  rawLocale: string | null;
  loading: boolean;
  saving: boolean;
  message: OpenClawRuntimeLanguageMessage | null;
  onSelectLocale(locale: OpenClawRuntimeLocale): void;
  onRefresh(): void;
  onSave(): void;
}

export function OpenClawRuntimeLanguagePanel({
  connected,
  currentLocale,
  selectedLocale,
  rawLocale,
  loading,
  saving,
  message,
  onSelectLocale,
  onRefresh,
  onSave,
}: OpenClawRuntimeLanguagePanelProps) {
  const { t } = useTranslation();

  const changed = selectedLocale !== null && selectedLocale !== currentLocale;

  return (
    <GlassCard delay={0.06}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-aegis-text">
            <Globe2 size={16} className="text-aegis-primary" />
            {t('settings.runtimeLanguage')}
          </h3>
          <p className="mt-1 text-xs leading-5 text-aegis-text-muted">
            {t('settings.runtimeLanguageHint')}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={!connected || loading || saving}
          aria-label={t('settings.runtimeLanguageRefresh')}
          title={t('settings.runtimeLanguageRefresh')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-aegis-border bg-aegis-surface text-aegis-text-secondary hover:border-aegis-primary/50 hover:text-aegis-primary disabled:cursor-not-allowed disabled:opacity-45"
        >
          {loading ? <LoadingIndicator size={14} /> : <RefreshCw size={14} />}
        </button>
      </div>

      {!connected ? (
        <p className="mt-4 text-xs leading-5 text-aegis-text-muted">
          {t('settings.runtimeLanguageDisconnected')}
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('settings.runtimeLanguage')}>
            {OPENCLAW_RUNTIME_LOCALES.map((locale) => (
              <button
                key={locale}
                type="button"
                role="radio"
                aria-checked={selectedLocale === locale}
                disabled={loading || saving}
                onClick={() => onSelectLocale(locale)}
                className={clsx(
                  'min-h-10 rounded-md border px-3 text-sm font-medium transition-colors',
                  selectedLocale === locale
                    ? 'border-aegis-primary/50 bg-aegis-primary/10 text-aegis-primary'
                    : 'border-aegis-border bg-aegis-surface text-aegis-text-secondary hover:border-aegis-border-hover hover:text-aegis-text',
                  'disabled:cursor-not-allowed disabled:opacity-45',
                )}
              >
                {t(`settings.runtimeLanguageOptions.${locale}`)}
              </button>
            ))}
          </div>

          {rawLocale && !currentLocale && (
            <p className="mt-3 break-all text-xs leading-5 text-aegis-warning">
              {t('settings.runtimeLanguageUnknown', { locale: rawLocale })}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-aegis-border pt-4">
            <p className="min-w-0 flex-1 text-xs leading-5 text-aegis-text-muted">
              {t('settings.runtimeLanguagePluginBoundary')}
            </p>
            <button
              type="button"
              onClick={onSave}
              disabled={!changed || loading || saving}
              className="inline-flex h-9 min-w-[96px] items-center justify-center gap-2 rounded-md bg-aegis-primary px-4 text-sm font-semibold text-aegis-btn-primary-text hover:bg-aegis-primary-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              {saving && <LoadingIndicator size={14} />}
              {saving ? t('settings.runtimeLanguageSaving') : t('settings.runtimeLanguageSave')}
            </button>
          </div>
        </>
      )}

      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={clsx(
            'mt-3 text-xs leading-5',
            message.kind === 'error'
              ? 'text-aegis-danger'
              : message.kind === 'success'
                ? 'text-aegis-success'
                : 'text-aegis-text-muted',
          )}
        >
          {message.text}
        </p>
      )}
    </GlassCard>
  );
}
