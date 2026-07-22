import { GENERATED_PROVIDER_CATALOG } from '@/generated/providerCatalog.generated';
import type { AgentDefaults, ModelEntry, ModelReferenceConfig } from './types';
import { resolveModelSupportsImage } from '@/utils/providerModelCapabilities';
import { getModelPrimary, setModelPrimary } from './modelReference';

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

function resolveGeneratedModelSupportsImage(modelRef: string): boolean | undefined {
  const normalizedRef = String(modelRef ?? '').trim();
  const slashIndex = normalizedRef.indexOf('/');
  if (slashIndex <= 0) return undefined;
  const providerId = normalizedRef.slice(0, slashIndex);
  const rows = GENERATED_PROVIDER_CATALOG[normalizeProviderIdForCatalog(providerId)] ?? [];
  const row = rows.find((entry) => normalizeProviderModelRef(providerId, entry.id) === normalizedRef);
  return row?.supportsImage;
}

function buildConfiguredImageSupportMap(models: Record<string, ModelEntry>): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const [id, entry] of Object.entries(models)) {
    const explicitSupport = resolveModelSupportsImage(entry);
    if (typeof explicitSupport === 'boolean') {
      map.set(id, explicitSupport);
      continue;
    }
    const generatedSupport = resolveGeneratedModelSupportsImage(id);
    if (typeof generatedSupport === 'boolean') {
      map.set(id, generatedSupport);
    }
  }
  return map;
}

function isModelImageCapable(modelRef: string, imageSupportMap?: Map<string, boolean>): boolean {
  const explicitSupport = imageSupportMap?.get(String(modelRef ?? '').trim());
  if (typeof explicitSupport === 'boolean') return explicitSupport;
  return resolveGeneratedModelSupportsImage(modelRef) === true;
}

function resolveImagePrimaryModel(
  currentImagePrimary: string | undefined,
  availableModelIds: string[],
  imageSupportMap?: Map<string, boolean>,
): string | undefined {
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
  return availableModelIds.find((id) => isModelImageCapable(id, imageSupportMap));
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
  primary?: string | undefined;
  imagePrimary?: string | undefined;
}): AgentDefaults {
  const modelIds = Object.keys(params.models);
  const imageSupportMap = buildConfiguredImageSupportMap(params.models);
  const requestedPrimary = params.primary ?? getModelPrimary(params.defaults?.model);
  const nextPrimary =
    requestedPrimary && modelIds.includes(requestedPrimary)
      ? requestedPrimary
      : modelIds[0] ?? undefined;
  const nextImagePrimary = resolveImagePrimaryModel(
    params.imagePrimary ?? getModelPrimary(params.defaults?.imageModel),
    modelIds,
    imageSupportMap,
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
