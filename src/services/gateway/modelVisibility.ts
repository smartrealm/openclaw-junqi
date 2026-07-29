import { canonicalModelRef, canonicalProviderId } from './modelIdentity';

interface ModelReferenceObject {
  primary?: unknown;
  fallbacks?: unknown;
}

export interface InstalledModelVisibilityConfig {
  agents?: {
    defaults?: {
      model?: unknown;
      models?: unknown;
    };
  };
}

export interface InstalledModelVisibility {
  hasEntries: boolean;
  exactModelRefs: string[];
  providerWildcards: string[];
  primary?: string;
  fallbacks: string[];
}

function nonEmptyModelRef(value: unknown): string | undefined {
  return typeof value === 'string' ? canonicalModelRef(value) : undefined;
}

function modelReferenceObject(value: unknown): ModelReferenceObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ModelReferenceObject
    : undefined;
}

function configuredModelKeys(config: InstalledModelVisibilityConfig): string[] {
  const models = config.agents?.defaults?.models;
  if (!models || typeof models !== 'object' || Array.isArray(models)) return [];
  return Object.keys(models).map((key) => key.trim()).filter(Boolean);
}

export function inspectInstalledModelVisibility(
  config: InstalledModelVisibilityConfig,
): InstalledModelVisibility {
  const model = config.agents?.defaults?.model;
  const objectModel = modelReferenceObject(model);
  const primary = nonEmptyModelRef(typeof model === 'string' ? model : objectModel?.primary);
  const fallbacks = Array.isArray(objectModel?.fallbacks)
    ? Array.from(new Set(objectModel.fallbacks.map(nonEmptyModelRef).filter((ref): ref is string => Boolean(ref))))
    : [];
  const keys = configuredModelKeys(config);
  const exactModelRefs: string[] = [];
  const providerWildcards: string[] = [];

  for (const key of keys) {
    if (key.endsWith('/*')) {
      const provider = canonicalProviderId(key.slice(0, -2));
      if (provider && !providerWildcards.includes(provider)) providerWildcards.push(provider);
      continue;
    }
    const ref = canonicalModelRef(key);
    if (ref && !exactModelRefs.includes(ref)) exactModelRefs.push(ref);
  }

  return {
    hasEntries: keys.length > 0,
    exactModelRefs,
    providerWildcards,
    primary,
    fallbacks,
  };
}

function providerFromModelRef(modelRef: string): string {
  const slash = modelRef.indexOf('/');
  return slash > 0 ? canonicalProviderId(modelRef.slice(0, slash)) : '';
}

/** Mirrors the configured-model visibility rules in pinned OpenClaw 2026.7.1. */
export function isModelVisibleForInstalledRuntime(
  modelRef: string,
  visibility: InstalledModelVisibility,
): boolean {
  const ref = canonicalModelRef(modelRef);
  if (!ref) return false;
  if (!visibility.hasEntries) return true;
  if (visibility.exactModelRefs.includes(ref)) return true;

  const providerAllowed = visibility.providerWildcards.includes(providerFromModelRef(ref));
  if (providerAllowed) return true;
  if (visibility.exactModelRefs.length > 0 && visibility.fallbacks.includes(ref)) return true;
  return ref === visibility.primary
    && visibility.exactModelRefs.length > 0
    && visibility.providerWildcards.length === 0;
}

/** Refs the Runtime adds even when they are absent from its discovered catalog. */
export function installedSyntheticVisibleModelRefs(
  visibility: InstalledModelVisibility,
): string[] {
  if (!visibility.hasEntries) return [];
  const refs = [...visibility.exactModelRefs];
  if (visibility.exactModelRefs.length > 0) refs.push(...visibility.fallbacks);
  if (visibility.primary && isModelVisibleForInstalledRuntime(visibility.primary, visibility)) {
    refs.push(visibility.primary);
  }
  return Array.from(new Set(refs));
}
