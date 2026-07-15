import { useEffect, useState } from 'react';
import type { ModelProviderConfig } from './types';
import {
  loadOpenClawConfigSchema,
  providerFieldSchemas,
  type OpenClawFieldSchema,
} from '@/services/openclawConfigSchema';
import { SchemaDrivenObjectEditor } from './SchemaDrivenObjectEditor';
import { useTranslation } from 'react-i18next';

export function ProviderAdvancedEditor({ value, disabled = false, onChange }: {
  value: ModelProviderConfig;
  disabled?: boolean;
  onChange: (value: ModelProviderConfig) => void;
}) {
  const { t } = useTranslation();
  const [fields, setFields] = useState<Record<string, OpenClawFieldSchema>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    loadOpenClawConfigSchema()
      .then((schema) => { if (!cancelled) setFields(providerFieldSchemas(schema)); })
      .catch((reason: any) => { if (!cancelled) setError(reason?.message || String(reason)); });
    return () => { cancelled = true; };
  }, []);
  if (error) return <p className="border-t border-aegis-border pt-3 text-xs text-red-400">{error}</p>;
  return <SchemaDrivenObjectEditor title={t('config.advancedProviderSettings', 'OpenClaw advanced provider settings')} fields={fields} value={value} exclude={['baseUrl', 'apiKey', 'api', 'models']} disabled={disabled} onChange={onChange} />;
}
