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
