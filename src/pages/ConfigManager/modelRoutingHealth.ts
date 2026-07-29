import type { GatewayRuntimeConfig } from './types';
import { getModelFallbacks, getModelPrimary } from './modelReference';
import {
  inspectInstalledModelVisibility,
  isModelVisibleForInstalledRuntime,
} from '@/services/gateway/modelVisibility';

export type ModelRoutingIssueKind =
  | 'missing-primary'
  | 'replace-without-explicit-models'
  | 'replace-primary-not-explicit'
  | 'replace-fallback-not-explicit'
  | 'fallback-repeats-primary'
  | 'primary-not-visible'
  | 'fallback-not-visible';

export interface ModelRoutingIssue {
  kind: ModelRoutingIssueKind;
  severity: 'error' | 'warning' | 'info';
  refs?: string[];
}

export interface ModelRoutingHealth {
  mode: 'merge' | 'replace';
  primary?: string;
  fallbacks: string[];
  explicitProviderModels: string[];
  configuredVisibilityRules: string[];
  issues: ModelRoutingIssue[];
}

function canonicalRef(providerId: string, value: unknown): string | undefined {
  const raw = String(value ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!raw) return undefined;
  return raw.startsWith(`${providerId}/`) ? raw : `${providerId}/${raw}`;
}

/**
 * `models.mode: "replace"` is evaluated from the explicit provider models,
 * not from aliases under `agents.defaults.models`. Keep the distinction visible
 * in the UI so a static catalog cannot make a replace-mode setup look healthy.
 */
export function getExplicitProviderModelRefs(config: GatewayRuntimeConfig): string[] {
  const refs = new Set<string>();
  for (const [providerId, provider] of Object.entries(config.models?.providers ?? {})) {
    for (const model of provider?.models ?? []) {
      const ref = canonicalRef(providerId, model?.id);
      if (ref) refs.add(ref);
    }
  }
  return Array.from(refs).sort((a, b) => a.localeCompare(b));
}

export function inspectModelRouting(config: GatewayRuntimeConfig): ModelRoutingHealth {
  const mode = config.models?.mode === 'replace' ? 'replace' : 'merge';
  const defaults = config.agents?.defaults;
  const primary = getModelPrimary(defaults?.model);
  const fallbacks = getModelFallbacks(defaults?.model);
  const explicitProviderModels = getExplicitProviderModelRefs(config);
  const visibility = inspectInstalledModelVisibility(config);
  const configuredVisibilityRules = [
    ...visibility.exactModelRefs,
    ...visibility.providerWildcards.map((provider) => `${provider}/*`),
  ];
  const issues: ModelRoutingIssue[] = [];

  if (!primary) {
    issues.push({ kind: 'missing-primary', severity: 'warning' });
  }

  if (fallbacks.includes(primary ?? '')) {
    issues.push({ kind: 'fallback-repeats-primary', severity: 'warning', refs: [primary ?? ''].filter(Boolean) });
  }

  if (primary && !isModelVisibleForInstalledRuntime(primary, visibility)) {
    issues.push({ kind: 'primary-not-visible', severity: 'error', refs: [primary] });
  }
  const hiddenFallbacks = fallbacks.filter((fallback) => (
    !isModelVisibleForInstalledRuntime(fallback, visibility)
  ));
  if (hiddenFallbacks.length > 0) {
    issues.push({ kind: 'fallback-not-visible', severity: 'error', refs: hiddenFallbacks });
  }

  if (mode === 'replace') {
    if (explicitProviderModels.length === 0) {
      issues.push({ kind: 'replace-without-explicit-models', severity: 'error' });
    }
    if (primary && !explicitProviderModels.includes(primary)) {
      issues.push({ kind: 'replace-primary-not-explicit', severity: 'error', refs: [primary] });
    }
    const unavailableFallbacks = fallbacks.filter((fallback) => !explicitProviderModels.includes(fallback));
    if (unavailableFallbacks.length > 0) {
      issues.push({ kind: 'replace-fallback-not-explicit', severity: 'error', refs: unavailableFallbacks });
    }
  }

  return {
    mode,
    primary,
    fallbacks,
    explicitProviderModels,
    configuredVisibilityRules,
    issues,
  };
}

export function hasBlockingModelRoutingIssue(health: ModelRoutingHealth): boolean {
  return health.issues.some((issue) => issue.severity === 'error');
}
