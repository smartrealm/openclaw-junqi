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
  out.set(id, {
    id,
    label: entry?.label?.trim() || id,
    alias: entry?.alias?.trim() || undefined,
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

export function extractAvailableModelsFromConfig(config: any): ModelEntry[] {
  const out = new Map<string, ModelEntry>();
  const providers = config?.models?.providers ?? {};

  for (const [id, cfg] of Object.entries(config?.agents?.defaults?.models ?? {})) {
    addModel(out, {
      id,
      label: id,
      alias: typeof (cfg as any)?.alias === 'string' ? (cfg as any).alias : undefined,
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
      addModel(out, {
        id: id ?? '',
        label: typeof model?.name === 'string' && model.name.trim() ? model.name.trim() : (id ?? ''),
        alias: typeof model?.suggestedAlias === 'string' ? model.suggestedAlias : undefined,
        supportsImage: resolveModelSupportsImage(model),
      });
    }
  }

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

  return [...out.values()];
}
