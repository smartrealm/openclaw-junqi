import { useEffect, useState } from 'react';
import { KeyRound, Save, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GatewayRuntimeConfig, SecretRefSource } from './types';
import {
  applyProviderSecretRef,
  clearProviderSecretRef,
  isSecretRef,
  type SecretProviderDefinition,
} from './providerSecretRef';

export function ProviderSecretRefEditor({
  config,
  providerId,
  disabled = false,
  onChange,
}: {
  config: GatewayRuntimeConfig;
  providerId: string;
  disabled?: boolean;
  onChange: (updater: (prev: GatewayRuntimeConfig) => GatewayRuntimeConfig) => void;
}) {
  const { t } = useTranslation();
  const current = config.models?.providers?.[providerId]?.apiKey;
  const currentRef = isSecretRef(current) ? current : undefined;
  const [source, setSource] = useState<SecretRefSource>(currentRef?.source ?? 'env');
  const defaultSecretProviderId = `${providerId}-secrets`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 64) || 'provider-secrets';
  const [secretProviderId, setSecretProviderId] = useState(currentRef?.provider ?? defaultSecretProviderId);
  const [secretId, setSecretId] = useState(currentRef?.id ?? '');
  const [pathOrCommand, setPathOrCommand] = useState('');
  const [args, setArgs] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentRef) return;
    setSource(currentRef.source);
    setSecretProviderId(currentRef.provider);
    setSecretId(currentRef.id);
    const definition = config.secrets?.providers?.[currentRef.provider];
    setPathOrCommand(currentRef.source === 'file'
      ? String(definition?.path ?? '')
      : currentRef.source === 'exec'
        ? String(definition?.command ?? '')
        : '');
    setArgs(Array.isArray(definition?.args) ? definition.args.join('\n') : '');
  }, [config.secrets?.providers, currentRef?.id, currentRef?.provider, currentRef?.source]);

  const apply = () => {
    try {
      const definition: SecretProviderDefinition = source === 'env'
        ? { source: 'env' }
        : source === 'file'
          ? { source: 'file', path: pathOrCommand.trim(), mode: 'json' }
          : {
            source: 'exec',
            command: pathOrCommand.trim(),
            args: args.split('\n').map((value) => value.trim()).filter(Boolean),
            jsonOnly: true,
          };
      onChange((prev) => applyProviderSecretRef({
        config: prev,
        providerId,
        secretProviderId,
        secretId,
        definition,
      }));
      setError('');
    } catch (applyError: any) {
      setError(applyError?.message || String(applyError));
    }
  };

  return (
    <details className="group border-t border-aegis-border pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-aegis-text-secondary">
        <KeyRound size={13} />
        OpenClaw SecretRef
        <span className="font-mono text-xs font-normal text-aegis-text-muted">
          {currentRef ? `${currentRef.source}:${currentRef.provider}:${currentRef.id}` : t('config.secretRefNotConfigured', 'not configured')}
        </span>
      </summary>
      <div className="mt-3 grid gap-3 pl-5 md:grid-cols-3">
        <label className="text-[11px] text-aegis-text-secondary">
          {t('config.secretSource', 'Source')}
          <select value={source} disabled={disabled} onChange={(event) => setSource(event.target.value as SecretRefSource)} className="mt-1 w-full rounded-md border border-aegis-border bg-aegis-surface px-2.5 py-2 text-xs text-aegis-text outline-none focus:border-aegis-primary">
            <option value="env">{t('config.secretSourceEnv', 'Environment')}</option>
            <option value="file">{t('config.secretSourceFile', 'File')}</option>
            <option value="exec">{t('config.secretSourceExec', 'Command')}</option>
          </select>
        </label>
        <label className="text-[11px] text-aegis-text-secondary">
          {t('config.secretProviderId', 'Secret provider ID')}
          <input value={secretProviderId} disabled={disabled} onChange={(event) => setSecretProviderId(event.target.value)} className="mt-1 w-full rounded-md border border-aegis-border bg-aegis-surface px-2.5 py-2 font-mono text-xs text-aegis-text outline-none focus:border-aegis-primary" />
        </label>
        <label className="text-[11px] text-aegis-text-secondary">
          {t('config.secretId', 'Secret ID')}
          <input value={secretId} disabled={disabled} onChange={(event) => setSecretId(event.target.value)} placeholder={source === 'env' ? 'OPENAI_API_KEY' : 'openai'} className="mt-1 w-full rounded-md border border-aegis-border bg-aegis-surface px-2.5 py-2 font-mono text-xs text-aegis-text outline-none focus:border-aegis-primary" />
        </label>
        {source !== 'env' && (
          <label className="text-[11px] text-aegis-text-secondary md:col-span-2">
            {source === 'file'
              ? t('config.secretFilePath', 'JSON secret file path')
              : t('config.secretCommandPath', 'Absolute command path')}
            <input value={pathOrCommand} disabled={disabled} onChange={(event) => setPathOrCommand(event.target.value)} className="mt-1 w-full rounded-md border border-aegis-border bg-aegis-surface px-2.5 py-2 font-mono text-xs text-aegis-text outline-none focus:border-aegis-primary" />
          </label>
        )}
        {source === 'exec' && (
          <label className="text-[11px] text-aegis-text-secondary md:col-span-3">
            {t('config.secretArgsHint', 'Arguments, one per line (passed without shell expansion)')}
            <textarea value={args} disabled={disabled} onChange={(event) => setArgs(event.target.value)} className="mt-1 min-h-20 w-full rounded-md border border-aegis-border bg-aegis-surface p-2.5 font-mono text-xs text-aegis-text outline-none focus:border-aegis-primary" />
          </label>
        )}
        <div className="flex items-center gap-2 md:col-span-3">
          <button type="button" disabled={disabled} onClick={apply} className="inline-flex items-center gap-1.5 rounded-md border border-aegis-primary/30 bg-aegis-primary/10 px-3 py-1.5 text-xs font-medium text-aegis-primary disabled:opacity-50">
            <Save size={12} /> {t('config.applySecretRef', 'Apply SecretRef')}
          </button>
          {currentRef && (
            <button type="button" disabled={disabled} onClick={() => onChange((prev) => clearProviderSecretRef(prev, providerId))} className="inline-flex items-center gap-1.5 rounded-md border border-red-400/25 px-3 py-1.5 text-xs text-red-400 disabled:opacity-50">
              <Trash2 size={12} /> {t('config.removeSecretRef', 'Remove reference')}
            </button>
          )}
          <span className="text-xs text-aegis-text-muted">{t('config.secretValuesHidden', 'Secret values are never read or displayed.')}</span>
        </div>
        {error && <p className="text-xs text-red-400 md:col-span-3">{error}</p>}
      </div>
    </details>
  );
}
