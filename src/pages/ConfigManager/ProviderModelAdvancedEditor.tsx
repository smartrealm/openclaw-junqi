import { useEffect, useState } from 'react';
import type { ModelProviderModelEntry } from './types';
import {
  loadOpenClawConfigSchema,
  providerModelFieldSchemas,
  type OpenClawFieldSchema,
} from '@/services/openclawConfigSchema';
import { SchemaDrivenObjectEditor } from './SchemaDrivenObjectEditor';
import { useTranslation } from 'react-i18next';
import { ProviderModelCostEditor } from './ProviderModelCostEditor';

export function ProviderModelAdvancedEditor({ value, disabled = false, onChange }: {
  value: ModelProviderModelEntry;
  disabled?: boolean;
  onChange: (value: ModelProviderModelEntry) => void;
}) {
  const { t } = useTranslation();
  const [fields, setFields] = useState<Record<string, OpenClawFieldSchema>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    loadOpenClawConfigSchema()
      .then((schema) => { if (!cancelled) setFields(providerModelFieldSchemas(schema)); })
      .catch((reason: any) => { if (!cancelled) setError(reason?.message || String(reason)); });
    return () => { cancelled = true; };
  }, []);
  return (
    <div className="space-y-3">
      <ProviderModelCostEditor
        value={value.cost}
        disabled={disabled}
        onChange={(cost) => {
          const next = { ...value };
          if (cost) next.cost = cost;
          else delete next.cost;
          onChange(next);
        }}
      />
      {error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : (
        <SchemaDrivenObjectEditor
          title={t('config.advancedModelSettings', 'OpenClaw model capabilities and runtime')}
          fields={fields}
          value={value}
          exclude={['id', 'name', 'input', 'metadataSource', 'cost']}
          disabled={disabled}
          initiallyOpen
          onChange={(next) => onChange(next as ModelProviderModelEntry)}
        />
      )}
    </div>
  );
}
