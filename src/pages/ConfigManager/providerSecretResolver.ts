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
  | 'profile-token'
  | 'provider-apiKey-raw'
  | 'provider-apiKey-env-ref'
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

function readProfileSecret(profile: Record<string, any> | undefined): ResolvedProviderSecret | null {
  if (!profile) return null;
  const apiKey = String(profile.apiKey ?? '').trim();
  if (apiKey) return { configured: true, source: 'profile-apiKey', value: apiKey, providerId: String(profile.provider ?? '') };
  const token = String(profile.token ?? '').trim();
  if (token) return { configured: true, source: 'profile-token', value: token, providerId: String(profile.provider ?? '') };
  return null;
}

function readProviderConfigSecret(config: GatewayRuntimeConfig, providerId: string): ResolvedProviderSecret | null {
  const providerCfg = config.models?.providers?.[providerId] as Record<string, any> | undefined;
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
 * - custom/raw providers: keep raw apiKey on models.providers unless explicit env key exists
 */
export function buildProviderSecretPatch(params: {
  prev: GatewayRuntimeConfig;
  providerId: string;
  profileKey: string;
  profile: AuthProfile;
  secret?: string;
  template?: ProviderTemplateLike;
  preferProviderConfig?: boolean;
}): GatewayRuntimeConfig {
  const { prev, providerId, profileKey, profile, secret, template, preferProviderConfig } = params;
  const next: GatewayRuntimeConfig = { ...prev };
  const trimmed = String(secret ?? '').trim();

  if (template?.envKey && !preferProviderConfig) {
    next.env = {
      ...next.env,
      vars: {
        ...(next.env?.vars ?? {}),
        ...(trimmed ? { [template.envKey]: trimmed } : {}),
      },
    };
    next.auth = {
      ...next.auth,
      profiles: {
        ...(next.auth?.profiles ?? {}),
        [profileKey]: {
          ...profile,
          token: undefined,
          apiKey: undefined,
          key: undefined,
        },
      },
    };
    return next;
  }

  next.models = {
    ...next.models,
    providers: {
      ...(next.models?.providers ?? {}),
      [providerId]: {
        ...(next.models?.providers?.[providerId] ?? {}),
        ...(trimmed ? { apiKey: trimmed } : {}),
      },
    },
  };
  next.auth = {
    ...next.auth,
    profiles: {
      ...(next.auth?.profiles ?? {}),
      [profileKey]: {
        ...profile,
        token: undefined,
        apiKey: undefined,
        key: undefined,
      },
    },
  };
  return next;
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
