// ═══════════════════════════════════════════════════════════
// ProviderSecretResolver — unified provider secret read/write/preserve layer
// for openclaw.json. Centralizes all secret-source rules.
// ═══════════════════════════════════════════════════════════

import type { GatewayRuntimeConfig, AuthProfile } from './types';

export type ProviderTemplateLike = {
  id?: string;
  envKey?: string;
  envKeyAlt?: string[];
};

export type ProviderSecretSource =
  | 'profile-apiKey'
  | 'profile-key'
  | 'profile-key-ref'
  | 'profile-token'
  | 'profile-token-ref'
  | 'profile-oauth'
  | 'provider-apiKey-raw'
  | 'provider-apiKey-env-ref'
  | 'provider-apiKey-secret-ref'
  | 'template-env'
  | 'template-env-alt'
  | 'none';

export interface ResolvedProviderSecret {
  configured: boolean;
  source: ProviderSecretSource;
  value?: string;
  envKey?: string;
  providerId: string;
  profileKey?: string;
}

const ENV_REF_RE = /^\$\{([^}]+)\}$/;

export function extractEnvRefKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const m = value.trim().match(ENV_REF_RE);
  return m?.[1];
}

function normalizeProviderPrefix(providerId: string): string {
  return String(providerId ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

export function deriveProviderApiKeyEnvKey(providerId: string, template?: ProviderTemplateLike): string {
  if (template?.id === 'custom' && template.envKey) return template.envKey;
  const normalized = String(providerId ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized ? `${normalized}_API_KEY` : 'OPENCLAW_CUSTOM_API_KEY';
}

function readProfileSecret(profile: Record<string, any> | undefined): ResolvedProviderSecret | null {
  if (!profile) return null;
  const apiKey = String(profile.apiKey ?? '').trim();
  if (apiKey) return { configured: true, source: 'profile-apiKey', value: apiKey, providerId: String(profile.provider ?? '') };
  const key = String(profile.key ?? '').trim();
  if (key) return { configured: true, source: 'profile-key', value: key, providerId: String(profile.provider ?? '') };
  if (profile.keyRef && typeof profile.keyRef === 'object') {
    return { configured: true, source: 'profile-key-ref', providerId: String(profile.provider ?? '') };
  }
  const token = String(profile.token ?? '').trim();
  if (token) return { configured: true, source: 'profile-token', value: token, providerId: String(profile.provider ?? '') };
  if (profile.tokenRef && typeof profile.tokenRef === 'object') {
    return { configured: true, source: 'profile-token-ref', providerId: String(profile.provider ?? '') };
  }
  const oauthAccess = String(profile.access ?? '').trim();
  if (profile.type === 'oauth' && oauthAccess) {
    return { configured: true, source: 'profile-oauth', value: oauthAccess, providerId: String(profile.provider ?? '') };
  }
  return null;
}

function readProviderConfigSecret(config: GatewayRuntimeConfig, providerId: string): ResolvedProviderSecret | null {
  const providerCfg = config.models?.providers?.[providerId] as Record<string, any> | undefined;
  if (providerCfg?.apiKey && typeof providerCfg.apiKey === 'object') {
    return { configured: true, source: 'provider-apiKey-secret-ref', providerId };
  }
  const raw = typeof providerCfg?.apiKey === 'string' ? providerCfg.apiKey.trim() : '';
  if (!raw) return null;

  const refKey = extractEnvRefKey(raw);
  if (refKey) {
    const value = String(config.env?.vars?.[refKey] ?? '').trim();
    // ${ENV_KEY} is a valid runtime contract even if Desktop cannot read the
    // actual value from openclaw.json. Gateway / shell / Web UI may resolve it
    // from process environment, so do not mark this as broken.
    return { configured: true, source: 'provider-apiKey-env-ref', envKey: refKey, value: value || undefined, providerId };
  }

  return { configured: true, source: 'provider-apiKey-raw', value: raw, providerId };
}

function readTemplateEnvSecret(config: GatewayRuntimeConfig, providerId: string, template?: ProviderTemplateLike): ResolvedProviderSecret | null {
  if (template?.envKey) {
    const value = String(config.env?.vars?.[template.envKey] ?? '').trim();
    if (value) return { configured: true, source: 'template-env', envKey: template.envKey, value, providerId };
  }
  for (const key of template?.envKeyAlt ?? []) {
    const value = String(config.env?.vars?.[key] ?? '').trim();
    if (value) return { configured: true, source: 'template-env-alt', envKey: key, value, providerId };
  }
  return null;
}

/** Read provider secret from all supported sources in priority order. */
export function resolveProviderSecret(
  config: GatewayRuntimeConfig,
  providerId: string,
  template?: ProviderTemplateLike,
  profileKey?: string,
): ResolvedProviderSecret {
  const profile = profileKey ? (config.auth?.profiles?.[profileKey] as Record<string, any> | undefined) : undefined;

  return (
    readProfileSecret(profile) ??
    readTemplateEnvSecret(config, providerId, template) ??
    readProviderConfigSecret(config, providerId) ??
    { configured: false, source: 'none', providerId, profileKey }
  );
}

/**
 * Build a robust patch for storing a provider secret.
 * - envKey-backed providers: write env.vars, strip secret from auth profile
 * - provider-config backed providers: write an env ref plus the env value when an env key is available
 * - raw providers: keep raw apiKey on models.providers only when no env key exists
 */
export function buildProviderSecretPatch(params: {
  prev: GatewayRuntimeConfig;
  providerId: string;
  profileKey: string;
  profile: AuthProfile;
  secret?: string;
  template?: ProviderTemplateLike;
  providerEnvKey?: string;
  preferProviderConfig?: boolean;
}): GatewayRuntimeConfig {
  const { prev, providerId, profileKey, profile, secret, template, providerEnvKey, preferProviderConfig } = params;
  const next: GatewayRuntimeConfig = { ...prev };
  const trimmed = String(secret ?? '').trim();
  const hasSubmittedSecret = trimmed.length > 0;
  const targetEnvKey = template?.envKey ?? providerEnvKey;
  const strippedProfile = {
    ...profile,
    token: undefined,
    apiKey: undefined,
    key: undefined,
  };
  const profileForAuth = hasSubmittedSecret ? strippedProfile : profile;

  if (targetEnvKey) {
    if (hasSubmittedSecret) {
      next.env = {
        ...next.env,
        vars: {
          ...(next.env?.vars ?? {}),
          [targetEnvKey]: trimmed,
        },
      };
    }
    next.auth = {
      ...next.auth,
      profiles: {
        ...(next.auth?.profiles ?? {}),
        [profileKey]: profileForAuth,
      },
    };

    if (preferProviderConfig && hasSubmittedSecret) {
      next.models = {
        ...next.models,
        providers: {
          ...(next.models?.providers ?? {}),
          [providerId]: {
            ...(next.models?.providers?.[providerId] ?? {}),
            apiKey: `\${${targetEnvKey}}`,
          },
        },
      };
    }

    return next;
  }

  if (hasSubmittedSecret) {
    next.models = {
      ...next.models,
      providers: {
        ...(next.models?.providers ?? {}),
        [providerId]: {
          ...(next.models?.providers?.[providerId] ?? {}),
          apiKey: trimmed,
        },
      },
    };
  }
  next.auth = {
    ...next.auth,
    profiles: {
      ...(next.auth?.profiles ?? {}),
      [profileKey]: profileForAuth,
    },
  };
  return next;
}

export function getProviderSecretEnvKeysForRemoval(params: {
  config: GatewayRuntimeConfig;
  providerId: string;
  template?: ProviderTemplateLike;
  providerEnvKey?: string;
}): string[] {
  const keys = new Set<string>();
  const add = (key: unknown) => {
    const trimmed = typeof key === 'string' ? key.trim() : '';
    if (trimmed) keys.add(trimmed);
  };

  add(params.template?.envKey);
  for (const key of params.template?.envKeyAlt ?? []) add(key);
  add(params.providerEnvKey);
  add(extractEnvRefKey((params.config.models?.providers?.[params.providerId] as any)?.apiKey));

  return [...keys];
}

export function isProviderSecretEnvKeyInUse(params: {
  config: GatewayRuntimeConfig;
  envKey: string;
  resolveTemplate?: (providerId: string) => ProviderTemplateLike | undefined;
}): boolean {
  const envKey = String(params.envKey ?? '').trim();
  if (!envKey) return false;

  for (const providerConfig of Object.values(params.config.models?.providers ?? {})) {
    if (extractEnvRefKey((providerConfig as any)?.apiKey) === envKey) return true;
  }

  for (const [profileKey, profileValue] of Object.entries(params.config.auth?.profiles ?? {})) {
    const profile = profileValue as Record<string, any>;
    const providerId = String(profile?.provider ?? profileKey.split(':')[0] ?? '').trim();
    if (!providerId) continue;
    const template = params.resolveTemplate?.(providerId);
    if (template?.envKey === envKey) return true;
    if ((template?.envKeyAlt ?? []).includes(envKey)) return true;
    if (deriveProviderApiKeyEnvKey(providerId, template) === envKey) return true;
  }

  return false;
}

/**
 * Preserve secret-bearing env vars from disk when provider/profile still exists.
 * Uses exact env-key references first, then template-like provider prefix heuristics.
 */
export function preserveProviderSecretsFromDisk(
  disk: GatewayRuntimeConfig,
  merged: GatewayRuntimeConfig,
): GatewayRuntimeConfig {
  const next = structuredClone(merged ?? {});
  const diskVars = disk.env?.vars ?? {};
  if (Object.keys(diskVars).length === 0) return next;

  const nextVars = { ...(next.env?.vars ?? {}) };
  const currentProviders = next.models?.providers ?? {};
  const currentProfiles = next.auth?.profiles ?? {};

  for (const [envKey, envValue] of Object.entries(diskVars)) {
    if (envKey in nextVars) continue;

    const byProviderRef = Object.values(currentProviders).some((cfg: any) => extractEnvRefKey(cfg?.apiKey) === envKey);
    const byProfilePrefix = Object.values(currentProfiles).some((p: any) => {
      const pid = normalizeProviderPrefix(String(p?.provider ?? ''));
      return pid && String(envKey).startsWith(pid);
    });

    if (byProviderRef || byProfilePrefix) {
      nextVars[envKey] = envValue;
    }
  }

  if (Object.keys(nextVars).length > 0) {
    next.env = { ...(next.env ?? {}), vars: nextVars };
  }
  return next;
}
