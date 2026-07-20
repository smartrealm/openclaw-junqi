import type {
  GatewayRuntimeConfig,
  SecretRef,
  SecretRefSource,
} from './types';

export type SecretProviderDefinition =
  | { source: 'env'; allowlist?: string[] }
  | { source: 'file'; path: string; mode?: 'singleValue' | 'json' }
  | { source: 'exec'; command: string; args?: string[]; jsonOnly?: boolean };

const SECRET_PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const ENV_SECRET_ID = /^[A-Z][A-Z0-9_]{0,127}$/;

export function isSecretRef(value: unknown): value is SecretRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Partial<SecretRef>;
  return ['env', 'file', 'exec'].includes(String(ref.source))
    && typeof ref.provider === 'string'
    && typeof ref.id === 'string';
}

export function applyProviderSecretRef(params: {
  config: GatewayRuntimeConfig;
  providerId: string;
  secretProviderId: string;
  secretId: string;
  definition: SecretProviderDefinition;
}): GatewayRuntimeConfig {
  const providerId = params.providerId.trim().toLowerCase();
  const secretProviderId = params.secretProviderId.trim();
  const secretId = params.secretId.trim();
  if (!SECRET_PROVIDER_ID.test(secretProviderId)) throw new Error('Invalid secret provider ID.');
  if (!secretId) throw new Error('Secret ID is required.');
  if (params.definition.source === 'env' && !ENV_SECRET_ID.test(secretId)) {
    throw new Error('Environment secret IDs must use uppercase letters, digits, and underscores.');
  }
  if (params.definition.source === 'file' && !params.definition.path.trim()) {
    throw new Error('Secret file path is required.');
  }
  if (params.definition.source === 'exec' && !params.definition.command.trim()) {
    throw new Error('Secret command is required.');
  }

  const existingDefinition = params.config.secrets?.providers?.[secretProviderId];
  const definition = params.definition.source === 'env'
    ? {
      ...existingDefinition,
      ...params.definition,
      allowlist: Array.from(new Set([
        ...(Array.isArray(existingDefinition?.allowlist) ? existingDefinition.allowlist : []),
        ...(params.definition.allowlist ?? []),
        secretId,
      ])),
    }
    : params.definition;
  const currentProvider = params.config.models?.providers?.[providerId] ?? {};
  return {
    ...params.config,
    secrets: {
      ...params.config.secrets,
      providers: {
        ...(params.config.secrets?.providers ?? {}),
        [secretProviderId]: definition,
      },
    },
    models: {
      ...params.config.models,
      providers: {
        ...(params.config.models?.providers ?? {}),
        [providerId]: {
          ...currentProvider,
          apiKey: {
            source: params.definition.source as SecretRefSource,
            provider: secretProviderId,
            id: secretId,
          },
        },
      },
    },
  };
}

export function clearProviderSecretRef(
  config: GatewayRuntimeConfig,
  providerId: string,
): GatewayRuntimeConfig {
  const provider = providerId.trim().toLowerCase();
  const current = config.models?.providers?.[provider];
  if (!current || !isSecretRef(current.apiKey)) return config;
  const nextProvider = { ...current };
  delete nextProvider.apiKey;
  return {
    ...config,
    models: {
      ...config.models,
      providers: { ...(config.models?.providers ?? {}), [provider]: nextProvider },
    },
  };
}
