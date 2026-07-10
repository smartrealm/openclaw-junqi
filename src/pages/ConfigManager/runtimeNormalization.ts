import type { GatewayRuntimeConfig } from './types';
import { resolveModelSupportsImage } from '@/utils/providerModelCapabilities';

export interface GeneratedProviderCatalogEntry {
  id: string;
  supportsImage?: boolean;
}

function ensureMainAgentInList(list: GatewayRuntimeConfig['agents'] extends { list?: infer T } ? T : any): any {
  const items = Array.isArray(list) ? list : [];
  const existingMain = items.find((item: any) => item?.id === 'main');
  const main = existingMain && typeof existingMain === 'object' ? existingMain : { id: 'main' };
  const others = items.filter((item: any) => item?.id !== 'main');
  return [main, ...others];
}

function sanitizeAgentModelEntry(value: any): Record<string, any> {
  if (!value || typeof value !== 'object') return {};

  const next: Record<string, any> = {};
  if (typeof value.alias === 'string') next.alias = value.alias;
  if (value.params && typeof value.params === 'object' && !Array.isArray(value.params)) {
    next.params = value.params;
  }
  if (value.agentRuntime && typeof value.agentRuntime === 'object' && !Array.isArray(value.agentRuntime)) {
    next.agentRuntime = value.agentRuntime;
  }
  if (typeof value.streaming === 'boolean') next.streaming = value.streaming;
  return next;
}

const PROVIDER_MODEL_RUNTIME_FIELDS = [
  'api',
  'baseUrl',
  'reasoning',
  'cost',
  'contextWindow',
  'contextTokens',
  'maxTokens',
  'thinkingLevelMap',
  'params',
  'agentRuntime',
  'headers',
  'compat',
  'mediaInput',
  'metadataSource',
] as const;

function sanitizeProviderModelEntry(
  value: any,
  strippedId: string,
  supportsImage: boolean,
): Record<string, any> | undefined {
  const id = String(strippedId ?? '').trim();
  if (!id) return undefined;

  const source = value && typeof value === 'object' ? value as Record<string, any> : {};
  const next: Record<string, any> = {};
  for (const field of PROVIDER_MODEL_RUNTIME_FIELDS) {
    if (source[field] !== undefined) next[field] = source[field];
  }

  const validModalities = new Set(['text', 'image', 'video', 'audio']);
  const rawModalities = Array.isArray(source.input)
    ? source.input
    : Array.isArray(source.modalities?.input)
      ? source.modalities.input
      : Array.isArray(source.architecture?.input_modalities)
        ? source.architecture.input_modalities
        : ['text'];
  const modalities = rawModalities
    .map((item: unknown) => String(item).trim().toLowerCase())
    .filter((item: string) => validModalities.has(item));
  const input = new Set(modalities.length > 0 ? modalities : ['text']);
  if (supportsImage) input.add('image');
  else input.delete('image');

  next.id = id;
  next.name = typeof source.name === 'string' && source.name.trim()
    ? source.name.trim()
    : id;
  next.input = [...input];
  return next;
}

export function normalizeModelsProvidersForRuntime(params: {
  providers: Record<string, any> | undefined;
  agents?: GatewayRuntimeConfig['agents'] | undefined;
  generatedProviderCatalog: Record<string, GeneratedProviderCatalogEntry[]>;
  canonicalProviderId: (providerId: string | undefined) => string;
  stripProviderPrefix: (providerId: string, modelId: string | undefined) => string;
  canonicalizeModelRef?: (modelRef: string | undefined) => string | undefined;
  getTemplateById: (providerId: string) => unknown;
}): Record<string, any> | undefined {
  const { providers } = params;
  if (!providers) return providers;

  const groups = new Map<string, Array<[string, any]>>();
  for (const [providerId, providerConfig] of Object.entries(providers)) {
    const canonicalId = params.canonicalProviderId(providerId) || providerId;
    const group = groups.get(canonicalId) ?? [];
    group.push([providerId, providerConfig]);
    groups.set(canonicalId, group);
  }

  const out: Record<string, any> = {};
  for (const [canonicalId, entries] of groups) {
    const template = params.getTemplateById(canonicalId);
    const generatedRows = params.generatedProviderCatalog[canonicalId] ?? [];
    const knownModelIds = new Set(
      generatedRows.map((model) => params.stripProviderPrefix(canonicalId, model.id))
    );
    const orderedEntries = [
      ...entries.filter(([providerId]) => providerId.trim().toLowerCase() !== canonicalId),
      ...entries.filter(([providerId]) => providerId.trim().toLowerCase() === canonicalId),
    ];
    const normalizedModels = new Map<string, Record<string, any>>();
    let hasExplicitModels = false;
    let next: Record<string, any> = {};

    for (const [, providerConfig] of orderedEntries) {
      const { models, ...providerFields } = providerConfig ?? {};
      next = { ...next, ...providerFields };
      if (!Array.isArray(models)) continue;
      hasExplicitModels = true;
      for (const model of models) {
          const strippedId = params.stripProviderPrefix(canonicalId, String(model?.id ?? ''));
          const generatedSupport = knownModelIds.has(strippedId)
            ? generatedRows.find(
              (row) => params.stripProviderPrefix(canonicalId, row.id) === strippedId
            )?.supportsImage
            : undefined;
          const supportsImage = resolveModelSupportsImage(model) ?? generatedSupport ?? false;
          const sanitized = sanitizeProviderModelEntry(model, strippedId, supportsImage);
          if (!sanitized) continue;
          normalizedModels.set(strippedId, {
            ...(normalizedModels.get(strippedId) ?? {}),
            ...sanitized,
          });
      }
    }

    // `agents.defaults.models` is the enabled-model set exposed by the UI.
    // When a provider has an explicit models array, OpenClaw treats that array
    // as the provider catalog. Fill only missing rows so a partial provider
    // declaration cannot make an enabled/default model unresolvable.
    for (const [modelRef, agentEntry] of Object.entries(params.agents?.defaults?.models ?? {})) {
      const normalizedRef = params.canonicalizeModelRef?.(modelRef) ?? modelRef;
      const slashIndex = normalizedRef.indexOf('/');
      if (slashIndex <= 0) continue;
      const modelProvider = params.canonicalProviderId(normalizedRef.slice(0, slashIndex));
      if (modelProvider !== canonicalId) continue;

      const strippedId = params.stripProviderPrefix(canonicalId, normalizedRef);
      if (!strippedId || normalizedModels.has(strippedId)) continue;
      const generatedSupport = generatedRows.find(
        (row) => params.stripProviderPrefix(canonicalId, row.id) === strippedId
      )?.supportsImage;
      const supportsImage = resolveModelSupportsImage(agentEntry) ?? generatedSupport ?? false;
      const alias = typeof agentEntry?.alias === 'string' ? agentEntry.alias.trim() : '';
      const sanitized = sanitizeProviderModelEntry(
        {
          name: alias || strippedId,
          input: Array.isArray(agentEntry?.input) ? agentEntry.input : undefined,
        },
        strippedId,
        supportsImage,
      );
      if (sanitized) normalizedModels.set(strippedId, sanitized);
    }

    if (hasExplicitModels || normalizedModels.size > 0) {
      next.models = Array.from(normalizedModels.values());
    } else if (template) {
      next.models = [];
    }

    out[canonicalId] = next;
  }

  return out;
}

