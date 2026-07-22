import type { GatewayRuntimeConfig, ModelEntry } from './types';
import { getModelFallbacks, getModelPrimary } from './modelReference';
import { getModelPolicyAllow } from './providerPolicy';

export type ModelRoutingIssueKind =
  | 'missing-primary'
  | 'replace-without-explicit-models'
  | 'replace-primary-not-explicit'
  | 'replace-fallback-not-explicit'
  | 'fallback-repeats-primary'
  | 'policy-rule-unmatched';

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
  allowedConfiguredModels: string[];
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

function ruleMatchesModel(rule: string, modelRef: string, entry?: ModelEntry): boolean {
  const normalizedRule = rule.trim().toLowerCase();
  const normalizedRef = modelRef.trim().toLowerCase();
  if (!normalizedRule) return false;
  if (normalizedRule.endsWith('/*')) {
    return normalizedRef.startsWith(normalizedRule.slice(0, -1));
  }
  return normalizedRule === normalizedRef || normalizedRule === String(entry?.alias ?? '').trim().toLowerCase();
}

function configuredModelsAllowedByPolicy(
  models: Record<string, ModelEntry>,
  rules: string[],
): string[] {
  if (rules.length === 0) return Object.keys(models).sort((a, b) => a.localeCompare(b));
  return Object.entries(models)
    .filter(([modelRef, entry]) => rules.some((rule) => ruleMatchesModel(rule, modelRef, entry)))
    .map(([modelRef]) => modelRef)
    .sort((a, b) => a.localeCompare(b));
}

export function inspectModelRouting(config: GatewayRuntimeConfig): ModelRoutingHealth {
  const mode = config.models?.mode === 'replace' ? 'replace' : 'merge';
  const defaults = config.agents?.defaults;
  const primary = getModelPrimary(defaults?.model);
  const fallbacks = getModelFallbacks(defaults?.model);
  const explicitProviderModels = getExplicitProviderModelRefs(config);
  const policyRules = getModelPolicyAllow(config);
  const configuredModels = defaults?.models ?? {};
  const allowedConfiguredModels = configuredModelsAllowedByPolicy(configuredModels, policyRules);
  const issues: ModelRoutingIssue[] = [];

  if (!primary) {
    issues.push({ kind: 'missing-primary', severity: 'warning' });
  }

  if (fallbacks.includes(primary ?? '')) {
    issues.push({ kind: 'fallback-repeats-primary', severity: 'warning', refs: [primary ?? ''].filter(Boolean) });
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
    for (const rule of policyRules) {
      if (!explicitProviderModels.some((modelRef) => ruleMatchesModel(rule, modelRef, configuredModels[modelRef]))) {
        issues.push({ kind: 'policy-rule-unmatched', severity: 'info', refs: [rule] });
      }
    }
  }

  return {
    mode,
    primary,
    fallbacks,
    explicitProviderModels,
    allowedConfiguredModels,
    issues,
  };
}

export function hasBlockingModelRoutingIssue(health: ModelRoutingHealth): boolean {
  return health.issues.some((issue) => issue.severity === 'error');
}
