import { ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { OpenClawPlanToolMode } from '@/agent-execution-plan/settings';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';

const MODES: readonly OpenClawPlanToolMode[] = ['automatic', 'enabled', 'disabled'];

interface StructuredPlanSettingsPanelProps {
  mode: OpenClawPlanToolMode;
  loading: boolean;
  saving: boolean;
  disabled?: boolean;
  error: string | null;
  onChange: (mode: OpenClawPlanToolMode) => void;
  onRetry: () => void;
}

export function StructuredPlanSettingsPanel({
  mode,
  loading,
  saving,
  disabled = false,
  error,
  onChange,
  onRetry,
}: StructuredPlanSettingsPanelProps) {
  const { t } = useTranslation();
  const busy = loading || saving;
  const controlsDisabled = disabled || busy;
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <ListChecks size={16} className="mt-0.5 shrink-0 text-aegis-primary" />
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-aegis-text">
            {t('settings.structuredPlans.title')}
          </div>
          <div className="mt-0.5 text-[11px] leading-5 text-aegis-text-dim">
            {t('settings.structuredPlans.description')}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 rounded-lg border border-aegis-border p-0.5" role="radiogroup" aria-label={t('settings.structuredPlans.title')}>
        {MODES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            disabled={controlsDisabled}
            onClick={() => onChange(option)}
            className={clsx(
              'min-h-8 rounded-md px-2 text-[11px] font-medium transition-colors disabled:cursor-wait disabled:opacity-50',
              mode === option
                ? 'bg-aegis-primary/12 text-aegis-primary'
                : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.04)] hover:text-aegis-text',
            )}
          >
            {t(`settings.structuredPlans.${option}`)}
          </button>
        ))}
      </div>

      {busy && (
        <div className="flex items-center gap-2 text-[11px] text-aegis-text-dim">
          <LoadingIndicator size={12} />
          {saving
            ? t('settings.structuredPlans.saving')
            : t('settings.structuredPlans.loading')}
        </div>
      )}
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-aegis-danger/20 bg-aegis-danger/5 px-2.5 py-2 text-[11px] text-aegis-danger">
          <span className="min-w-0 break-words">{error}</span>
          <button type="button" disabled={disabled} onClick={onRetry} className="shrink-0 font-medium underline underline-offset-2 disabled:opacity-50">
            {t('common.retry')}
          </button>
        </div>
      )}
    </div>
  );
}
