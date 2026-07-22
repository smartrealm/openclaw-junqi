import type {
  GatewayRuntimeConfig,
  ModelEntry,
  ModelProviderConfig,
  ModelProviderModelEntry,
} from './types';
import { buildDefaultsWithResolvedModels } from './providerDefaults';
import { resolveModelSupportsImage } from '@/utils/providerModelCapabilities';
import { getModelPrimary, rewriteModelReferenceConfig } from './modelReference';

function normalizeProviderId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'modelstudio' || normalized === 'qwencloud' || normalized === 'qwen-dashscope') return 'qwen';
  if (normalized === 'kimi' || normalized === 'kimi-code') return 'kimi-coding';
  if (normalized === 'z.ai' || normalized === 'z-ai') return 'zai';
  return normalized;
}

function providerIdsMatch(left: string, right: string): boolean {
  return normalizeProviderId(left) === normalizeProviderId(right);
}

function normalizeModelRef(providerId: string, modelId: string): string | undefined {
  const provider = normalizeProviderId(providerId);
  const model = modelId.trim().replace(/^\/+|\/+$/g, '');
  if (!provider || !model) return undefined;
  const slash = model.indexOf('/');
  if (slash > 0 && providerIdsMatch(model.slice(0, slash), provider)) {
    return `${provider}/${model.slice(slash + 1)}`;
  }
  return `${provider}/${model}`;
}

export function canonicalizeProviderModelRef(providerId: string, modelId: string): string | undefined {
  return normalizeModelRef(providerId, modelId);
}

export function buildEditableProviderModels(
  providerId: string,
  agentModels: Record<string, ModelEntry>,
  providerConfig?: ModelProviderConfig,
): Record<string, ModelEntry> {
  const matchingAgentModels = Object.entries(agentModels).filter(([ref]) => {
      const slash = ref.indexOf('/');
      return slash > 0 && providerIdsMatch(ref.slice(0, slash), providerId);
    });
  const canonicalProvider = normalizeProviderId(providerId);
  const orderedAgentModels = [
    ...matchingAgentModels.filter(([ref]) => ref.slice(0, ref.indexOf('/')).toLowerCase() !== canonicalProvider),
    ...matchingAgentModels.filter(([ref]) => ref.slice(0, ref.indexOf('/')).toLowerCase() === canonicalProvider),
  ];
  const models: Record<string, ModelEntry> = {};
  for (const [ref, entry] of orderedAgentModels) {
    const canonicalRef = normalizeModelRef(providerId, ref);
    if (!canonicalRef) continue;
    if (stripProviderPrefix(providerId, canonicalRef) === '*') continue;
    models[canonicalRef] = { ...(models[canonicalRef] ?? {}), ...entry };
  }

  for (const providerModel of providerConfig?.models ?? []) {
    const ref = normalizeModelRef(providerId, providerModel.id);
    if (!ref) continue;
    const current = models[ref] ?? {};
    const supportsImage = resolveModelSupportsImage(providerModel);
    const rawId = stripProviderPrefix(providerId, ref);
    const displayName = String(providerModel.name ?? '').trim();
    models[ref] = {
      ...(displayName && displayName !== rawId ? { alias: displayName } : {}),
      ...(typeof supportsImage === 'boolean'
        ? { supportsImage, input: providerModel.input }
        : {}),
      ...current,
    };
  }
  return models;
}

function stripProviderPrefix(providerId: string, modelRef: string): string {
  const trimmed = modelRef.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || !providerIdsMatch(trimmed.slice(0, slash), providerId)) return trimmed;
  return trimmed.slice(slash + 1);
}

function mergeEquivalentProviderConfigs(
  providers: Record<string, ModelProviderConfig>,
  providerId: string,
): {
  providerKey: string;
  matchingKeys: string[];
  config: ModelProviderConfig;
} {
  const providerKey = normalizeProviderId(providerId);
  const matchingKeys = Object.keys(providers).filter((key) => providerIdsMatch(key, providerId));
  // Merge legacy aliases first so an already-canonical entry remains the
  // authoritative source for conflicting scalar settings.
  const orderedKeys = [
    ...matchingKeys.filter((key) => key.trim().toLowerCase() !== providerKey),
    ...matchingKeys.filter((key) => key.trim().toLowerCase() === providerKey),
  ];
  let config: ModelProviderConfig = {};
  let hasExplicitModels = false;
  const models = new Map<string, ModelProviderModelEntry>();

  for (const key of orderedKeys) {
    const current = providers[key] ?? {};
    const { models: currentModels, ...rest } = current;
    config = { ...config, ...rest };
    if (!Array.isArray(currentModels)) continue;
    hasExplicitModels = true;
    for (const model of currentModels) {
      const rawId = stripProviderPrefix(providerKey, String(model?.id ?? ''));
      if (!rawId) continue;
      models.set(rawId, {
        ...(models.get(rawId) ?? {}),
        ...model,
        id: rawId,
      });
    }
  }

  if (hasExplicitModels) config.models = Array.from(models.values());
  return { providerKey, matchingKeys, config };
}

