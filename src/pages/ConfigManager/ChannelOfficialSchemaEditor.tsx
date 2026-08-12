import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  loadOfficialChannelCapability,
  type OfficialChannelCapability,
} from '@/services/openclawChannelRuntime';
import {
  loadOpenClawConfigSchemaDocument,
  type OpenClawFieldSchema,
} from '@/services/openclawConfigSchema';
import { SchemaDrivenObjectEditor } from './SchemaDrivenObjectEditor';

const SENSITIVE_FIELD = /token|secret|password|passwd|cookie|authorization|private.?key|api.?key/i;

function accountFields(capability: OfficialChannelCapability): Record<string, OpenClawFieldSchema> {
  const accounts = capability.schema.accounts;
  const additional = accounts?.additionalProperties as OpenClawFieldSchema | undefined;
  return additional?.properties ?? capability.schema;
}

function editableUnionSchema(schema: OpenClawFieldSchema, value: unknown): OpenClawFieldSchema {
  if (value !== null && typeof value === 'object') return schema;
  const variants = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])];
  const primitive = variants.find((variant) => (
    variant.type && ['string', 'number', 'integer', 'boolean'].includes(variant.type)
  ));
  return primitive ? { ...schema, ...primitive, anyOf: undefined, oneOf: undefined } : schema;
}

function applyUiHints(
  channelId: string,
  fields: Record<string, OpenClawFieldSchema>,
  uiHints: Record<string, unknown>,
  value: Record<string, any>,
): { fields: Record<string, OpenClawFieldSchema>; sensitive: string[] } {
  const sensitive: string[] = [];
  const next = Object.fromEntries(Object.entries(fields).map(([name, schema]) => {
    const rawHint = uiHints[`channels.${channelId}.${name}`];
    const hint = rawHint && typeof rawHint === 'object' && !Array.isArray(rawHint)
      ? rawHint as Record<string, unknown>
      : {};
    if (hint.sensitive === true || SENSITIVE_FIELD.test(name)) sensitive.push(name);
    return [name, {
      ...editableUnionSchema(schema, value[name]),
      ...(typeof hint.label === 'string' ? { title: hint.label } : {}),
      ...(typeof hint.help === 'string' ? { description: hint.help } : {}),
    }];
  }));
  return { fields: next, sensitive };
}

export function ChannelOfficialSchemaEditor({
  channelId,
  value,
  account = false,
  disabled = false,
  initiallyOpen = false,
  onValidationChange,
  onChange,
}: {
  channelId: string;
  value: Record<string, any>;
  account?: boolean;
  disabled?: boolean;
  initiallyOpen?: boolean;
  onChange: (value: Record<string, any>) => void;
  onValidationChange?: (valid: boolean) => void;
}) {
  const { t } = useTranslation();
  const [capability, setCapability] = useState<OfficialChannelCapability | null>(null);
  const [error, setError] = useState('');
  const [uiHints, setUiHints] = useState<Record<string, unknown>>({});

  useEffect(() => {
    let cancelled = false;
    setError('');
    onValidationChange?.(false);
    Promise.all([
      loadOfficialChannelCapability(channelId),
      loadOpenClawConfigSchemaDocument().catch(() => null),
    ])
      .then(([next, document]) => {
        if (cancelled) return;
        setCapability(next);
        setUiHints(document?.uiHints ?? {});
        onValidationChange?.(true);
      })
      .catch((reason: any) => { if (!cancelled) setError(reason?.message || String(reason)); });
    return () => { cancelled = true; };
  }, [channelId]);

  const rawFields = useMemo(() => capability
    ? (account ? accountFields(capability) : capability.schema)
    : {}, [account, capability]);
  const projection = useMemo(
    () => applyUiHints(channelId, rawFields, uiHints, value),
    [channelId, rawFields, uiHints, value],
  );

  if (error) return <p className="text-xs text-aegis-danger">{error}</p>;
  if (!capability) return <p className="text-xs text-aegis-text-muted">{t('common.loading', 'Loading...')}</p>;
  return (
    <SchemaDrivenObjectEditor
      title={t('channelsCenter.officialSettings', 'Official OpenClaw channel settings')}
      fields={projection.fields}
      value={value}
      exclude={account ? ['agentId'] : ['accounts', 'agentId']}
      sensitiveFields={projection.sensitive}
      disabled={disabled}
      initiallyOpen={initiallyOpen}
      onChange={onChange}
      onValidationChange={onValidationChange}
    />
  );
}
