import type { ModelConfig, ModelReferenceConfig } from './types';

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function isModelReferenceObject(
  value: ModelReferenceConfig | undefined,
): value is ModelConfig {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getModelPrimary(value: ModelReferenceConfig | undefined): string | undefined {
  if (typeof value === 'string') return asNonEmptyString(value);
  return asNonEmptyString(value?.primary);
}

export function getModelFallbacks(value: ModelReferenceConfig | undefined): string[] {
  if (!isModelReferenceObject(value) || !Array.isArray(value.fallbacks)) return [];
  return Array.from(new Set(value.fallbacks.map(asNonEmptyString).filter((ref): ref is string => Boolean(ref))));
}

/** Preserve the compact string form until a caller needs structured fallbacks. */
export function setModelPrimary(
  value: ModelReferenceConfig | undefined,
  primary: string | undefined,
): ModelReferenceConfig | undefined {
  const nextPrimary = asNonEmptyString(primary);
  if (typeof value === 'string') {
    if (!nextPrimary) return undefined;
    return value.trim() === nextPrimary ? value.trim() : { primary: nextPrimary };
  }

  if (!isModelReferenceObject(value)) {
    return nextPrimary ? { primary: nextPrimary } : undefined;
  }

  const next: ModelConfig = { ...value };
  if (nextPrimary) next.primary = nextPrimary;
  else delete next.primary;
  return Object.keys(next).length > 0 ? next : undefined;
}

export function setModelFallbacks(
  value: ModelReferenceConfig | undefined,
  fallbacks: string[],
): ModelReferenceConfig | undefined {
  const next: ModelConfig = isModelReferenceObject(value) ? { ...value } : {};
  const primary = getModelPrimary(value);
  if (primary) next.primary = primary;

  const normalized = Array.from(new Set(
    fallbacks.map(asNonEmptyString).filter((ref): ref is string => Boolean(ref)),
  ));
  if (normalized.length > 0) next.fallbacks = normalized;
  else delete next.fallbacks;
  return Object.keys(next).length > 0 ? next : undefined;
}

export function normalizeModelReferenceConfig(
  value: ModelReferenceConfig | undefined,
  canonicalize: (modelRef: string | undefined) => string | undefined,
): ModelReferenceConfig | undefined {
  if (typeof value === 'string') {
    return canonicalize(value) ?? asNonEmptyString(value);
  }
  if (!isModelReferenceObject(value)) return undefined;

  const next: ModelConfig = { ...value };
  const primary = canonicalize(value.primary);
  if (primary) next.primary = primary;
  else delete next.primary;

  if (Array.isArray(value.fallbacks)) {
    const fallbacks = Array.from(new Set(
      value.fallbacks
        .map((fallback) => canonicalize(fallback))
        .filter((fallback): fallback is string => Boolean(fallback)),
    ));
    if (fallbacks.length > 0) next.fallbacks = fallbacks;
    else delete next.fallbacks;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function rewriteModelReferenceConfig(
  value: ModelReferenceConfig | undefined,
  refs: ReadonlySet<string>,
  replacement?: string,
): ModelReferenceConfig | undefined {
  if (typeof value === 'string') {
    return refs.has(value) ? replacement : value;
  }
  if (!isModelReferenceObject(value)) return value;

  const next: ModelConfig = { ...value };
  if (next.primary && refs.has(next.primary)) {
    if (replacement) next.primary = replacement;
    else delete next.primary;
  }
  if (Array.isArray(next.fallbacks)) {
    const fallbacks = Array.from(new Set(next.fallbacks.flatMap((ref) => {
      if (!refs.has(ref)) return [ref];
      return replacement ? [replacement] : [];
    })));
    if (fallbacks.length > 0) next.fallbacks = fallbacks;
    else delete next.fallbacks;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}