function setImageCapability(input: unknown, supportsImage: boolean): string[] {
  const allowedModalities = new Set(['text', 'image', 'video', 'audio']);
  const source = input && typeof input === 'object' ? input as Record<string, any> : undefined;
  const rawModalities = Array.isArray(input)
    ? input
    : Array.isArray(source?.input)
      ? source.input
      : Array.isArray(source?.modalities?.input)
        ? source.modalities.input
        : Array.isArray(source?.architecture?.input_modalities)
          ? source.architecture.input_modalities
          : ['text'];
  const modalities: string[] = (rawModalities as unknown[])
    .map((item: unknown) => String(item).trim().toLowerCase())
    .filter((item: string) => allowedModalities.has(item));
  const next = new Set<string>(modalities.length > 0 ? modalities : ['text']);
  if (supportsImage) next.add('image');
  else next.delete('image');
  return [...next];
}

function findEquivalentModelRefs(
  models: Record<string, ModelEntry>,
  providerId: string,
  modelRef: string,
): string[] {
  const provider = normalizeProviderId(providerId);
  const rawId = stripProviderPrefix(provider, modelRef);
  return Object.keys(models).filter((ref) => {
    if (ref === modelRef) return true;
    const slash = ref.indexOf('/');
    if (slash <= 0) return false;
    return providerIdsMatch(ref.slice(0, slash), provider) && ref.slice(slash + 1) === rawId;
  });
}

function rewriteAgentModelReferences(
  config: GatewayRuntimeConfig,
  refs: ReadonlySet<string>,
  replacement?: string,
): Pick<GatewayRuntimeConfig, 'agents'>['agents'] {
  const defaults = config.agents?.defaults;
  const list = config.agents?.list?.map((agent) => ({
    ...agent,
    model: rewriteModelReferenceConfig(agent.model, refs, replacement),
    imageModel: rewriteModelReferenceConfig(agent.imageModel, refs, replacement),
    imageGenerationModel: rewriteModelReferenceConfig(agent.imageGenerationModel, refs, replacement),
    videoGenerationModel: rewriteModelReferenceConfig(agent.videoGenerationModel, refs, replacement),
  }));
  return {
    ...config.agents,
    defaults: defaults
      ? {
        ...defaults,
        model: rewriteModelReferenceConfig(defaults.model, refs, replacement),
        imageModel: rewriteModelReferenceConfig(defaults.imageModel, refs, replacement),
        imageGenerationModel: rewriteModelReferenceConfig(defaults.imageGenerationModel, refs, replacement),
        videoGenerationModel: rewriteModelReferenceConfig(defaults.videoGenerationModel, refs, replacement),
      }
      : defaults,
    list,
  };
}

function upsertProviderModel(params: {
  config: GatewayRuntimeConfig;
  providerId: string;
  modelRef: string;
  supportsImage?: boolean;
  providerPatch?: Partial<ModelProviderModelEntry>;
}): GatewayRuntimeConfig {
  const providers = { ...(params.config.models?.providers ?? {}) };
  const { providerKey, matchingKeys, config: current } = mergeEquivalentProviderConfigs(
    providers,
    params.providerId,
  );
  const rawId = stripProviderPrefix(providerKey, params.modelRef);
  const currentModels = Array.isArray(current.models) ? current.models : [];
  const index = currentModels.findIndex((model) => stripProviderPrefix(providerKey, String(model?.id ?? '')) === rawId);
  const existingModel = index >= 0 ? currentModels[index] : undefined;
  const nextModel: ModelProviderModelEntry = {
    ...(existingModel ?? {}),
    ...(params.providerPatch ?? {}),
    id: rawId,
    name: params.providerPatch?.name || existingModel?.name || rawId,
    ...(typeof params.supportsImage === 'boolean'
      ? { input: setImageCapability(existingModel, params.supportsImage) }
      : {}),
  };
  const models = [...currentModels];
  if (index >= 0) models[index] = nextModel;
  else models.push(nextModel);
  for (const key of matchingKeys) delete providers[key];
  providers[providerKey] = { ...current, models };
  return { ...params.config, models: { ...params.config.models, providers } };
}

