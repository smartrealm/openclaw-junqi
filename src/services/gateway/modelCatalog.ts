import { GENERATED_PROVIDER_CATALOG } from '@/generated/providerCatalog.generated';
import type { ModelEntry } from './modelLoaders';
import { resolveModelSupportsImage } from '@/utils/providerModelCapabilities';
import {
  canonicalModelRef,
  canonicalProviderId,
  providerScopedModelId,
} from './modelIdentity';
import {
  inspectInstalledModelVisibility,
  installedSyntheticVisibleModelRefs,
  isModelVisibleForInstalledRuntime,
} from './modelVisibility';

function addModel(out: Map<string, ModelEntry>, entry: ModelEntry | undefined): void {
  const id = canonicalModelRef(entry?.id);
  if (!id) return;
  const current = out.get(id);
  const supportsImage = entry?.supportsImage;
  const alias = entry?.alias?.trim() || undefined;
  out.set(id, {
    id,
    label: current?.label && current.label !== id
      ? current.label
      : entry?.label?.trim() || id,
    ...(current?.alias || alias ? { alias: current?.alias ?? alias } : {}),
    ...(typeof current?.supportsImage === 'boolean'
      ? { supportsImage: current.supportsImage }
      : typeof supportsImage === 'boolean'
        ? { supportsImage }
        : {}),
  });
}

function configuredProviderIds(config: any): Set<string> {
  const ids = new Set<string>();

  for (const providerId of Object.keys(config?.models?.providers ?? {})) {
    const canonical = canonicalProviderId(providerId);
    if (canonical) ids.add(canonical);
  }

  for (const [profileKey, profile] of Object.entries(config?.auth?.profiles ?? {})) {
    const rawProvider =
      typeof (profile as any)?.provider === 'string'
        ? (profile as any).provider
        : String(profileKey).split(':')[0];
    const canonical = canonicalProviderId(rawProvider);
    if (canonical) ids.add(canonical);
  }

  return ids;
}

export function hasConfiguredModelProviders(config: any): boolean {
  const p = config ?? {};
  return configuredProviderIds(p).size > 0
    || Object.keys(p.models?.providers ?? {}).length > 0
    || Object.keys(p.env?.vars ?? {}).length > 0;
}

/** Parse the live `models.list` response without guessing at provider catalogs. */
export function extractAvailableModelsFromGatewayResult(result: unknown): ModelEntry[] {
  const out = new Map<string, ModelEntry>();
  const add = (value: any) => {
    if (!value || value.available === false) return;
    if (typeof value === 'string') {
      addModel(out, { id: value, label: value });
      return;
    }
    if (typeof value !== 'object') return;
    const provider = canonicalProviderId(value.provider);
    const rawId = String(value.id ?? value.model ?? '').trim();
    const id = provider
      ? providerScopedModelId(provider, rawId)
      : canonicalModelRef(rawId);
    if (!id) return;
    addModel(out, {
      id,
      label: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : id,
      alias: typeof value.alias === 'string' ? value.alias : undefined,
      supportsImage: resolveModelSupportsImage(value),
    });
  };

  if (Array.isArray(result)) {
    result.forEach(add);
  } else if (result && typeof result === 'object') {
    const models = (result as any).models;
    if (Array.isArray(models)) {
      models.forEach(add);
    } else if (models && typeof models === 'object') {
      for (const [id, value] of Object.entries(models as Record<string, any>)) {
        add({ id, ...(value ?? {}) });
      }
    }
  }
  return [...out.values()];
}

export function extractAvailableModelsFromConfig(config: any): ModelEntry[] {
  const out = new Map<string, ModelEntry>();
  const providers = config?.models?.providers ?? {};
  const configuredModels = config?.agents?.defaults?.models ?? {};
  const replaceCatalog = config?.models?.mode === 'replace';
  const visibility = inspectInstalledModelVisibility(config);

  // The pinned Runtime synthesizes exact configured refs even when catalog
  // discovery cannot provide a row for them. Wildcards remain rules only.
  for (const id of installedSyntheticVisibleModelRefs(visibility)) {
    const cfg = configuredModels[id];
    addModel(out, {
      id,
      label: id,
      alias: typeof cfg?.alias === 'string' ? cfg.alias : undefined,
      supportsImage: resolveModelSupportsImage(cfg),
    });
  }

  for (const [rawProviderId, providerConfig] of Object.entries(providers)) {
    const providerId = canonicalProviderId(rawProviderId);
    if (!providerId) continue;
    const explicitModels = Array.isArray((providerConfig as any)?.models)
      ? (providerConfig as any).models
      : [];

    for (const model of explicitModels) {
      const id = providerScopedModelId(providerId, model?.id);
      const configuredEntry = id ? configuredModels[id] : undefined;
      addModel(out, {
        id: id ?? '',
        label: typeof model?.name === 'string' && model.name.trim() ? model.name.trim() : (id ?? ''),
        alias: typeof model?.suggestedAlias === 'string'
          ? model.suggestedAlias
          : typeof configuredEntry?.alias === 'string'
            ? configuredEntry.alias
            : undefined,
        supportsImage: resolveModelSupportsImage(model),
      });
    }
  }

  if (!replaceCatalog) {
    for (const providerId of configuredProviderIds(config)) {
      const rows = GENERATED_PROVIDER_CATALOG[providerId] ?? [];
      for (const row of rows) {
        addModel(out, {
          id: row.id,
          label: row.id,
          alias: row.suggestedAlias,
          supportsImage: row.supportsImage,
        });
      }
    }
  }

  return [...out.values()].filter((model) => (
    isModelVisibleForInstalledRuntime(model.id, visibility)
  ));
}
