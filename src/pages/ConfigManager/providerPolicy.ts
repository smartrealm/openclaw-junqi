import type { GatewayRuntimeConfig } from './types';

function canonicalProviderId(value: string): string {
  return value.trim().toLowerCase();
}

export function setModelCatalogMode(
  config: GatewayRuntimeConfig,
  mode: 'merge' | 'replace',
): GatewayRuntimeConfig {
  return { ...config, models: { ...config.models, mode } };
}

function normalizeModelPolicyRules(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values ?? []) {
    const rule = value.trim();
    const comparisonKey = rule.toLowerCase();
    if (!rule || seen.has(comparisonKey)) continue;
    seen.add(comparisonKey);
    normalized.push(rule);
  }

  return normalized;
}

export function getModelPolicyAllow(config: GatewayRuntimeConfig): string[] {
  return normalizeModelPolicyRules(config.agents?.defaults?.modelPolicy?.allow);
}

/**
 * `modelPolicy.allow` limits user-selectable session overrides. An empty list
 * means OpenClaw's default behavior: do not restrict the model picker.
 */
export function setModelPolicyAllow(
  config: GatewayRuntimeConfig,
  allow: readonly string[] | undefined,
): GatewayRuntimeConfig {
  const normalized = normalizeModelPolicyRules(allow);
  const currentDefaults = config.agents?.defaults;
  const currentPolicy = currentDefaults?.modelPolicy ?? {};
  const { allow: _allow, ...otherPolicyFields } = currentPolicy as Record<string, unknown>;
  const defaultsWithoutPolicy = { ...(currentDefaults ?? {}) } as Record<string, unknown>;
  delete defaultsWithoutPolicy.modelPolicy;

  const nextDefaults = normalized.length > 0
    ? {
      ...defaultsWithoutPolicy,
      modelPolicy: { ...currentPolicy, allow: normalized },
    }
    : Object.keys(otherPolicyFields).length > 0
      ? { ...defaultsWithoutPolicy, modelPolicy: otherPolicyFields }
      : defaultsWithoutPolicy;

  return {
    ...config,
    agents: {
      ...config.agents,
      defaults: nextDefaults,
    },
  };
}

export function hasProviderWildcard(config: GatewayRuntimeConfig, providerId: string): boolean {
  const wildcard = `${canonicalProviderId(providerId)}/*`;
  return Object.prototype.hasOwnProperty.call(config.agents?.defaults?.models ?? {}, wildcard);
}

export function setProviderWildcard(
  config: GatewayRuntimeConfig,
  providerId: string,
  enabled: boolean,
): GatewayRuntimeConfig {
  const wildcard = `${canonicalProviderId(providerId)}/*`;
  const models = { ...(config.agents?.defaults?.models ?? {}) };
  if (enabled) models[wildcard] = {};
  else delete models[wildcard];
  return {
    ...config,
    agents: {
      ...config.agents,
      defaults: { ...config.agents?.defaults, models },
    },
  };
}

export function setProviderAuthOrder(
  config: GatewayRuntimeConfig,
  providerId: string,
  profileIds: string[],
): GatewayRuntimeConfig {
  const provider = canonicalProviderId(providerId);
  const knownProfiles = config.auth?.profiles ?? {};
  const deduped = Array.from(new Set(profileIds)).filter((profileId) => {
    const profile = knownProfiles[profileId];
    const owner = profile?.provider ?? profileId.split(':')[0];
    return canonicalProviderId(owner) === provider;
  });
  const order = { ...(config.auth?.order ?? {}) };
  if (deduped.length > 0) order[provider] = deduped;
  else delete order[provider];
  return { ...config, auth: { ...config.auth, order } };
}
