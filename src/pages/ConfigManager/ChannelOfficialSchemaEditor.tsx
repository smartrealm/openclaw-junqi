import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  loadOfficialChannelCapability,
  type OfficialChannelCapability,
} from '@/services/openclawChannelRuntime';
import type { OpenClawFieldSchema } from '@/services/openclawConfigSchema';
import { SchemaDrivenObjectEditor } from './SchemaDrivenObjectEditor';

const SENSITIVE_FIELD = /token|secret|password|passwd|cookie|authorization|private.?key|api.?key/i;

function accountFields(capability: OfficialChannelCapability): Record<string, OpenClawFieldSchema> {
  const accounts = capability.schema.accounts;
  const additional = accounts?.additionalProperties as OpenClawFieldSchema | undefined;
  return additional?.properties ?? capability.schema;
}

export function ChannelOfficialSchemaEditor({
  channelId,
  value,
  account = false,
  disabled = false,
  initiallyOpen = false,
  onChange,
}: {
  channelId: string;
  value: Record<string, any>;
  account?: boolean;
  disabled?: boolean;
  initiallyOpen?: boolean;
  onChange: (value: Record<string, any>) => void;
}) {
  const { t } = useTranslation();
  const [capability, setCapability] = useState<OfficialChannelCapability | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    loadOfficialChannelCapability(channelId)
      .then((next) => { if (!cancelled) setCapability(next); })
      .catch((reason: any) => { if (!cancelled) setError(reason?.message || String(reason)); });
    return () => { cancelled = true; };
  }, [channelId]);

  const fields = useMemo(() => capability
    ? (account ? accountFields(capability) : capability.schema)
    : {}, [account, capability]);
  const sensitiveFields = useMemo(() => Object.keys(fields).filter((name) => SENSITIVE_FIELD.test(name)), [fields]);

  if (error) return <p className="text-xs text-aegis-danger">{error}</p>;
  if (!capability) return <p className="text-xs text-aegis-text-muted">{t('common.loading', 'Loading...')}</p>;
  return (
    <SchemaDrivenObjectEditor
      title={t('channelsCenter.officialSettings', 'Official OpenClaw channel settings')}
      fields={fields}
      value={value}
      exclude={account ? ['agentId'] : ['accounts', 'agentId']}
      sensitiveFields={sensitiveFields}
      disabled={disabled}
      initiallyOpen={initiallyOpen}
      onChange={onChange}
    />
  );
}
