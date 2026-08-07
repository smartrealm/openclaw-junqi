import type { AgentDefaults, ModelEntry, ModelReferenceConfig } from './types';
import { resolveModelSupportsImage } from '@/utils/providerModelCapabilities';
import { getModelFallbacks, getModelPrimary, setModelPrimary } from './modelReference';

function normalizeProviderIdForCatalog(providerId: string): string {
  const normalized = providerId.trim().toLowerCase();
  if (normalized === 'modelstudio' || normalized === 'qwencloud' || normalized === 'qwen-dashscope') return 'qwen';
  if (normalized === 'kimi-coding' || normalized === 'kimi-code' || normalized === 'kimi') return 'kimi-coding';
  if (normalized === 'z.ai' || normalized === 'z-ai') return 'zai';
  return normalized;
}

function normalizeProviderModelRef(providerId: string, modelId: string | undefined): string | undefined {
  const trimmed = String(modelId ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return undefined;
  if (trimmed.startsWith(`${providerId}/`)) return trimmed;
  const head = trimmed.split('/')[0] || '';
  if (normalizeProviderIdForCatalog(head) === normalizeProviderIdForCatalog(providerId)) return `${providerId}/${trimmed.slice(head.length + 1)}`;
  return `${providerId}/${trimmed}`;
}

function stripProviderNamespace(providerId: string, modelRef: string): string {
  const trimmed = String(modelRef ?? '').trim();
  if (!trimmed) return trimmed;
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0) return trimmed;
  const head = trimmed.slice(0, slashIndex);
  if (normalizeProviderIdForCatalog(head) !== normalizeProviderIdForCatalog(providerId)) return trimmed;
  return trimmed.slice(slashIndex + 1);
}

function buildConfiguredImageSupportMap(models: Record<string, ModelEntry>): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const [id, entry] of Object.entries(models)) {
    const explicitSupport = resolveModelSupportsImage(entry);
    if (typeof explicitSupport === 'boolean') {
      map.set(id, explicitSupport);
      continue;
    }
  }
  return map;
}

function isModelImageCapable(modelRef: string, imageSupportMap?: Map<string, boolean>): boolean {
  const explicitSupport = imageSupportMap?.get(String(modelRef ?? '').trim());
  if (typeof explicitSupport === 'boolean') return explicitSupport;
  return false;
}

function resolveTextPrimaryModel(
  currentConfig: ModelReferenceConfig | undefined,
  availableModelIds: string[],
  requestedPrimary: string | null | undefined,
): string | undefined {
  if (requestedPrimary === null) return undefined;
  if (requestedPrimary !== undefined) {
    return availableModelIds.includes(requestedPrimary)
      ? requestedPrimary
      : getModelPrimary(currentConfig);
  }

  // An omitted override is not proof that an explicit route was removed. The
  // provider mutation domain rewrites a primary when that exact model is
  // deleted; unrelated catalog edits preserve external/plugin-owned defaults.
  return getModelPrimary(currentConfig);
}

function resolveImagePrimaryModel(
  currentConfig: ModelReferenceConfig | undefined,
  currentImagePrimary: string | undefined,
  availableModelIds: string[],
  imageSupportMap?: Map<string, boolean>,
  requestedPrimary?: string | null,
): string | undefined {
  if (requestedPrimary === null) return undefined;
  if (requestedPrimary !== undefined) {
    return availableModelIds.includes(requestedPrimary)
      && isModelImageCapable(requestedPrimary, imageSupportMap)
      ? requestedPrimary
      : undefined;
  }

  // A plugin-owned or externally discovered image model is valid even when the
  // local editor has not loaded its capability metadata yet. Preserve that
  // explicit setting rather than deleting it during an unrelated provider edit.
  if (currentImagePrimary && !availableModelIds.includes(currentImagePrimary)) {
    return currentImagePrimary;
  }
  if (
    currentImagePrimary &&
    availableModelIds.includes(currentImagePrimary) &&
    isModelImageCapable(currentImagePrimary, imageSupportMap)
  ) {
    return currentImagePrimary;
  }
  return getModelFallbacks(currentConfig).find((fallback) => (
    availableModelIds.includes(fallback) && isModelImageCapable(fallback, imageSupportMap)
  ));
}

function modelConfigWithPrimary(
  config: ModelReferenceConfig | undefined,
  primary: string | undefined,
): ModelReferenceConfig | undefined {
  return setModelPrimary(config, primary);
}

export function buildDefaultsWithResolvedModels(params: {
  defaults: AgentDefaults | undefined;
  models: Record<string, ModelEntry>;
  /** `undefined` preserves/reconciles the current route; `null` explicitly clears it. */
  primary?: string | null;
  /** `undefined` preserves/reconciles the current route; `null` explicitly clears it. */
  imagePrimary?: string | null;
}): AgentDefaults {
  const modelIds = Object.keys(params.models);
  const imageSupportMap = buildConfiguredImageSupportMap(params.models);
  const nextPrimary = resolveTextPrimaryModel(
    params.defaults?.model,
    modelIds,
    params.primary,
  );
  const nextImagePrimary = resolveImagePrimaryModel(
    params.defaults?.imageModel,
    getModelPrimary(params.defaults?.imageModel),
    modelIds,
    imageSupportMap,
    params.imagePrimary,
  );

  return {
    ...params.defaults,
    models: params.models,
    model: modelConfigWithPrimary(params.defaults?.model, nextPrimary),
    imageModel: modelConfigWithPrimary(params.defaults?.imageModel, nextImagePrimary),
  };
}

export interface FetchedProviderModel {
  id: string;
  alias?: string;
  supportsImage?: boolean;
}

export interface FetchedProviderModelAddition {
  fullRef: string;
  alias: string;
  supportsImage?: boolean;
}

export function buildFetchedModelAdditions(params: {
  providerId: string;
  fetchedModels: FetchedProviderModel[];
  existingModels: Record<string, ModelEntry>;
}): FetchedProviderModelAddition[] {
  const additions: FetchedProviderModelAddition[] = [];
  const seen = new Set(Object.keys(params.existingModels));

  for (const item of params.fetchedModels) {
    const fullRef = normalizeProviderModelRef(params.providerId, item.id);
    if (!fullRef || seen.has(fullRef)) continue;
    seen.add(fullRef);
    additions.push({
      fullRef,
      alias: item.alias?.trim() || stripProviderNamespace(params.providerId, item.id),
      supportsImage: item.supportsImage,
    });
  }

  return additions;
}

export function applyFetchedModelAdditionsToDefaults(params: {
  defaults: AgentDefaults | undefined;
  additions: FetchedProviderModelAddition[];
}): AgentDefaults {
  const models = { ...(params.defaults?.models ?? {}) };

  for (const { fullRef, alias, supportsImage } of params.additions) {
    models[fullRef] = {
      ...(models[fullRef] ?? {}),
      alias,
      ...(typeof supportsImage === 'boolean'
        ? { supportsImage, input: supportsImage ? ['text', 'image'] : ['text'] }
        : {}),
    };
  }

  return buildDefaultsWithResolvedModels({
    defaults: params.defaults,
    models,
  });
}
