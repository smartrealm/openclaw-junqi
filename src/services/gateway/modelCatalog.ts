import { GENERATED_PROVIDER_CATALOG } from '@/generated/providerCatalog.generated';
import type { ModelEntry } from './modelLoaders';
import { resolveModelSupportsImage } from '@/utils/providerModelCapabilities';

const PROVIDER_ALIASES: Record<string, string> = {
  modelstudio: 'qwen',
  qwencloud: 'qwen',
  'qwen-dashscope': 'qwen',
  'z.ai': 'zai',
  'z-ai': 'zai',
  kimi: 'kimi-coding',
  'kimi-code': 'kimi-coding',
  'kimi-coding': 'kimi-coding',
};

function canonicalProviderId(providerId: string | undefined): string {
  const normalized = String(providerId ?? '').trim().toLowerCase();
  return PROVIDER_ALIASES[normalized] ?? normalized;
}

function canonicalModelRef(modelRef: string | undefined): string | undefined {
  const trimmed = String(modelRef ?? '').trim();
  if (!trimmed) return undefined;
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0) return trimmed;
  const provider = canonicalProviderId(trimmed.slice(0, slashIndex));
  const model = trimmed.slice(slashIndex + 1).trim();
  return provider && model ? `${provider}/${model}` : trimmed;
}

function providerScopedModelId(providerId: string, modelId: string | undefined): string | undefined {
  const trimmed = String(modelId ?? '').trim();
  if (!trimmed) return undefined;
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0) return `${providerId}/${trimmed}`;

  const head = canonicalProviderId(trimmed.slice(0, slashIndex));
  const tail = trimmed.slice(slashIndex + 1).trim();
  return head && tail ? `${head}/${tail}` : canonicalModelRef(trimmed);
}

function addModel(out: Map<string, ModelEntry>, entry: ModelEntry | undefined): void {
  const id = canonicalModelRef(entry?.id);
  if (!id || out.has(id)) return;
  const supportsImage = entry?.supportsImage;
  const alias = entry?.alias?.trim() || undefined;
  out.set(id, {
    id,
    label: entry?.label?.trim() || id,
    ...(alias ? { alias } : {}),
    ...(typeof supportsImage === 'boolean' ? { supportsImage } : {}),
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

function configuredModelPolicy(config: any): string[] {
  const allow = config?.agents?.defaults?.modelPolicy?.allow;
  if (!Array.isArray(allow)) return [];
  return Array.from(new Set(
    allow
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean),
  ));
}

function isModelAllowedByPolicy(
  model: ModelEntry,
  policy: string[],
  configuredModels: Record<string, any>,
): boolean {
  if (policy.length === 0) return true;
  const ref = canonicalModelRef(model.id)?.toLowerCase() ?? '';
  const aliases = new Set<string>();
  if (model.alias) aliases.add(model.alias.trim().toLowerCase());
  for (const [id, entry] of Object.entries(configuredModels)) {
    if (canonicalModelRef(id)?.toLowerCase() !== ref) continue;
    if (typeof entry?.alias === 'string' && entry.alias.trim()) {
      aliases.add(entry.alias.trim().toLowerCase());
    }
  }

  return policy.some((rule) => {
    const normalizedRule = rule.toLowerCase();
    if (aliases.has(normalizedRule)) return true;
    if (normalizedRule.endsWith('*')) return ref.startsWith(normalizedRule.slice(0, -1));
    return ref === normalizedRule;
  });
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

  // `agents.defaults.models` is metadata, not a provider catalog. It can
  // enrich merge-mode fallbacks, but wildcards and replace-mode entries must
  // never become selectable concrete models on their own.
  if (!replaceCatalog) {
    for (const [id, cfg] of Object.entries(configuredModels)) {
      if (id.endsWith('/*')) continue;
      addModel(out, {
        id,
        label: id,
        alias: typeof (cfg as any)?.alias === 'string' ? (cfg as any).alias : undefined,
        supportsImage: resolveModelSupportsImage(cfg),
      });
    }
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

  const policy = configuredModelPolicy(config);
  return [...out.values()].filter((model) => isModelAllowedByPolicy(model, policy, configuredModels));
}