export function normalizeAgentsForRuntime(params: {
  agents: GatewayRuntimeConfig['agents'] | undefined;
  providers?: Record<string, any> | undefined;
  generatedProviderCatalog: Record<string, GeneratedProviderCatalogEntry[]>;
  canonicalizeModelRef: (modelRef: string | undefined) => string | undefined;
}): GatewayRuntimeConfig['agents'] | undefined {
  const { agents } = params;
  if (!agents?.defaults) return agents;

  const nextModels = agents.defaults.models
    ? (() => {
      const entries = Object.entries(agents.defaults.models).map(([id, value]) => ({
        id,
        normalizedId: params.canonicalizeModelRef(id) ?? id,
        value,
      }));
      const orderedEntries = [
        ...entries.filter((entry) => entry.id !== entry.normalizedId),
        ...entries.filter((entry) => entry.id === entry.normalizedId),
      ];
      return orderedEntries.reduce<Record<string, Record<string, any>>>((out, entry) => {
        out[entry.normalizedId] = {
          ...(out[entry.normalizedId] ?? {}),
          ...sanitizeAgentModelEntry(entry.value),
        };
        return out;
      }, {});
    })()
    : agents.defaults.models;

  const modelSupportMap = new Map<string, boolean>();
  for (const rows of Object.values(params.generatedProviderCatalog)) {
    for (const model of rows) {
      const normalizedId = params.canonicalizeModelRef(model.id);
      if (!normalizedId || typeof model.supportsImage !== 'boolean') continue;
      modelSupportMap.set(normalizedId, model.supportsImage);
    }
  }
  for (const [providerId, providerConfig] of Object.entries(params.providers ?? {})) {
    const canonicalProvider = providerId.trim().toLowerCase();
    const models = Array.isArray((providerConfig as any)?.models) ? (providerConfig as any).models : [];
    for (const model of models) {
      const normalizedId = params.canonicalizeModelRef(
        `${canonicalProvider}/${String(model?.id ?? '').trim()}`
      );
      const supportsImage = resolveModelSupportsImage(model);
      if (!normalizedId || typeof supportsImage !== 'boolean') continue;
      modelSupportMap.set(normalizedId, supportsImage);
    }
  }

  const primaryModelRef = params.canonicalizeModelRef(agents.defaults.model?.primary);
  const requestedImageModelRef = params.canonicalizeModelRef(agents.defaults.imageModel?.primary);
  const nextImagePrimary =
    requestedImageModelRef && modelSupportMap.get(requestedImageModelRef) === true
      ? requestedImageModelRef
      : primaryModelRef && modelSupportMap.get(primaryModelRef) === true
        ? primaryModelRef
        : undefined;

  return {
    ...agents,
    list: ensureMainAgentInList(agents.list),
    defaults: {
      ...agents.defaults,
      models: nextModels,
      model: agents.defaults.model
        ? { ...agents.defaults.model, primary: primaryModelRef }
        : agents.defaults.model,
      imageModel: nextImagePrimary
        ? { ...(agents.defaults.imageModel ?? {}), primary: nextImagePrimary }
        : undefined,
      imageGenerationModel: agents.defaults.imageGenerationModel
        ? {
          ...agents.defaults.imageGenerationModel,
          primary: params.canonicalizeModelRef(agents.defaults.imageGenerationModel.primary),
        }
        : agents.defaults.imageGenerationModel,
      videoGenerationModel: agents.defaults.videoGenerationModel
        ? {
          ...agents.defaults.videoGenerationModel,
          primary: params.canonicalizeModelRef(agents.defaults.videoGenerationModel.primary),
        }
        : agents.defaults.videoGenerationModel,
    },
  };
}