function upsertAgentModel(params: {
  config: GatewayRuntimeConfig;
  providerId: string;
  modelRef: string;
  originalRef?: string;
  update: (current: ModelEntry) => ModelEntry;
}): GatewayRuntimeConfig {
  const currentModels = params.config.agents?.defaults?.models ?? {};
  const equivalentRefs = findEquivalentModelRefs(currentModels, params.providerId, params.modelRef);
  const orderedRefs = [
    ...equivalentRefs.filter((ref) => ref !== params.modelRef),
    ...equivalentRefs.filter((ref) => ref === params.modelRef),
  ];
  const current = orderedRefs.reduce<ModelEntry>(
    (merged, ref) => ({ ...merged, ...(currentModels[ref] ?? {}) }),
    {},
  );
  const models = { ...currentModels };
  for (const ref of equivalentRefs) delete models[ref];
  models[params.modelRef] = params.update(current);

  const refs = new Set([
    ...equivalentRefs,
    params.modelRef,
    ...(params.originalRef?.trim() ? [params.originalRef.trim()] : []),
  ]);
  const agents = rewriteAgentModelReferences(params.config, refs, params.modelRef);
  return {
    ...params.config,
    agents: {
      ...agents,
      defaults: buildDefaultsWithResolvedModels({
        defaults: agents?.defaults,
        models,
      }),
    },
  };
}

export function addProviderModel(params: {
  config: GatewayRuntimeConfig;
  providerId: string;
  modelId: string;
  alias?: string;
  supportsImage?: boolean;
}): GatewayRuntimeConfig {
  const modelRef = normalizeModelRef(params.providerId, params.modelId);
  if (!modelRef) return params.config;
  if (stripProviderPrefix(params.providerId, modelRef) === '*') return params.config;
  const withProviderModel = upsertProviderModel({ ...params, config: params.config, modelRef });
  const alias = params.alias?.trim();
  const next = upsertAgentModel({
    config: withProviderModel,
    providerId: params.providerId,
    modelRef,
    originalRef: params.modelId,
    update: (existing) => ({
      ...existing,
      ...(alias ? { alias } : {}),
      ...(typeof params.supportsImage === 'boolean'
        ? {
          supportsImage: params.supportsImage,
          input: setImageCapability(existing, params.supportsImage),
        }
        : {}),
    }),
  });
  return next;
}

export function updateProviderModel(params: {
  config: GatewayRuntimeConfig;
  providerId: string;
  modelRef: string;
  alias?: string;
  supportsImage?: boolean;
  providerPatch?: Partial<ModelProviderModelEntry>;
}): GatewayRuntimeConfig {
  const normalizedRef = normalizeModelRef(params.providerId, params.modelRef);
  if (!normalizedRef) return params.config;
  const withProviderModel = typeof params.supportsImage === 'boolean' || params.providerPatch
    ? upsertProviderModel({ ...params, config: params.config, modelRef: normalizedRef })
    : params.config;
  const next = upsertAgentModel({
    config: withProviderModel,
    providerId: params.providerId,
    modelRef: normalizedRef,
    originalRef: params.modelRef,
    update: (current) => {
      const next: ModelEntry = { ...current };
      if (params.alias !== undefined) {
        const alias = params.alias.trim();
        if (alias) next.alias = alias;
        else delete next.alias;
      }
      if (typeof params.supportsImage === 'boolean') {
        next.supportsImage = params.supportsImage;
        next.input = setImageCapability(current, params.supportsImage);
      }
      return next;
    },
  });
  if (params.supportsImage !== false) return next;

  const disabledRefs = new Set([normalizedRef, params.modelRef.trim()]);
  const fallbackImageModel = getModelPrimary(next.agents?.defaults?.imageModel);
  return {
    ...next,
    agents: {
      ...next.agents,
      list: next.agents?.list?.map((agent) => ({
        ...agent,
        imageModel: rewriteModelReferenceConfig(
          agent.imageModel,
          disabledRefs,
          fallbackImageModel,
        ),
      })),
    },
  };
}

export function removeProviderModel(params: {
  config: GatewayRuntimeConfig;
  providerId: string;
  modelRef: string;
}): GatewayRuntimeConfig {
  const normalizedRef = normalizeModelRef(params.providerId, params.modelRef);
  if (!normalizedRef) return params.config;
  const models = { ...(params.config.agents?.defaults?.models ?? {}) };
  const refs = new Set([
    normalizedRef,
    params.modelRef.trim(),
    ...findEquivalentModelRefs(models, params.providerId, normalizedRef),
  ]);
  for (const ref of refs) delete models[ref];

  const providers = { ...(params.config.models?.providers ?? {}) };
  const mergedProvider = mergeEquivalentProviderConfigs(providers, params.providerId);
  if (mergedProvider.matchingKeys.length > 0) {
    const rawId = stripProviderPrefix(params.providerId, normalizedRef);
    for (const key of mergedProvider.matchingKeys) delete providers[key];
    providers[mergedProvider.providerKey] = {
      ...mergedProvider.config,
      models: (mergedProvider.config.models ?? []).filter(
        (model) => stripProviderPrefix(params.providerId, String(model?.id ?? '')) !== rawId,
      ),
    };
  }

  const agents = rewriteAgentModelReferences(params.config, refs);
  const defaults = buildDefaultsWithResolvedModels({ defaults: agents?.defaults, models });

  return {
    ...params.config,
    models: { ...params.config.models, providers },
    agents: { ...agents, defaults },
  };
}
