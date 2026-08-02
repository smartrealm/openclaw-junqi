import { useEffect, useState } from 'react';
import { DollarSign, Save, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ModelProviderModelEntry } from './types';
import {
  createModelCostDraft,
  MODEL_COST_FIELDS,
  parseModelCostDraft,
  type ModelCostDraft,
  type ModelCostField,
} from './modelCost';

export function ProviderModelCostEditor({ value, disabled = false, onChange }: {
  value: ModelProviderModelEntry['cost'];
  disabled?: boolean;
  onChange: (value: ModelProviderModelEntry['cost']) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ModelCostDraft>(() => createModelCostDraft(value));
  const [invalidField, setInvalidField] = useState<ModelCostField | null>(null);

  useEffect(() => {
    setDraft(createModelCostDraft(value));
    setInvalidField(null);
  }, [value]);

  const updateDraft = (field: ModelCostField, next: string) => {
    setDraft((current) => ({ ...current, [field]: next }));
    if (invalidField === field) setInvalidField(null);
  };

  const apply = () => {
    const result = parseModelCostDraft(draft, value);
    if (!result.ok) {
      setInvalidField(result.field);
      return;
    }
    setInvalidField(null);
    onChange(result.cost);
  };

  const clear = () => {
    setDraft(createModelCostDraft(undefined));
    setInvalidField(null);
    onChange(undefined);
  };

  return (
    <section className="rounded-md border border-aegis-border bg-aegis-surface p-3" aria-labelledby="model-cost-editor-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h4 id="model-cost-editor-title" className="flex items-center gap-1.5 text-xs font-semibold text-aegis-text-secondary">
            <DollarSign size={13} />
            {t('config.modelCostTitle', 'Model pricing')}
          </h4>
          <p className="mt-1 text-[10px] leading-4 text-aegis-text-muted">
            {t('config.modelCostHint', 'USD per 1 million tokens. Used by OpenClaw for local cost estimates, not as a provider invoice.')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={clear}
            className="inline-flex min-h-8 items-center gap-1 rounded-md border border-aegis-border px-2 text-[11px] text-aegis-text-muted transition-colors hover:bg-aegis-overlay/10 hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={11} />
            {t('config.clearModelCost', 'Clear pricing')}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={apply}
            className="inline-flex min-h-8 items-center gap-1 rounded-md bg-aegis-primary px-2.5 text-[11px] font-semibold text-aegis-btn-primary-text transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={11} />
            {t('config.applyModelCost', 'Apply pricing')}
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {MODEL_COST_FIELDS.map((field) => (
          <label key={field} className="min-w-0 text-[11px] font-medium text-aegis-text-secondary">
            {t(`config.modelCostFields.${field}`, field)}
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={draft[field]}
              disabled={disabled}
              aria-invalid={invalidField === field}
              aria-describedby={invalidField === field ? `model-cost-${field}-error` : undefined}
              onChange={(event) => updateDraft(field, event.target.value)}
              className="mt-1 w-full rounded-md border border-aegis-border bg-aegis-elevated px-2.5 py-2 font-mono text-xs text-aegis-text outline-none transition-colors focus:border-aegis-primary disabled:opacity-50 aria-[invalid=true]:border-red-400"
            />
            {invalidField === field && (
              <span id={`model-cost-${field}-error`} className="mt-1 block text-[10px] text-red-400">
                {draft[field].trim()
                  ? t('config.modelCostInvalid', 'Enter a number greater than or equal to zero.')
                  : t('config.modelCostRequired', 'Enter all four prices, including zero where applicable.')}
              </span>
            )}
          </label>
        ))}
      </div>
    </section>
  );
}
