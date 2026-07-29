import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OpenClawConfig } from './types';
import { SchemaDrivenObjectEditor } from './SchemaDrivenObjectEditor';
import {
  configObjectFieldSchemas,
  loadOpenClawConfigSchema,
  type OpenClawFieldSchema,
} from '@/services/openclawConfigSchema';

interface ToolsTabProps {
  config: OpenClawConfig;
  onChange: (updater: (prev: OpenClawConfig) => OpenClawConfig) => void;
}

/**
 * Tools and web-provider capabilities change with OpenClaw plugins. Render the
 * selected Runtime's schema instead of maintaining a JunQi provider/plugin map.
 */
export function ToolsTab({ config, onChange }: ToolsTabProps) {
  const { t } = useTranslation();
  const [fields, setFields] = useState<Record<string, OpenClawFieldSchema>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadOpenClawConfigSchema()
      .then((schema) => {
        if (cancelled) return;
        setFields(configObjectFieldSchemas(schema, 'tools'));
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <p className="text-sm text-aegis-text-muted">{t('common.loading', 'Loading…')}</p>;
  }

  if (error || Object.keys(fields).length === 0) {
    return (
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
        {t(
          'config.runtimeSchemaRequired',
          'The selected OpenClaw Runtime schema is unavailable. Tool settings are read-only; use the raw editor or official OpenClaw Wizard after the Runtime is available.',
        )}
        {error ? <p className="mt-1 text-xs opacity-80">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-aegis-border bg-aegis-elevated p-4">
      <p className="mb-3 text-xs text-aegis-text-muted">
        {t('config.runtimeSchemaAuthorityHint', 'Fields and accepted values come from the selected OpenClaw Runtime.')}
      </p>
      <SchemaDrivenObjectEditor
        title={t('config.tools', 'Tools')}
        fields={fields}
        value={config.tools ?? {}}
        initiallyOpen
        onChange={(tools) => onChange((prev) => ({ ...prev, tools }))}
      />
    </div>
  );
}

export default ToolsTab;
