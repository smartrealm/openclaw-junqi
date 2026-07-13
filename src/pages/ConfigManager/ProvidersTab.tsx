// ═══════════════════════════════════════════════════════════
// Config Manager — ProvidersTab
// Phase 2+: Unified provider management (auth + models + env)
// Design: theme Tailwind classes only (no hardcoded colors)
// ═══════════════════════════════════════════════════════════

import { useState, useMemo, useCallback, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Plus, ChevronRight, CheckCircle, Save, Trash2, Search, X, Loader2, Download, Check, AlertTriangle, Plug, FileText, Key, Monitor, Bot, Palette, Film, Star, Image } from 'lucide-react';
import clsx from 'clsx';
import { Icon } from '@/components/shared/icons';
import type {
  GatewayRuntimeConfig,
  AuthProfile,
  ModelEntry,
  ModelProviderConfig,
  ModelProviderModelEntry,
} from './types';
import {
  PROVIDER_TEMPLATES,
  POPULAR_PROVIDER_IDS,
  UI_CATALOG,
  getCatalogEntriesForTab,
  getTemplateById,
  type ProviderTemplate,
  type ProviderCatalogEntry,
  type ProviderTab,
} from './providerTemplates';
import { MaskedInput, ChipList, ChipInput, StatCard } from './components';
import { buildProviderSubmissionModelIds } from './providerModelSelection';
import { gateway } from '@/services/gateway';
import { GENERATED_PROVIDER_CATALOG } from '@/generated/providerCatalog.generated';
import {
  GENERATED_IMAGE_GENERATION_MODELS,
  GENERATED_VIDEO_GENERATION_MODELS,
} from '@/generated/mediaCatalog.generated';
import {
  resolveProviderSecret,
  buildProviderSecretPatch,
  deriveProviderApiKeyEnvKey,
  getProviderSecretEnvKeysForRemoval,
  isProviderSecretEnvKeyInUse,
  type ProviderSecretSource,
} from './providerSecretResolver';
import {
  buildDefaultsWithResolvedModels,
  buildFetchedModelAdditions,
} from './providerDefaults';
import { Badge, StatusDot } from '@/components/shared/badge';
import { AUTH_MODE_INFO, normalizeProviderAuthMode } from '@/types/providerAuthMode';
import { OPENCLAW_API_PROTOCOLS, normalizeOpenClawApiProtocol } from '@/types/openclawApiProtocol';
import { resolveModelSupportsImage } from '@/utils/providerModelCapabilities';
import { ProviderModelEditor } from './ProviderModelEditor';
import {
  addProviderModel,
  buildEditableProviderModels,
  removeProviderModel,
  updateProviderModel,
} from './providerModelMutations';
import {
  buildTestHeaders,
  modelsEndpointUrl,
  PROVIDER_TEST_TIMEOUT_MS,
  testProviderConnection,
  type ConnectionPrecheckProbe,
} from './providerConnectionTest';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ProvidersTabProps {
  config: GatewayRuntimeConfig;
  onChange: (updater: (prev: GatewayRuntimeConfig) => GatewayRuntimeConfig) => void;
  onApplyAndSave: (
    updater: (prev: GatewayRuntimeConfig) => GatewayRuntimeConfig,
    options?: { connectionProbe?: ConnectionPrecheckProbe }
  ) => Promise<boolean>;
  saving: boolean;
  addRequestId?: number;
}


/** Unified representation of a provider from any of the 3 sources */
interface UnifiedProvider {
  key: string;           // profile key (e.g. "anthropic:my-clawdbot") or provider id
  provider: string;      // "anthropic", "nvidia", "google", etc.
  displayName: string;   // from template or provider id
  source: 'auth' | 'models-provider' | 'env-only';

  // Auth info (from auth.profiles)
  authProfile?: AuthProfile;
  profileKey?: string;

  // Models provider info (from models.providers)
  modelsProvider?: ModelProviderConfig;

  // Models in agents.defaults.models belonging to this provider
  models: Record<string, ModelEntry>;
  modelCount: number;

  // Template match
  template?: ProviderTemplate;

  // Env key detected
  envKeyFound?: boolean;
  envKeyValue?: string;
  credentialSource?: ProviderSecretSource;
  credentialUnverified?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getProviderFromModelId(modelId: string): string {
  // "anthropic/claude-opus-4-6" → "anthropic"
  // "nvidia/moonshotai/kimi-k2.5" → "nvidia"
  const parts = modelId.split('/');
  return parts[0] || modelId;
}

function getProviderFromProfileKey(profileKey: string): string {
  // "anthropic:my-clawdbot" → "anthropic"
  return profileKey.split(':')[0] || profileKey;
}

function normalizeProviderIdForCatalog(providerId: string): string {
  const normalized = providerId.trim().toLowerCase();
  if (normalized === 'modelstudio' || normalized === 'qwencloud' || normalized === 'qwen-dashscope') return 'qwen';
  if (normalized === 'kimi-coding' || normalized === 'kimi-code' || normalized === 'kimi') return 'kimi-coding';
  if (normalized === 'z.ai' || normalized === 'z-ai') return 'zai';
  return normalized;
}

function normalizeProviderIdForWrite(providerId: string | undefined): string {
  return String(providerId ?? '').trim().toLowerCase();
}

function normalizeProfileKeyForProvider(providerId: string, profileKey: string | undefined): string {
  const provider = normalizeProviderIdForWrite(providerId) || 'custom';
  const raw = String(profileKey ?? '').trim();
  const suffix = raw.includes(':')
    ? raw.split(':').slice(1).join(':').trim()
    : raw;
  return `${provider}:${suffix || 'main'}`;
}

function trimmedOptionalString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

function providerNamespaceMatches(modelProviderId: string, expectedProviderId: string): boolean {
  return normalizeProviderIdForCatalog(modelProviderId) === normalizeProviderIdForCatalog(expectedProviderId);
}

function findProviderConfigKey(
  providers: Record<string, ModelProviderConfig> | undefined,
  providerId: string,
): string | undefined {
  if (!providers) return undefined;
  if (providers[providerId]) return providerId;
  return Object.keys(providers).find((key) => providerNamespaceMatches(key, providerId));
}

function getGeneratedCatalogRows(providerId: string) {
  return GENERATED_PROVIDER_CATALOG[normalizeProviderIdForCatalog(providerId)] ?? [];
}

function normalizeProviderModelRef(providerId: string, modelId: string | undefined): string | undefined {
  const trimmed = String(modelId ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return undefined;
  if (trimmed.startsWith(`${providerId}/`)) return trimmed;
  const head = trimmed.split('/')[0] || '';
  if (providerNamespaceMatches(head, providerId)) return `${providerId}/${trimmed.slice(head.length + 1)}`;
  return `${providerId}/${trimmed}`;
}

function stripProviderNamespace(providerId: string, modelRef: string): string {
  const trimmed = String(modelRef ?? '').trim();
  if (!trimmed) return trimmed;
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0) return trimmed;
  const head = trimmed.slice(0, slashIndex);
  if (!providerNamespaceMatches(head, providerId)) return trimmed;
  return trimmed.slice(slashIndex + 1);
}

function hasProviderConfigApiKey(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  return value != null;
}

function authModeNeedsApiKey(mode: unknown): boolean {
  return AUTH_MODE_INFO[normalizeProviderAuthMode(mode)].hasApiKeyField;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

type GatewayModelOption = {
  id: string;
  provider?: string;
  model?: string;
  alias?: string;
  supportsImage?: boolean;
};

function resolveGeneratedModelSupportsImage(modelRef: string): boolean | undefined {
  const normalizedRef = String(modelRef ?? '').trim();
  if (!normalizedRef) return undefined;
  const slashIndex = normalizedRef.indexOf('/');
  if (slashIndex <= 0) return undefined;
  const providerId = normalizedRef.slice(0, slashIndex);
  const rows = getGeneratedCatalogRows(providerId);
  if (rows.length === 0) return undefined;
  const row = rows.find((entry) => {
    const normalized = normalizeProviderModelRef(providerId, entry.id);
    return normalized === normalizedRef;
  });
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
  if (typeof explicitSupport === 'boolean') {
    return explicitSupport;
  }
  return resolveGeneratedModelSupportsImage(modelRef) === true;
}

function pickFirstImageCapableModel(
  modelIds: string[],
  imageSupportMap?: Map<string, boolean>,
): string | undefined {
  return modelIds.find((id) => isModelImageCapable(id, imageSupportMap));
}

function resolveImagePrimaryModel(
  currentImagePrimary: string | undefined,
  availableModelIds: string[],
  imageSupportMap?: Map<string, boolean>,
): string | undefined {
  if (
    currentImagePrimary &&
    availableModelIds.includes(currentImagePrimary) &&
    isModelImageCapable(currentImagePrimary, imageSupportMap)
  ) {
    return currentImagePrimary;
  }
  return pickFirstImageCapableModel(availableModelIds, imageSupportMap);
}

function parseGatewayModelsResponse(res: unknown): GatewayModelOption[] {
  const out: GatewayModelOption[] = [];
  const pushModel = (value: any) => {
    if (!value) return;
    if (typeof value === 'string') {
      out.push({ id: value });
      return;
    }
    if (typeof value !== 'object') return;
    const id = String(value.id ?? value.model ?? '').trim();
    const provider = String(value.provider ?? '').trim() || undefined;
    const model = String(value.model ?? '').trim() || undefined;
    const alias = String(value.alias ?? value.name ?? '').trim() || undefined;
    const supportsImage = resolveModelSupportsImage(value);
    if (id) {
      out.push({ id, provider, model, alias, supportsImage });
      return;
    }
    if (provider && model) {
      out.push({ id: `${provider}/${model}`, provider, model, alias, supportsImage });
    }
  };

  if (Array.isArray(res)) {
    for (const item of res) pushModel(item);
  } else if (res && typeof res === 'object') {
    const obj = res as Record<string, unknown>;
    if (Array.isArray(obj.models)) {
      for (const item of obj.models) pushModel(item);
    } else if (obj.models && typeof obj.models === 'object') {
      for (const [id, cfg] of Object.entries(obj.models as Record<string, any>)) {
        pushModel({ id, ...(cfg ?? {}) });
      }
    }
  }

  const deduped = new Map<string, GatewayModelOption>();
  for (const item of out) {
    if (!item.id) continue;
    if (!deduped.has(item.id)) deduped.set(item.id, item);
  }
  return Array.from(deduped.values());
}

async function fetchProviderModelCatalog(
  baseUrl: string,
  apiKey: string,
  tmpl?: ProviderTemplate,
): Promise<GatewayModelOption[]> {
  const modelsUrl = modelsEndpointUrl(baseUrl);
  if (!modelsUrl) return [];
  const headers = buildTestHeaders(tmpl, apiKey);
  const isGoogle = tmpl?.id === 'google';
  const url = isGoogle && apiKey ? `${modelsUrl}?key=${encodeURIComponent(apiKey)}` : modelsUrl;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    const rows: GatewayModelOption[] = [];
    const pushRow = (row: any) => {
      const id = String(row?.id ?? row?.model ?? '').trim();
      if (!id) return;
      rows.push({ id, supportsImage: resolveModelSupportsImage(row) });
    };
    if (json && typeof json === 'object' && Array.isArray((json as any).data)) {
      for (const row of (json as any).data) {
        pushRow(row);
      }
    } else if (json && typeof json === 'object' && Array.isArray((json as any).models)) {
      for (const row of (json as any).models) {
        pushRow(row);
      }
    } else if (Array.isArray(json)) {
      for (const row of json) {
        if (typeof row === 'string') {
          const id = row.trim();
          if (id) rows.push({ id });
        } else {
          pushRow(row);
        }
      }
    }
    const deduped = new Map<string, GatewayModelOption>();
    for (const row of rows) {
      if (!deduped.has(row.id)) deduped.set(row.id, row);
    }
    return Array.from(deduped.values());
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

function getModelsForProvider(
  provider: string,
  models: Record<string, ModelEntry>
): Record<string, ModelEntry> {
  return Object.fromEntries(
    Object.entries(models).filter(([id]) => providerNamespaceMatches(getProviderFromModelId(id), provider))
  );
}

function ensureProviderModelEnabled(
  config: GatewayRuntimeConfig,
  providerId: string,
  modelRef: string,
  editableModels: Record<string, ModelEntry>,
): GatewayRuntimeConfig {
  const entry = editableModels[modelRef] ?? {};
  return addProviderModel({
    config,
    providerId,
    modelId: modelRef,
    alias: entry.alias,
    supportsImage: resolveModelSupportsImage(entry),
  });
}

function modelDisplayLabel(id: string, entry?: ModelEntry): string {
  return entry?.alias && entry.alias !== id ? `${entry.alias} · ${id}` : id;
}

interface DefaultModelControlsProps {
  models: Record<string, ModelEntry>;
  primaryModel?: string;
  imageModel?: string;
  imageSupportMap?: Map<string, boolean>;
  onSetPrimary: (id: string) => void;
  onSetImageModel: (id: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

function DefaultModelControls({
  models,
  primaryModel,
  imageModel,
  imageSupportMap,
  onSetPrimary,
  onSetImageModel,
  disabled = false,
  compact = false,
}: DefaultModelControlsProps) {
  const { t } = useTranslation();
  const entries = Object.entries(models);
  const imageEntries = entries.filter(([id, entry]) => (
    imageSupportMap?.get(id) ?? resolveModelSupportsImage(entry) ?? false
  ));

  if (entries.length === 0) return null;

  return (
    <div className={clsx(
      'grid gap-3',
      compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'
    )}>
      <div className="rounded-lg border border-aegis-border bg-aegis-surface p-3">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-aegis-text-muted mb-1.5">
          <Star size={11} className="text-aegis-primary" />
          {t('config.defaultTextModel', 'Default Text Model')}
        </div>
        <select
          value={primaryModel && models[primaryModel] ? primaryModel : ''}
          disabled={disabled}
          onChange={(e) => e.target.value && onSetPrimary(e.target.value)}
          className="w-full rounded-lg border border-aegis-border bg-aegis-elevated px-2 py-2 text-xs text-aegis-text outline-none focus:border-aegis-primary"
        >
          {(!primaryModel || !models[primaryModel]) && (
            <option value="">{t('config.notSet', 'Not set')}</option>
          )}
          {entries.map(([id, entry]) => (
            <option key={id} value={id}>{modelDisplayLabel(id, entry)}</option>
          ))}
        </select>
      </div>
      <div className="rounded-lg border border-aegis-border bg-aegis-surface p-3">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-aegis-text-muted mb-1.5">
          <Image size={11} className="text-blue-400" />
          {t('config.defaultImageModel', 'Default Image Model')}
        </div>
        <select
          value={imageModel && imageEntries.some(([id]) => id === imageModel) ? imageModel : ''}
          disabled={disabled || imageEntries.length === 0}
          onChange={(e) => e.target.value && onSetImageModel(e.target.value)}
          className="w-full rounded-lg border border-aegis-border bg-aegis-elevated px-2 py-2 text-xs text-aegis-text outline-none focus:border-aegis-primary disabled:opacity-50"
        >
          <option value="">{t('config.notSet', 'Not set')}</option>
          {imageEntries.map(([id, entry]) => (
            <option key={id} value={id}>{modelDisplayLabel(id, entry)}</option>
          ))}
        </select>
        {imageEntries.length === 0 && (
          <p className="mt-1.5 text-[10px] text-aegis-text-muted">
            {t('config.imageModelStrictHint', 'No image-capable models detected in current selection')}
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// buildUnifiedProviders — merge 3 sources
// ─────────────────────────────────────────────────────────────────────────────

function buildUnifiedProviders(config: GatewayRuntimeConfig): UnifiedProvider[] {
  const result: UnifiedProvider[] = [];
  const allModels = config.agents?.defaults?.models ?? {};
  const modelsProviders = config.models?.providers ?? {};
  const findExistingIndex = (providerId: string) =>
    result.findIndex((p) => providerNamespaceMatches(p.provider, providerId));

  // ── 1. auth.profiles ──────────────────────────────────────
  const envVarsForAuth = config.env?.vars ?? {};
  const profiles = config.auth?.profiles ?? {};
  for (const [profileKey, profile] of Object.entries(profiles)) {
    const providerRaw = profile.provider || getProviderFromProfileKey(profileKey);
    const template = getTemplateById(providerRaw);
    const provider = template?.id ?? providerRaw;
    const models   = getModelsForProvider(providerRaw, allModels);
    const providerConfigEntry = Object.entries(modelsProviders).find(([modelsProviderId]) =>
      providerNamespaceMatches(modelsProviderId, provider)
    )?.[1];
    const secretState = resolveProviderSecret(config, provider, template, profileKey);
    const envKeyValue = secretState.value;
    const envKeyFound = secretState.configured || hasProviderConfigApiKey(providerConfigEntry?.apiKey);
    const credentialUnverified = !envKeyFound && Boolean(providerConfigEntry);

    result.push({
      key:         profileKey,
      provider,
      displayName: template?.name ?? provider,
      source:      'auth',
      authProfile: profile,
      profileKey,
      models,
      modelCount:  Object.keys(models).length,
      template,
      envKeyFound,
      envKeyValue: envKeyValue || undefined,
      credentialSource: secretState.source,
      credentialUnverified,
    });
  }

  // ── 2. models.providers ───────────────────────────────────
  for (const [providerId, modelsProvider] of Object.entries(modelsProviders)) {
    // Find auth profiles for this provider
    const existingAuthProfiles = result.filter(
      (p) => providerNamespaceMatches(p.provider, providerId) && p.source === 'auth'
    );

    if (existingAuthProfiles.length > 0) {
      // Merge modelsProvider info into all matching auth profiles
      for (const p of existingAuthProfiles) {
        p.modelsProvider = modelsProvider;
        const secretState = resolveProviderSecret(config, p.provider, p.template, p.profileKey);
        p.envKeyFound = p.envKeyFound || secretState.configured || hasProviderConfigApiKey(modelsProvider.apiKey);
        p.envKeyValue = p.envKeyValue || secretState.value || undefined;
        p.credentialSource = secretState.source !== 'none' ? secretState.source : p.credentialSource;
        p.credentialUnverified = !p.envKeyFound && Boolean(modelsProvider);
      }
    } else {
      const existingIndex = findExistingIndex(providerId);
      if (existingIndex !== -1) {
        result[existingIndex].modelsProvider = modelsProvider;
        const secretState = resolveProviderSecret(config, result[existingIndex].provider, result[existingIndex].template);
        result[existingIndex].envKeyFound = result[existingIndex].envKeyFound || secretState.configured || hasProviderConfigApiKey(modelsProvider.apiKey);
        result[existingIndex].envKeyValue = result[existingIndex].envKeyValue || secretState.value || undefined;
        result[existingIndex].credentialSource = secretState.source !== 'none' ? secretState.source : result[existingIndex].credentialSource;
        result[existingIndex].credentialUnverified = !result[existingIndex].envKeyFound && Boolean(modelsProvider);
      } else {
        const template = getTemplateById(providerId);
        const models   = getModelsForProvider(providerId, allModels);
        const normalizedProvider = template?.id ?? providerId;
        const secretState = resolveProviderSecret(config, normalizedProvider, template);
        const envKeyFound = secretState.configured || hasProviderConfigApiKey(modelsProvider.apiKey);
        result.push({
          key:           providerId,
          provider:      normalizedProvider,
          displayName:   template?.name ?? providerId,
          source:        'models-provider',
          modelsProvider,
          models,
          modelCount:    Object.keys(models).length,
          template,
          envKeyFound,
          envKeyValue:   secretState.value || undefined,
          credentialSource: secretState.source,
          credentialUnverified: !envKeyFound,
        });
      }
    }
  }

  // ── 3. env.vars ───────────────────────────────────────────
  const envVars = config.env?.vars ?? {};
  for (const template of PROVIDER_TEMPLATES) {
    if (!template.envKey && !template.envKeyAlt?.length) continue;

    const envKeyFound =
      (!!template.envKey && template.envKey in envVars) ||
      (template.envKeyAlt?.some((k) => k in envVars) ?? false);

    if (!envKeyFound) continue;

    // Find any existing entry for this provider
    const existingIndex = findExistingIndex(template.id);

    if (existingIndex !== -1) {
      result[existingIndex].envKeyFound = true;
      result[existingIndex].credentialSource = result[existingIndex].credentialSource ?? 'template-env';
      result[existingIndex].credentialUnverified = false;
    } else {
      const models = getModelsForProvider(template.id, allModels);

      const envOnlyValue = template.envKey ? String(envVars[template.envKey] ?? '').trim() : undefined;
      result.push({
        key:         `env:${template.id}`,
        provider:    template.id,
        displayName: template.name,
        source:      'env-only',
        models,
        modelCount:  Object.keys(models).length,
        template,
        envKeyFound: true,
        envKeyValue: envOnlyValue || undefined,
        credentialSource: 'template-env',
        credentialUnverified: false,
      });
    }
  }

  return result;
}

export function applyProviderAddition(
  prev: GatewayRuntimeConfig,
  profileKey: string,
  profile: AuthProfile,
  models: string[],
  providerConfig?: ProviderConfigOverride
): GatewayRuntimeConfig {
  const providerIdFromKey = getProviderFromProfileKey(profileKey);
  const providerId = normalizeProviderIdForWrite(profile.provider || providerIdFromKey) || 'custom';
  const normalizedProfileKey = normalizeProfileKeyForProvider(providerId, profileKey);
  const normalizedProfile: AuthProfile = {
    ...profile,
    provider: providerId,
  };
  const tmpl = getTemplateById(providerId);
  const storeSecretInProviderConfig = !tmpl || tmpl.id === 'custom';
  const providerApiKeyEnvKey = deriveProviderApiKeyEnvKey(providerId, tmpl);

  const normalizedModelSet = new Set<string>(
    (models || [])
      .map((id) => normalizeProviderModelRef(providerId, id))
      .filter((id): id is string => Boolean(id))
  );
  const requestedTextPrimary = normalizeProviderModelRef(providerId, providerConfig?.textPrimaryModel);
  const requestedImagePrimary = normalizeProviderModelRef(providerId, providerConfig?.imagePrimaryModel);
  const explicitImageModelSet = new Set<string>(
    (providerConfig?.imageCapableModels ?? [])
      .map((id) => normalizeProviderModelRef(providerId, id))
      .filter((id): id is string => Boolean(id))
  );
  if (requestedTextPrimary) normalizedModelSet.add(requestedTextPrimary);
  if (requestedImagePrimary) normalizedModelSet.add(requestedImagePrimary);
  if (requestedImagePrimary) explicitImageModelSet.add(requestedImagePrimary);
  const normalizedModels = Array.from(normalizedModelSet);
  const modelPairs = normalizedModels.map((fullId) => ({
    fullId,
    rawId: stripProviderNamespace(providerId, fullId),
  }));

  const configuredProviderIds = new Set<string>([
    ...Object.values(prev.auth?.profiles ?? {}).map((p: AuthProfile) => p.provider).filter(Boolean),
    ...Object.keys(prev.models?.providers ?? {}),
    providerId,
  ]);

  const prevModels = prev.agents?.defaults?.models ?? {};
  const generatedRows = getGeneratedCatalogRows(providerId);
  const currentProviderKey = findProviderConfigKey(prev.models?.providers, providerId);
  const currentProviderCfg = currentProviderKey
    ? prev.models?.providers?.[currentProviderKey] ?? {}
    : {};
  const existingProviderModels = Array.isArray(currentProviderCfg.models)
    ? currentProviderCfg.models
    : [];
  const existingProviderModelMap = new Map<string, ModelProviderModelEntry>();
  for (const model of existingProviderModels) {
    const rawId = stripProviderNamespace(providerId, String(model?.id ?? ''));
    if (!rawId) continue;
    existingProviderModelMap.set(rawId, model);
  }

  const submissionModels = modelPairs.map(({ fullId, rawId }) => {
    const generatedModel = generatedRows.find((m) => normalizeProviderModelRef(providerId, m.id) === fullId);
    const existingProviderModel = existingProviderModelMap.get(rawId);
    const supportsImage =
      explicitImageModelSet.has(fullId)
      || generatedModel?.supportsImage === true
      || resolveModelSupportsImage(existingProviderModel) === true
      || resolveModelSupportsImage(prevModels[fullId]) === true;
    const name =
      existingProviderModel?.name
      ?? generatedModel?.suggestedAlias
      ?? rawId.split('/').pop()
      ?? rawId;
    return {
      fullId,
      rawId,
      name,
      supportsImage,
      input: supportsImage ? ['text', 'image'] : ['text'],
    };
  });
  const submissionModelMap = new Map(
    submissionModels.map((model) => [model.rawId, model] as const)
  );

  const existingModels: Record<string, ModelEntry> = {};
  for (const [id, entry] of Object.entries(prevModels)) {
    if (configuredProviderIds.has(getProviderFromModelId(id))) {
      existingModels[id] = entry;
    }
  }
  for (const model of submissionModels) {
    const existingEntry = existingModels[model.fullId];
    existingModels[model.fullId] = {
      ...existingEntry,
      alias: existingEntry?.alias ?? model.name,
      supportsImage: model.supportsImage,
      input: model.input,
      params: existingEntry?.params ?? {},
    };
  }

  let next: GatewayRuntimeConfig = { ...prev };

  const buildNextProviderModels = (): ModelProviderModelEntry[] => {
    const updatedExistingModels = existingProviderModels.map((model) => {
      const rawId = stripProviderNamespace(providerId, String(model?.id ?? ''));
      const submittedModel = submissionModelMap.get(rawId);
      if (!submittedModel) {
        return {
          ...model,
          id: rawId,
        };
      }
      return {
        ...model,
        id: rawId,
        name: model.name ?? submittedModel.name,
        supportsImage: submittedModel.supportsImage,
        input: submittedModel.input,
      };
    });
    const existingIds = new Set(
      updatedExistingModels.map((model) => stripProviderNamespace(providerId, String(model.id ?? '')))
    );
    const addedModels = submissionModels
      .filter((model) => !existingIds.has(model.rawId))
      .map((model) => ({
        id: model.rawId,
        name: model.name,
        supportsImage: model.supportsImage,
        input: model.input,
      }));
    return [...updatedExistingModels, ...addedModels];
  };

  const key = (normalizedProfile as any).token ?? (normalizedProfile as any).apiKey ?? (normalizedProfile as any).key;
  const nextProviderModels = buildNextProviderModels();
  const effectiveBaseUrl = trimmedOptionalString(providerConfig?.baseUrl)
    ?? trimmedOptionalString(tmpl?.baseUrl)
    ?? trimmedOptionalString(currentProviderCfg.baseUrl);
  const effectiveApi = normalizeOpenClawApiProtocol(providerConfig?.api)
    ?? normalizeOpenClawApiProtocol(tmpl?.api)
    ?? normalizeOpenClawApiProtocol(currentProviderCfg.api);

  next = buildProviderSecretPatch({
    prev: next,
    providerId,
    profileKey: normalizedProfileKey,
    profile: normalizedProfile,
    secret: key,
    template: tmpl,
    providerEnvKey: providerApiKeyEnvKey,
    preferProviderConfig: storeSecretInProviderConfig,
  });

  if (key && tmpl?.envKey && !storeSecretInProviderConfig) {
    window.aegis?.agentAuth?.syncMain?.([
      { provider: providerId, profileKey: normalizedProfileKey, apiKey: key, mode: normalizedProfile.mode ?? (normalizedProfile as any).type ?? 'api_key' },
    ]);
  }

  if (storeSecretInProviderConfig) {
    const providerApiKeyRef = key ? `\${${providerApiKeyEnvKey}}` : currentProviderCfg.apiKey;
    const providers = { ...(next.models?.providers ?? {}) };
    if (currentProviderKey && currentProviderKey !== providerId) {
      delete providers[currentProviderKey];
    }
    next = {
      ...next,
      models: {
        ...next.models,
        providers: {
          ...providers,
          [providerId]: {
            ...currentProviderCfg,
            ...(providerApiKeyRef ? { apiKey: providerApiKeyRef } : {}),
            baseUrl: effectiveBaseUrl,
            api: effectiveApi,
            models: nextProviderModels,
          },
        },
      },
    };
  } else if (normalizedModels.length > 0 || effectiveBaseUrl || effectiveApi) {
    const providers = { ...(next.models?.providers ?? {}) };
    if (currentProviderKey && currentProviderKey !== providerId) {
      delete providers[currentProviderKey];
    }
    next = {
      ...next,
      models: {
        ...next.models,
        providers: {
          ...providers,
          [providerId]: {
            ...currentProviderCfg,
            baseUrl: effectiveBaseUrl,
            api: effectiveApi,
            models: nextProviderModels,
          },
        },
      },
    };
  }

  const firstSelectedModel = normalizedModels[0];
  const currentPrimary = next.agents?.defaults?.model?.primary;
  const shouldOverridePrimary =
    !currentPrimary || currentPrimary.startsWith('anthropic/');
  const primaryStillValid = currentPrimary && currentPrimary in existingModels;
  const nextPrimary = requestedTextPrimary
    ? requestedTextPrimary
    : shouldOverridePrimary && firstSelectedModel
    ? firstSelectedModel
    : primaryStillValid
      ? currentPrimary
      : Object.keys(existingModels)[0];
  const currentImagePrimary = next.agents?.defaults?.imageModel?.primary;
  const modelIds = Object.keys(existingModels);
  const imageSupportMap = buildConfiguredImageSupportMap(existingModels);
  const imagePrimaryStillValid =
    currentImagePrimary &&
    currentImagePrimary in existingModels &&
    isModelImageCapable(currentImagePrimary, imageSupportMap);
  const nextImagePrimary = requestedImagePrimary
    ? (isModelImageCapable(requestedImagePrimary, imageSupportMap) ? requestedImagePrimary : undefined)
    : imagePrimaryStillValid
      ? currentImagePrimary
      : pickFirstImageCapableModel(modelIds, imageSupportMap);

  const nextDefaults = buildDefaultsWithResolvedModels({
    defaults: next.agents?.defaults,
    models: existingModels,
    primary: nextPrimary,
    imagePrimary: nextImagePrimary,
  });

  return {
    ...next,
    agents: {
      ...next.agents,
      defaults: nextDefaults,
    },
  };
}

export function applyProviderRemoval(
  prev: GatewayRuntimeConfig,
  providerIdRaw: string,
  profileKey?: string,
): GatewayRuntimeConfig {
  const providerId = normalizeProviderIdForWrite(providerIdRaw) || getProviderFromProfileKey(profileKey ?? providerIdRaw);
  const tmplForEnv = getTemplateById(providerId);

  const profiles = { ...(prev.auth?.profiles ?? {}) };
  if (profileKey) {
    delete profiles[profileKey];
  }
  const hasRemainingProfileForProvider = Object.entries(profiles).some(([key, profile]) => {
    const profileProvider = (profile as AuthProfile).provider || getProviderFromProfileKey(key);
    return providerNamespaceMatches(profileProvider, providerId);
  });
  const shouldRemoveProviderResources = !profileKey || !hasRemainingProfileForProvider;

  const providers = { ...(prev.models?.providers ?? {}) };
  if (shouldRemoveProviderResources) {
    for (const key of Object.keys(providers)) {
      if (providerNamespaceMatches(key, providerId)) {
        delete providers[key];
      }
    }
  }

  const withoutProvider: GatewayRuntimeConfig = {
    ...prev,
    auth: { ...prev.auth, profiles },
    models: { ...prev.models, providers },
  };

  let nextEnv = prev.env;
  if (shouldRemoveProviderResources && prev.env?.vars) {
    const vars = { ...prev.env.vars };
    const envKeys = getProviderSecretEnvKeysForRemoval({
      config: prev,
      providerId,
      template: tmplForEnv,
      providerEnvKey: deriveProviderApiKeyEnvKey(providerId, tmplForEnv),
    });
    for (const envKey of envKeys) {
      const stillUsed = isProviderSecretEnvKeyInUse({
        config: withoutProvider,
        envKey,
        resolveTemplate: getTemplateById,
      });
      if (!stillUsed) delete vars[envKey];
    }
    nextEnv = { ...prev.env, vars };
  }

  const existingModels = prev.agents?.defaults?.models ?? {};
  const nextDefaultsModels = { ...existingModels };
  if (shouldRemoveProviderResources) {
    for (const id of Object.keys(existingModels)) {
      if (providerNamespaceMatches(getProviderFromModelId(id), providerId)) {
        delete nextDefaultsModels[id];
      }
    }
  }

  return {
    ...prev,
    auth: { ...prev.auth, profiles },
    env: nextEnv,
    models: { ...prev.models, providers },
    agents: {
      ...prev.agents,
      defaults: buildDefaultsWithResolvedModels({
        defaults: prev.agents?.defaults,
        models: nextDefaultsModels,
      }),
    },
  };
}

function buildPreviewChanges(current: any, next: any): any {
  if (JSON.stringify(current) === JSON.stringify(next)) return undefined;
  if (
    current &&
    next &&
    typeof current === 'object' &&
    typeof next === 'object' &&
    !Array.isArray(current) &&
    !Array.isArray(next)
  ) {
    const result: Record<string, any> = {};
    for (const key of Object.keys(next)) {
      const child = buildPreviewChanges(current?.[key], next[key]);
      if (child !== undefined) result[key] = child;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
  return next;
}

function maskPreviewSecrets(value: any, path = ''): any {
  if (Array.isArray(value)) {
    return value.map((item, index) => maskPreviewSecrets(item, `${path}[${index}]`));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        maskPreviewSecrets(child, path ? `${path}.${key}` : key),
      ])
    );
  }
  const lowered = path.toLowerCase();
  if (
    typeof value === 'string' &&
    (lowered.includes('token') || lowered.includes('key') || lowered.includes('secret') || lowered.includes('password'))
  ) {
    return value ? '****' : value;
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Icon
// ─────────────────────────────────────────────────────────────────────────────

function ProviderIcon({ providerId, size = 'md' }: { providerId: string; size?: 'sm' | 'md' }) {
  const tmpl = getTemplateById(providerId);
  const providerIcon = Icon.provider[providerId] ?? Icon.provider[normalizeProviderIdForCatalog(providerId)] ?? Icon.provider.other;
  const sizeClass = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-9 h-9 text-sm';
  return (
    <div
      className={clsx(
        'flex items-center justify-center rounded-lg font-semibold text-aegis-btn-primary-text flex-shrink-0',
        `bg-gradient-to-br ${tmpl?.colorClass ?? 'from-slate-500 to-gray-600'}`,
        sizeClass
      )}
    >
      {providerIcon.icon}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ProviderCardShell — one consistent frame for all three provider sources.
// Renders the summary header (icon · name · type badge · subtitle · model count
// · semantic status dot · chevron/action) plus a collapsible body. This is what
// makes every provider read the same in the list regardless of whether it came
// from auth.profiles, models.providers, or env.vars — the per-source editor
// still lives in each row's `children`.
// ─────────────────────────────────────────────────────────────────────────────

/** Semantic provider status: ready (key configured) / needs a key / custom or
 *  runtime-supplied. Drives the dot, the type badge, and the open-accent. */
type ProviderStatusTone = 'ok' | 'warn' | 'info';

const PROVIDER_STATUS_DOT: Record<ProviderStatusTone, string> = {
  ok:   'bg-emerald-400 shadow-[0_0_6px_rgb(var(--aegis-success)/0.5)]',
  warn: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]',
  info: 'bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.5)]',
};
const PROVIDER_ACCENT_BORDER: Record<ProviderStatusTone, string> = {
  ok:   'border-aegis-primary/20',
  warn: 'border-amber-500/25',
  info: 'border-blue-500/20',
};
const PROVIDER_BADGE_CLS: Record<ProviderStatusTone, string> = {
  ok:   'bg-aegis-success/12 text-aegis-success border-aegis-success/25',
  warn: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  info: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
};

function providerCredentialStatusLabel(
  t: TFunction,
  configured: boolean,
  source?: ProviderSecretSource,
  unverified = false,
) {
  if (!configured) {
    if (unverified) {
      return t('config.providerCredentialUnverified', '凭据未确认');
    }
    return t('config.providerCredentialMissing', '需要 API Key');
  }
  if (source === 'provider-apiKey-env-ref' || source === 'provider-apiKey-secret-ref' || source === 'profile-key-ref' || source === 'profile-token-ref') {
    return t('config.providerCredentialReference', '凭据引用已配置');
  }
  if (source === 'template-env' || source === 'template-env-alt') {
    return t('config.providerCredentialRuntime', '运行时凭据已配置');
  }
  return t('config.apiKeyConfigured', 'API Key configured');
}

interface ProviderCardShellProps {
  providerId: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Small type chip next to the title (e.g. "Custom", "ENV Key Only"). */
  badge?: { label: ReactNode; tone: ProviderStatusTone };
  statusTone: ProviderStatusTone;
  /** Tooltip on the status dot, e.g. "API Key configured". */
  statusLabel?: string;
  modelCount: number;
  /** Expandable cards show a chevron and body; env-only cards don't. */
  expandable?: boolean;
  open?: boolean;
  onToggle?: () => void;
  /** Inline action rendered on the right (e.g. env-only "Configure"). */
  rightAction?: ReactNode;
  children?: ReactNode;
}

function ProviderCardShell({
  providerId, title, subtitle, badge, statusTone, statusLabel,
  modelCount, expandable = true, open = false, onToggle, rightAction, children,
}: ProviderCardShellProps) {
  const { t } = useTranslation();
  return (
    <div className="mb-2">
      {/* ── Summary header ── */}
      <div
        onClick={expandable ? onToggle : undefined}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onKeyDown={expandable ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle?.();
          }
        } : undefined}
        className={clsx(
          'flex items-center justify-between px-3.5 py-3',
          'bg-aegis-elevated border border-aegis-border rounded-xl',
          'transition-all duration-200',
          expandable && 'cursor-pointer hover:border-aegis-border-hover hover:bg-white/[0.02]',
          open && clsx('rounded-b-none', PROVIDER_ACCENT_BORDER[statusTone]),
        )}
      >
        {/* left */}
        <div className="flex items-center gap-3 min-w-0">
          <ProviderIcon providerId={providerId} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-aegis-text truncate">{title}</span>
              {badge && (
                <span className={clsx(
                  'text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0',
                  PROVIDER_BADGE_CLS[badge.tone],
                )}>
                  {badge.label}
                </span>
              )}
            </div>
            {subtitle && <div className="text-[11px] text-aegis-text-muted truncate">{subtitle}</div>}
          </div>
        </div>

        {/* right */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          {modelCount > 0 && (
            <span className="text-[11px] text-aegis-text-muted bg-aegis-surface border border-aegis-border rounded-full px-2.5 py-0.5">
              {t('config.modelCount', { count: modelCount })}
            </span>
          )}
          {statusLabel && (
            <span
              className={clsx(
                'hidden sm:inline-flex max-w-[150px] truncate rounded-full border px-2 py-0.5',
                'text-[10px] font-semibold leading-4',
                PROVIDER_BADGE_CLS[statusTone],
              )}
              title={statusLabel}
            >
              {statusLabel}
            </span>
          )}
          <span className={clsx('w-2 h-2 rounded-full', PROVIDER_STATUS_DOT[statusTone])} title={statusLabel} />
          {rightAction}
          {expandable && (
            <ChevronRight
              size={14}
              className={clsx(
                'text-aegis-text-muted transition-transform duration-200',
                open && 'rotate-90',
              )}
            />
          )}
        </div>
      </div>

      {/* ── Expanded body ── */}
      {expandable && open && (
        <div className={clsx(
          'border border-t-0 rounded-b-xl bg-white/[0.01] p-4 space-y-4',
          PROVIDER_ACCENT_BORDER[statusTone],
        )}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile Row (auth source, expandable)
// ─────────────────────────────────────────────────────────────────────────────

interface ProfileRowProps {
  profileKey: string;
  profile: AuthProfile;
  allModels: Record<string, ModelEntry> | undefined;
  modelsProvider?: ModelProviderConfig;
  primaryModel: string | undefined;
  imagePrimaryModel: string | undefined;
  imageSupportMap: Map<string, boolean>;
  /** True when key is stored in env.vars (so profile has no key but it is configured) */
  apiKeyConfigured?: boolean;
  apiKeySource?: ProviderSecretSource;
  credentialUnverified?: boolean;
  /** Actual key value from env.vars, passed through so fetch can use it */
  envKeyValue?: string;
  onChange: (updater: (prev: GatewayRuntimeConfig) => GatewayRuntimeConfig) => void;
  saving?: boolean;
}

// ── Fetch Models Button (inline in expanded provider card) ──
function FetchModelsButton({ providerId, tmpl, profile, allModels, modelsProvider, onChange, saving, t, envKeyValue }: {
  providerId: string;
  tmpl: ProviderTemplate | undefined;
  profile: AuthProfile;
  allModels: Record<string, ModelEntry>;
  modelsProvider?: ModelProviderConfig;
  onChange: (updater: (prev: GatewayRuntimeConfig) => GatewayRuntimeConfig) => void;
  saving?: boolean;
  t: any;
  envKeyValue?: string;
}) {
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<string | null>(null);
  const [fetchSuccess, setFetchSuccess] = useState(false);

  const handleFetch = async () => {
    const baseUrl = (modelsProvider?.baseUrl ?? tmpl?.baseUrl ?? '').replace(/\/$/, '');
    if (!baseUrl) { setFetchSuccess(false); setFetchResult(t('config.fetchModelsNoEndpoint')); return; }
    const apiKey = firstNonEmptyString(
      (profile as any).token,
      (profile as any).apiKey,
      (profile as any).key,
      envKeyValue,
    );
    const mode = normalizeProviderAuthMode(profile.mode ?? (profile as any).type ?? tmpl?.defaultAuthMode);
    if (authModeNeedsApiKey(mode) && !apiKey) {
      setFetchSuccess(false);
      setFetchResult(t('config.fetchModelsNoApiKey'));
      return;
    }

    setFetching(true);
    setFetchResult(null);
    try {
      const fetchedModels = await fetchProviderModelCatalog(baseUrl, apiKey ?? '', tmpl);

      if (fetchedModels.length === 0) { setFetchSuccess(false); setFetchResult(t('config.fetchModelsNoneFound')); return; }

      const toAdd = buildFetchedModelAdditions({
        providerId,
        fetchedModels,
        existingModels: allModels,
      });
      const addedCount = toAdd.length;
      if (addedCount > 0) {
        onChange((prev) => {
          return toAdd.reduce((next, addition) => addProviderModel({
            config: next,
            providerId,
            modelId: addition.fullRef,
            alias: addition.alias,
            supportsImage: addition.supportsImage,
          }), prev);
        });
      }
      setFetchSuccess(addedCount > 0);
      setFetchResult(t('config.fetchModelsAdded', { count: addedCount }));
    } catch (err: any) {
      setFetchSuccess(false);
      setFetchResult(err?.message || String(err));
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleFetch}
        disabled={fetching || saving}
        className={clsx(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold',
          'border border-aegis-primary/20 text-aegis-primary bg-aegis-primary/5',
          'hover:bg-aegis-primary/10 hover:border-aegis-primary/40',
          'transition-all duration-200',
          (fetching || saving) && 'opacity-50 cursor-wait',
        )}
      >
        {fetching ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Download size={12} />
        )}
        {t('config.fetchModels', '获取模型')}
      </button>
      {fetchResult && (
        <span className={clsx(
          'text-[11px]',
          fetchSuccess ? 'text-aegis-success' : 'text-aegis-warning'
        )}>{fetchResult}</span>
      )}
    </div>
  );
}

function ProfileRow({
  profileKey,
  profile,
  allModels,
  modelsProvider,
  primaryModel,
  imagePrimaryModel,
  imageSupportMap,
  apiKeyConfigured,
  apiKeySource,
  credentialUnverified = false,
  envKeyValue,
  onChange,
  saving = false,
}: ProfileRowProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const providerId    = profile.provider || getProviderFromProfileKey(profileKey);
  const tmpl          = getTemplateById(providerId);
  const providerModels = buildEditableProviderModels(providerId, allModels ?? {}, modelsProvider);
  const modelCount    = Object.keys(providerModels).length;
  const hasStoredSecret = Boolean(
    profile.token ?? profile.apiKey ?? (profile as any).key ?? apiKeyConfigured
  );
  const hasInlineSecret = Boolean(profile.token ?? profile.apiKey ?? (profile as any).key);
  const statusLabel = providerCredentialStatusLabel(
    t,
    hasStoredSecret,
    hasInlineSecret ? undefined : apiKeySource,
    credentialUnverified,
  );

  // ── Inline edit state ──
  const [localProfile, setLocalProfile] = useState<string>(profile.profileName ?? profileKey);
  const [localMode, setLocalMode]       = useState<string>(normalizeProviderAuthMode(profile.mode ?? (profile as any).type ?? tmpl?.defaultAuthMode));
  const [localBaseUrl, setLocalBaseUrl] = useState<string>(modelsProvider?.baseUrl ?? tmpl?.baseUrl ?? '');
  const [localApi, setLocalApi] = useState<string>(modelsProvider?.api ?? tmpl?.api ?? '');
  const [apiKeyInput, setApiKeyInput]   = useState('');
  const [apiKeySaved, setApiKeySaved]   = useState(false);

  // Sync local state when prop changes (e.g. after backup restore)
  useEffect(() => { setLocalProfile(profile.profileName ?? profileKey); }, [profile.profileName, profileKey]);
  useEffect(() => { setLocalMode(normalizeProviderAuthMode(profile.mode ?? (profile as any).type ?? tmpl?.defaultAuthMode)); }, [profile.mode, (profile as any).type, tmpl?.defaultAuthMode]);
  useEffect(() => { setLocalBaseUrl(modelsProvider?.baseUrl ?? tmpl?.baseUrl ?? ''); }, [modelsProvider?.baseUrl, tmpl?.baseUrl]);
  useEffect(() => { setLocalApi(modelsProvider?.api ?? tmpl?.api ?? ''); }, [modelsProvider?.api, tmpl?.api]);

  const updateProfile = (patch: Partial<AuthProfile>) => {
    onChange((prev) => {
      const existing = (prev.auth?.profiles ?? {})[profileKey] ?? profile;
      const { token, apiKey, ...restPatch } = patch as any;
      const key: string | undefined =
        (token as string | undefined) ?? (apiKey as string | undefined);

      let next = buildProviderSecretPatch({
        prev,
        providerId: profile.provider || getProviderFromProfileKey(profileKey),
        profileKey,
        profile: { ...existing, ...restPatch },
        secret: key,
        template: tmpl,
        providerEnvKey: deriveProviderApiKeyEnvKey(
          profile.provider || getProviderFromProfileKey(profileKey),
          tmpl,
        ),
        preferProviderConfig: !tmpl?.envKey,
      });

      next = {
        ...next,
        auth: {
          ...next.auth,
          profiles: {
            ...(next.auth?.profiles ?? {}),
            [profileKey]: {
              ...((next.auth?.profiles ?? {})[profileKey] ?? existing),
              ...restPatch,
            },
          },
        },
      };
      return next;
    });
  };

  const updateProviderConnection = (patch: Partial<ModelProviderConfig>) => {
    onChange((prev) => {
      const providerKey = profile.provider || getProviderFromProfileKey(profileKey);
      const existingProviderKey = findProviderConfigKey(prev.models?.providers, providerKey);
      const currentProviderCfg = existingProviderKey
        ? prev.models?.providers?.[existingProviderKey] ?? {}
        : {};
      const nextPatch = { ...patch };
      if (nextPatch.api) {
        nextPatch.api = normalizeOpenClawApiProtocol(nextPatch.api) ?? currentProviderCfg.api ?? tmpl?.api;
      }
      const providers = { ...(prev.models?.providers ?? {}) };
      if (existingProviderKey && existingProviderKey !== providerKey) {
        delete providers[existingProviderKey];
      }
      return {
        ...prev,
        models: {
          ...prev.models,
          providers: {
            ...providers,
            [providerKey]: {
              ...currentProviderCfg,
              ...nextPatch,
            },
          },
        },
      };
    });
  };

  const removeProfile = () => {
    onChange((prev) => applyProviderRemoval(prev, profile.provider || getProviderFromProfileKey(profileKey), profileKey));
  };

  const setModelPrimary = (modelId: string) => {
    onChange((prev) => {
      const next = ensureProviderModelEnabled(prev, providerId, modelId, providerModels);
      return {
        ...next,
        agents: {
          ...next.agents,
          defaults: buildDefaultsWithResolvedModels({
            defaults: next.agents?.defaults,
            models: next.agents?.defaults?.models ?? {},
            primary: modelId,
          }),
        },
      };
    });
  };

  const setImageModelPrimary = (modelId: string) => {
    onChange((prev) => {
      const next = ensureProviderModelEnabled(prev, providerId, modelId, providerModels);
      return {
        ...next,
        agents: {
          ...next.agents,
          defaults: buildDefaultsWithResolvedModels({
            defaults: next.agents?.defaults,
            models: next.agents?.defaults?.models ?? {},
            imagePrimary: modelId,
          }),
        },
      };
    });
  };

  const removeModel = (modelId: string) => {
    onChange((prev) => removeProviderModel({ config: prev, providerId, modelRef: modelId }));
  };


  return (
    <ProviderCardShell
      providerId={providerId}
      title={tmpl?.name ?? providerId}
      subtitle={<span className="font-mono">{profileKey}</span>}
      statusTone={hasStoredSecret ? 'ok' : credentialUnverified ? 'info' : 'warn'}
      statusLabel={statusLabel}
      modelCount={modelCount}
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
          {/* Profile name + Auth mode */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
                {t('config.profileName')}
              </label>
              <input
                value={localProfile}
                disabled={saving}
                onChange={(e) => setLocalProfile(e.target.value)}
                onBlur={() => {
                  if (!saving) updateProfile({ profileName: localProfile });
                }}
                className={clsx(
                  'bg-aegis-surface border border-aegis-border rounded-lg px-3 py-2',
                  'text-aegis-text text-sm outline-none focus:border-aegis-primary',
                  'transition-colors duration-200'
                )}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
                {t('config.authMode')}
              </label>
              <div className="flex gap-1 flex-wrap">
                {(tmpl?.authModes ?? ['api_key']).map((m) => {
                  const isSelected = localMode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setLocalMode(m);
                        updateProfile({ mode: m });
                      }}
                      className={clsx(
                        'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                        isSelected
                          ? 'bg-aegis-primary/15 text-aegis-primary border-aegis-primary/30'
                          : 'bg-aegis-overlay/[0.04] text-aegis-text-dim border-transparent hover:border-aegis-border/40',
                      )}
                    >
                      {t(`config.authModeOption.${m}` as const, m)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* API Key — inline editable with save button */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
              {t('config.apiKey')}
              {hasStoredSecret && !apiKeySaved && (
                <span className="ml-2 text-aegis-success text-[9px] font-normal">{t('config.apiKeyConfigured')}</span>
              )}
              {apiKeySaved && (
                <span className="ml-2 text-aegis-success text-[9px] font-normal">{t('config.saved')}</span>
              )}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={apiKeyInput}
                disabled={saving}
                placeholder={hasStoredSecret ? '••••••••' : t('config.apiKeyPlaceholder', '输入 API Key')}
                className={clsx(
                  'flex-1 rounded-lg border px-3 py-2 text-sm font-mono outline-none transition-colors',
                  hasStoredSecret
                    ? 'border-aegis-success/20 bg-aegis-success/8 text-aegis-success placeholder:text-aegis-success/50'
                    : 'border-aegis-border bg-aegis-surface text-aegis-text placeholder:text-aegis-text-muted'
                )}
                onChange={(e) => {
                  setApiKeyInput(e.target.value);
                  setApiKeySaved(false);
                }}
              />
              {apiKeyInput && !apiKeySaved && (
                <button
                  disabled={saving}
                  onClick={() => {
                    updateProfile(tmpl?.id === 'custom'
                      ? { token: apiKeyInput.trim() }
                      : { apiKey: apiKeyInput.trim() } as any);
                    setApiKeySaved(true);
                    setApiKeyInput('');
                  }}
                  className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold bg-aegis-primary/10 text-aegis-primary border border-aegis-primary/20 hover:bg-aegis-primary/20 transition-colors"
                >
                  {t('common.save', '保存')}
                </button>
              )}
            </div>
          </div>

          {/* Connection config */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
                {t('config.baseUrl', 'API Endpoint')}
              </label>
              <input
                value={localBaseUrl}
                disabled={saving}
                onChange={(e) => setLocalBaseUrl(e.target.value)}
                onBlur={() => updateProviderConnection({ baseUrl: localBaseUrl.trim() || undefined })}
                placeholder={tmpl?.baseUrl || t('config.baseUrlPlaceholder')}
                className={clsx(
                  'bg-aegis-surface border border-aegis-border rounded-lg px-3 py-2',
                  'text-aegis-text text-sm font-mono outline-none focus:border-aegis-primary',
                  'transition-colors duration-200 disabled:opacity-50'
                )}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
                {t('config.apiProtocol', 'API Protocol')}
              </label>
              <select
                value={localApi}
                disabled={saving}
                onChange={(e) => {
                  setLocalApi(e.target.value);
                  updateProviderConnection({ api: e.target.value || undefined });
                }}
                className={clsx(
                  'bg-aegis-menu-bg border border-aegis-menu-border rounded-lg px-3 py-2',
                  'text-aegis-text text-sm font-mono outline-none focus:border-aegis-primary',
                  'transition-colors duration-200 disabled:opacity-50'
                )}
              >
                <option value="">{t('config.notSet', 'Not set')}</option>
                {OPENCLAW_API_PROTOCOLS.map((protocol) => (
                  <option key={protocol} value={protocol}>{protocol}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Models */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
              {t('config.modelsAndAliases')}
            </label>
            <DefaultModelControls
              models={providerModels}
              primaryModel={primaryModel}
              imageModel={imagePrimaryModel}
              imageSupportMap={imageSupportMap}
              onSetPrimary={setModelPrimary}
              onSetImageModel={setImageModelPrimary}
              disabled={saving}
            />
            <ProviderModelEditor
              providerId={providerId}
              models={providerModels}
              primaryModel={primaryModel}
              imageModel={imagePrimaryModel}
              imageSupportMap={imageSupportMap}
              onSetPrimary={setModelPrimary}
              onSetImageModel={setImageModelPrimary}
              onRemove={removeModel}
              onAdd={(modelId, modelAlias, supportsImage) => onChange((prev) => addProviderModel({
                config: prev,
                providerId,
                modelId,
                alias: modelAlias,
                supportsImage,
              }))}
              onUpdate={(modelRef, patch) => onChange((prev) => updateProviderModel({
                config: prev,
                providerId,
                modelRef,
                ...patch,
              }))}
              disabled={saving}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            {/* Fetch Models button */}
            <FetchModelsButton
              providerId={providerId}
              tmpl={tmpl}
              profile={profile}
              allModels={allModels ?? {}}
              modelsProvider={modelsProvider}
              onChange={onChange}
              saving={saving}
              t={t}
              envKeyValue={envKeyValue}
            />
            <button
              onClick={removeProfile}
              disabled={saving}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold',
                'border border-red-500/20 text-red-400 bg-red-400/5',
                'hover:bg-red-400/10 hover:border-red-500/40',
                'transition-all duration-200',
                saving && 'cursor-not-allowed opacity-50'
              )}
            >
              <Trash2 size={12} />{t('config.remove')}
            </button>
          </div>
    </ProviderCardShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Models Provider Row (models-provider source, expandable)
// ─────────────────────────────────────────────────────────────────────────────

interface ModelsProviderRowProps {
  unifiedProvider: UnifiedProvider;
  onChange: (updater: (prev: GatewayRuntimeConfig) => GatewayRuntimeConfig) => void;
  primaryModel?: string;
  imagePrimaryModel?: string;
  imageSupportMap?: Map<string, boolean>;
  saving?: boolean;
}

function ModelsProviderRow({ unifiedProvider, onChange, primaryModel, imagePrimaryModel, imageSupportMap, saving = false }: ModelsProviderRowProps) {
  const [open, setOpen] = useState(false);
  const { provider, modelsProvider, template, envKeyFound, credentialSource, credentialUnverified } = unifiedProvider;
  const { t } = useTranslation();
  const editableModels = useMemo(
    () => buildEditableProviderModels(provider, unifiedProvider.models, modelsProvider),
    [modelsProvider, provider, unifiedProvider.models],
  );

  const [localBaseUrl, setLocalBaseUrl] = useState(modelsProvider?.baseUrl ?? '');
  const [localApi, setLocalApi] = useState(modelsProvider?.api ?? template?.api ?? '');
  // Sync when prop changes after backup restore
  useEffect(() => { setLocalBaseUrl(modelsProvider?.baseUrl ?? ''); }, [modelsProvider?.baseUrl]);
  useEffect(() => { setLocalApi(modelsProvider?.api ?? template?.api ?? ''); }, [modelsProvider?.api, template?.api]);

  const updateModelsProvider = (patch: Partial<ModelProviderConfig>) => {
    onChange((prev) => {
      const existingProviderKey = findProviderConfigKey(prev.models?.providers, provider);
      const currentProviderCfg = existingProviderKey
        ? prev.models?.providers?.[existingProviderKey] ?? {}
        : {};
      const providers = { ...(prev.models?.providers ?? {}) };
      if (existingProviderKey && existingProviderKey !== provider) {
        delete providers[existingProviderKey];
      }
      return {
        ...prev,
        models: {
          ...prev.models,
          providers: {
            ...providers,
            [provider]: {
              ...currentProviderCfg,
              ...patch,
            },
          },
        },
      };
    });
  };

  const removeModelsProvider = () => {
    onChange((prev) => applyProviderRemoval(prev, provider));
  };

  const envKeyName = template?.envKey;

  return (
    <ProviderCardShell
      providerId={provider}
      title={template?.name ?? provider}
      subtitle={<span className="font-mono">{modelsProvider?.baseUrl ?? provider}</span>}
      badge={{ label: <>⚡ {t('config.customProvider', 'Custom Provider')}</>, tone: 'info' }}
      statusTone={envKeyFound ? 'ok' : credentialUnverified ? 'info' : 'warn'}
      statusLabel={providerCredentialStatusLabel(t, Boolean(envKeyFound), credentialSource, credentialUnverified)}
      modelCount={Object.keys(editableModels).length}
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
          {/* Base URL */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
              {t('config.baseUrl', 'Base URL')}
            </label>
            <input
              value={localBaseUrl}
              disabled={saving}
              onChange={(e) => setLocalBaseUrl(e.target.value)}
              onBlur={() => updateModelsProvider({ baseUrl: localBaseUrl })}
              className={clsx(
                'bg-aegis-surface border border-aegis-border rounded-lg px-3 py-2',
                'text-aegis-text text-sm font-mono outline-none focus:border-aegis-primary',
                'transition-colors duration-200'
              )}
            />
          </div>

          {/* API Type */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
              {t('config.apiProtocol', 'API Protocol')}
            </label>
            <select
              value={localApi}
              disabled={saving}
              onChange={(e) => {
                setLocalApi(e.target.value);
                updateModelsProvider({ api: e.target.value || undefined });
              }}
              className={clsx(
                'bg-aegis-menu-bg border border-aegis-menu-border rounded-lg px-3 py-2',
                'text-aegis-text text-sm font-mono outline-none focus:border-aegis-primary',
                'transition-colors duration-200 disabled:opacity-50'
              )}
            >
              <option value="">{t('config.notSet', 'Not set')}</option>
              {OPENCLAW_API_PROTOCOLS.map((protocol) => (
                <option key={protocol} value={protocol}>{protocol}</option>
              ))}
            </select>
          </div>

          {/* Models list */}
          <ProviderModelEditor
            providerId={provider}
            models={editableModels}
            primaryModel={primaryModel}
            imageModel={imagePrimaryModel}
            imageSupportMap={imageSupportMap}
            disabled={saving}
            onAdd={(modelId, modelAlias, supportsImage) => onChange((prev) => addProviderModel({ config: prev, providerId: provider, modelId, alias: modelAlias, supportsImage }))}
            onUpdate={(modelRef, patch) => onChange((prev) => updateProviderModel({ config: prev, providerId: provider, modelRef, ...patch }))}
            onRemove={(modelRef) => onChange((prev) => removeProviderModel({ config: prev, providerId: provider, modelRef }))}
            onSetPrimary={(modelRef) => onChange((prev) => {
              const next = ensureProviderModelEnabled(prev, provider, modelRef, editableModels);
              return {
                ...next,
                agents: {
                  ...next.agents,
                  defaults: buildDefaultsWithResolvedModels({
                    defaults: next.agents?.defaults,
                    models: next.agents?.defaults?.models ?? {},
                    primary: modelRef,
                  }),
                },
              };
            })}
            onSetImageModel={(modelRef) => onChange((prev) => {
              const next = ensureProviderModelEnabled(prev, provider, modelRef, editableModels);
              return {
                ...next,
                agents: {
                  ...next.agents,
                  defaults: buildDefaultsWithResolvedModels({
                    defaults: next.agents?.defaults,
                    models: next.agents?.defaults?.models ?? {},
                    imagePrimary: modelRef,
                  }),
                },
              };
            })}
          />

          {/* Env Key status */}
          {envKeyName && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
                {t('config.envKey', 'Env Key')}
              </label>
              <div
                className={clsx(
                  'flex items-center gap-2 text-sm font-mono px-3 py-2 rounded-lg border',
                  envKeyFound
                    ? 'bg-aegis-success/8 border-aegis-success/20 text-aegis-success'
                    : 'bg-aegis-surface border-aegis-border text-aegis-text-muted'
                )}
              >
                <span>{envKeyFound ? '✓' : '○'}</span>
                <span>{envKeyName}</span>
                {!envKeyFound && (
                  <span className="text-[10px] opacity-60 ml-1">
                    {t('config.envKeyNotSet', 'not set in env.vars')}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={removeModelsProvider}
              disabled={saving}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold',
                'border border-red-500/20 text-red-400 bg-red-400/5',
                'hover:bg-red-400/10 hover:border-red-500/40',
                'transition-all duration-200',
                saving && 'cursor-not-allowed opacity-50 hover:bg-red-400/5 hover:border-red-500/20'
              )}
            >
              <Trash2 size={12} /> {t('common.remove', 'Remove')}
            </button>
          </div>
    </ProviderCardShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Env-Only Row (env-only source, non-expandable)
// ─────────────────────────────────────────────────────────────────────────────

interface EnvOnlyRowProps {
  unifiedProvider: UnifiedProvider;
  onConfigure: (template: ProviderTemplate) => void;
}

function EnvOnlyRow({ unifiedProvider, onConfigure }: EnvOnlyRowProps) {
  const { t } = useTranslation();
  const { provider, template, modelCount, credentialSource } = unifiedProvider;
  const envKeyName = template?.envKey;

  return (
    <ProviderCardShell
      providerId={provider}
      title={template?.name ?? provider}
      subtitle={
        <>
          {envKeyName && <span className="font-mono">{envKeyName}</span>}
          {envKeyName && ' · '}
          <span>{t('config.addAuthProfileHint', 'Add an auth profile for full configuration')}</span>
        </>
      }
      badge={{
        label: (
          <span className="flex items-center gap-1">
            <Key size={11} strokeWidth={1.75} className="inline" />
            {t('config.envKeyOnly', 'ENV Key Only')}
          </span>
        ),
        tone: 'warn',
      }}
      statusTone="info"
      statusLabel={providerCredentialStatusLabel(t, true, credentialSource)}
      modelCount={modelCount}
      expandable={false}
      rightAction={template ? (
        <button
          onClick={() => onConfigure(template)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold',
            'border border-aegis-primary/30 text-aegis-primary bg-aegis-primary/5',
            'hover:bg-aegis-primary/10 hover:border-aegis-primary/50',
            'transition-all duration-200'
          )}
        >
          <Plus size={11} /> {t('config.configure', 'Configure')}
        </button>
      ) : undefined}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Provider Modal — Step 1: Tabbed picker
// ─────────────────────────────────────────────────────────────────────────────

interface PickStepProps {
  onPick: (tmpl: ProviderTemplate, entry?: ProviderCatalogEntry) => void;
  onClose: () => void;
}

const PICK_TAB_IDS: ProviderTab[] = ['recommended', 'china', 'global', 'coding', 'local'];

function PickStep({ onPick, onClose: _onClose }: PickStepProps) {
  const { t } = useTranslation();
  const [tab, setTab]     = useState<ProviderTab>('recommended');
  const [search, setSearch] = useState('');
  const getCatalogLabel = useCallback(
    (entry: ProviderCatalogEntry) => t(`config.providerCatalog.${entry.catalogId}`, entry.label),
    [t]
  );

  // When searching, scan the full catalog regardless of tab.
  // When not searching, filter by selected tab.
  const entries = useMemo<ProviderCatalogEntry[]>(() => {
    if (search.trim()) {
      const q = search.toLowerCase();
      return UI_CATALOG.filter(
        (e) =>
          getCatalogLabel(e).toLowerCase().includes(q) ||
          e.label.toLowerCase().includes(q) ||
          e.templateId.toLowerCase().includes(q) ||
          e.catalogId.toLowerCase().includes(q)
      );
    }
    return getCatalogEntriesForTab(tab);
  }, [tab, search, getCatalogLabel]);

  const handleEntryPick = (entry: ProviderCatalogEntry) => {
    const tmpl = getTemplateById(entry.templateId);
    if (!tmpl) return;
    onPick(tmpl, entry);
  };

  const isSearching = Boolean(search.trim());

  return (
    <div className="flex flex-col gap-3">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-aegis-text-muted" />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('config.searchProviders')}
          className={clsx(
            'w-full bg-aegis-surface border border-aegis-border rounded-lg pl-9 pr-3 py-2',
            'text-aegis-text text-sm placeholder:text-aegis-text-muted',
            'outline-none focus:border-aegis-primary transition-colors duration-200'
          )}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-aegis-text-muted hover:text-aegis-text"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Tab bar — hidden while searching */}
      {!isSearching && (
        <div className="flex gap-0 border-b border-aegis-border -mx-5 px-5">
          {PICK_TAB_IDS.map((tabId) => (
            <button
              key={tabId}
              onClick={() => setTab(tabId)}
              className={clsx(
                'px-3 py-2 text-[11px] font-semibold border-b-2 whitespace-nowrap transition-colors',
                tab === tabId
                  ? 'border-aegis-primary text-aegis-primary'
                  : 'border-transparent text-aegis-text-muted hover:text-aegis-text'
              )}
            >
              {t(`config.pickTab.${tabId}` as const)}
            </button>
          ))}
        </div>
      )}

      {/* Tab-level advisories */}
      {!isSearching && tab === 'coding' && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 leading-snug">
          <span className="flex-shrink-0 mt-0.5"><AlertTriangle size={14} strokeWidth={1.75} />️</span>
          <span>{t('config.codingPlanAdvisory')}</span>
        </div>
      )}
      {!isSearching && tab === 'local' && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-300 leading-snug">
          <span className="flex-shrink-0 mt-0.5"><Monitor size={14} strokeWidth={1.75} /></span>
          <span>{t('config.localProviderAdvisory')}</span>
        </div>
      )}

      {/* Entry grid */}
      <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
        {entries.map((entry) => (
          <CatalogCard key={entry.catalogId} entry={entry} onPick={handleEntryPick} />
        ))}
        {entries.length === 0 && (
          <p className="col-span-2 text-center text-xs text-aegis-text-muted py-6">
            {t('config.noProvidersFound')}
          </p>
        )}
      </div>
    </div>
  );
}

/** Region badge colors */
const REGION_STYLE: Record<string, string> = {
  cn:     'bg-red-500/15 text-red-400 border-red-500/20',
  global: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
};

/** Plan badge colors */
const PLAN_STYLE: Record<string, string> = {
  coding:        'bg-amber-500/15 text-amber-400 border-amber-500/20',
  'oauth-portal':'bg-violet-500/15 text-violet-400 border-violet-500/20',
};

function CatalogCard({
  entry,
  onPick,
}: {
  entry: ProviderCatalogEntry;
  onPick: (e: ProviderCatalogEntry) => void;
}) {
  const { t } = useTranslation();
  const tmpl = getTemplateById(entry.templateId);
  if (!tmpl) return null;
  const displayLabel = t(`config.providerCatalog.${entry.catalogId}`, entry.label);

  return (
    <button
      onClick={() => onPick(entry)}
      className={clsx(
        'flex items-start gap-2.5 p-2.5 rounded-xl text-left',
        'border border-aegis-border bg-aegis-elevated',
        'hover:border-aegis-border-hover hover:bg-white/[0.03]',
        'transition-all duration-200 group'
      )}
    >
      {/* Icon */}
      <div
        className={clsx(
          'flex items-center justify-center w-7 h-7 rounded-lg font-black text-aegis-btn-primary-text flex-shrink-0 text-xs mt-0.5',
          `bg-gradient-to-br ${tmpl.colorClass}`
        )}
      >
        {tmpl.icon}
      </div>

      {/* Label + badges */}
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-xs text-aegis-text group-hover:text-aegis-primary transition-colors truncate leading-tight">
          {displayLabel}
        </div>
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          {entry.region !== 'none' && (
            <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded-full border', REGION_STYLE[entry.region])}>
              {entry.region === 'cn' ? 'CN' : 'Global'}
            </span>
          )}
          {entry.plan !== 'general' && (
            <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded-full border', PLAN_STYLE[entry.plan] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/20')}>
              {entry.plan === 'coding' ? t('config.codingPlan') : t('config.authModeOption.oauth')}
            </span>
          )}
          {entry.region === 'none' && entry.plan === 'general' && (
            <span className="text-[9px] text-aegis-text-muted font-mono truncate">
              {tmpl.envKey}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/** Compact card used by the existing providers list. The picker uses ProviderCatalogEntry. */
function ProviderCard({
  tmpl,
  onPick,
  compact,
}: {
  tmpl: ProviderTemplate;
  onPick: (t: ProviderTemplate) => void;
  compact?: boolean;
}) {
  return (
    <button
      onClick={() => onPick(tmpl)}
      className={clsx(
        'flex items-center gap-2.5 p-2.5 rounded-xl',
        'border border-aegis-border bg-aegis-elevated text-left',
        'hover:border-aegis-border-hover hover:bg-white/[0.03]',
        'transition-all duration-200 group',
        compact && 'flex-col items-center text-center gap-1.5'
      )}
    >
      <div
        className={clsx(
          'flex items-center justify-center rounded-lg font-black text-aegis-btn-primary-text flex-shrink-0',
          `bg-gradient-to-br ${tmpl.colorClass}`,
          compact ? 'w-8 h-8 text-sm' : 'w-7 h-7 text-xs'
        )}
      >
        {tmpl.icon}
      </div>
      <div className="min-w-0">
        <div className="font-semibold text-xs text-aegis-text group-hover:text-aegis-primary transition-colors truncate">
          {tmpl.name}
        </div>
        {!compact && tmpl.envKey && (
          <div className="text-[9px] text-aegis-text-muted font-mono truncate">{tmpl.envKey}</div>
        )}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Provider Modal — Step 2: Configure
// ─────────────────────────────────────────────────────────────────────────────

/** Optional provider-level config (e.g. baseUrl for custom) passed when adding */
export interface ProviderConfigOverride {
  baseUrl?: string;
  api?: string;
  textPrimaryModel?: string;
  imagePrimaryModel?: string;
  imageCapableModels?: string[];
}

interface ConfigureStepProps {
  config: GatewayRuntimeConfig;
  tmpl: ProviderTemplate;
  /** Catalog entry that drove the pick (carries region, plan, baseUrlOverride, warning). */
  catalogEntry?: ProviderCatalogEntry;
  onBack: () => void;
  onSubmit: (
    profileKey: string,
    profile: AuthProfile,
    selectedModels: string[],
    providerConfig?: ProviderConfigOverride,
    connectionProbe?: ConnectionPrecheckProbe
  ) => Promise<boolean>;
  saving: boolean;
}

function ConfigureStep({ config, tmpl, catalogEntry, onBack, onSubmit, saving }: ConfigureStepProps) {
  const { t } = useTranslation();
  const catalogLabel = catalogEntry
    ? t(`config.providerCatalog.${catalogEntry.catalogId}`, catalogEntry.label)
    : undefined;
  // vllm and custom both require a base URL; check template flag
  const needsBaseUrl = tmpl.requiresBaseUrl || tmpl.id === 'custom' || tmpl.id === 'vllm';
  const isCustomLike = needsBaseUrl || tmpl.id === 'siliconflow'; // providers that need manual model IDs
  const [profileName, setProfileName] = useState(`${tmpl.id}:main`);
  const [apiKey, setApiKey]           = useState('');
  const [authMode, setAuthMode]       = useState(tmpl.defaultAuthMode);
  // Pre-fill baseUrl from catalog entry's region-specific override, falling back to template default.
  const [baseUrl, setBaseUrl]         = useState(catalogEntry?.baseUrlOverride ?? tmpl.baseUrl ?? '');
  const [customModelIds, setCustomModelIds] = useState<string[]>([]);
  const [imageCapableModelIds, setImageCapableModelIds] = useState<string[]>([]);
  const [extraModelIds, setExtraModelIds] = useState<string[]>([]);
  // For true custom template: let user override the provider ID written to config
  const [customProviderId, setCustomProviderId] = useState('custom');
  const [textPrimaryModel, setTextPrimaryModel] = useState('');
  const [imagePrimaryModel, setImagePrimaryModel] = useState('');
  const [gatewayModels, setGatewayModels] = useState<GatewayModelOption[]>([]);
  const [providerCatalogModels, setProviderCatalogModels] = useState<GatewayModelOption[]>([]);
  const [loadingGatewayModels, setLoadingGatewayModels] = useState(false);
  const [loadingProviderCatalog, setLoadingProviderCatalog] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedModels, setSelectedModels] = useState<string[]>(() =>
    catalogEntry?.defaultModelRef ? [catalogEntry.defaultModelRef] : []
  );
  const toggleModel = (id: string) => {
    setSelectedModels((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const runtimeProviderId = tmpl.id === 'modelstudio'
    ? 'qwen'
    : tmpl.id === 'kimi-coding'
      ? 'kimi'
      : tmpl.id;

  // Effective provider ID written into config:
  // - custom template: user-specified customProviderId (default "custom")
  // - vllm template: "vllm"
  // - all others: tmpl.id
  const effectiveProviderId =
    tmpl.id === 'custom'
      ? normalizeProviderIdForWrite(customProviderId) || 'custom'
      : normalizeProviderIdForWrite(runtimeProviderId);

  const resolvedBaseUrl = baseUrl.trim() || catalogEntry?.baseUrlOverride || tmpl.baseUrl;
  const modelsToAdd = buildProviderSubmissionModelIds({
    isCustomLike,
    selectedModels,
    customModelIds,
    extraModelIds,
  });
  const normalizedTemplateProvider = normalizeProviderIdForCatalog(effectiveProviderId);
  const generatedCatalogModelOptions = useMemo(() => {
    const rows = GENERATED_PROVIDER_CATALOG[normalizedTemplateProvider] ?? [];
    const values = rows
      .map((item) => normalizeProviderModelRef(effectiveProviderId, item.id))
      .filter((id): id is string => Boolean(id));
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }, [effectiveProviderId, normalizedTemplateProvider]);
  const gatewayModelOptions = useMemo(() => {
    if (!isCustomLike) return [];
    const values = gatewayModels
      .map((item) => {
        const full = String(item.id ?? '').trim();
        if (!full) return null;
        const ref = full.includes('/')
          ? full
          : item.provider && item.model
            ? `${item.provider}/${item.model}`
            : full;
        const provider = ref.includes('/') ? ref.split('/')[0] : (item.provider ?? '');
        if (!provider) return null;
        if (normalizeProviderIdForCatalog(provider) !== normalizedTemplateProvider) return null;
        return ref;
      })
      .filter((id): id is string => Boolean(id));
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }, [gatewayModels, isCustomLike, normalizedTemplateProvider]);
  const providerCatalogModelOptions = useMemo(() => {
    if (!isCustomLike) return [];
    const values = providerCatalogModels
      .map((item) => normalizeProviderModelRef(effectiveProviderId, item.id))
      .filter((id): id is string => Boolean(id));
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }, [effectiveProviderId, isCustomLike, providerCatalogModels]);
  const hasDynamicCatalogOptions = providerCatalogModelOptions.length > 0 || gatewayModelOptions.length > 0;
  const modelSourceInfo = useMemo(() => {
    if (!isCustomLike) {
      return {
        label: t('config.modelSourceSynced', 'Source: Built-in Catalog'),
        detail: t('config.modelSourceSyncedHint', 'Using the JunQi Desktop built-in provider catalog'),
        className: 'bg-green-500/10 text-green-300 border-green-500/20',
      };
    }
    if (providerCatalogModelOptions.length > 0) {
      return {
        label: t('config.modelSourceProvider', 'Source: Provider Catalog'),
        detail: t('config.modelSourceProviderHint', 'Using the live /models response from this provider'),
        className: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
      };
    }
    return {
      label: t('config.modelSourceGateway', 'Source: Runtime Catalog'),
      detail: t('config.modelSourceGatewayHint', 'Using the model catalog currently exposed by the connected gateway'),
      className: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
    };
  }, [isCustomLike, providerCatalogModelOptions.length, t]);
  const suggestedModels = useMemo(
    () => {
      if (!isCustomLike) {
        return generatedCatalogModelOptions;
      }
      if (!hasDynamicCatalogOptions) {
        return generatedCatalogModelOptions;
      }
      return Array.from(new Set([
        ...providerCatalogModelOptions,
        ...gatewayModelOptions,
      ]));
    },
    [
      gatewayModelOptions,
      generatedCatalogModelOptions,
      hasDynamicCatalogOptions,
      isCustomLike,
      providerCatalogModelOptions,
    ]
  );
  const normalizedModelOptions = modelsToAdd
    .map((id) => normalizeProviderModelRef(effectiveProviderId, id))
    .filter((id): id is string => Boolean(id));
  const normalizedExplicitImageModels = imageCapableModelIds
    .map((id) => normalizeProviderModelRef(effectiveProviderId, id))
    .filter((id): id is string => Boolean(id));
  const imageSupportMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const model of GENERATED_PROVIDER_CATALOG[normalizedTemplateProvider] ?? []) {
      if (typeof model.supportsImage !== 'boolean') continue;
      const normalized = normalizeProviderModelRef(effectiveProviderId, model.id);
      if (!normalized) continue;
      map.set(normalized, model.supportsImage);
    }
    for (const item of providerCatalogModels) {
      if (typeof item.supportsImage !== 'boolean') continue;
      const normalized = normalizeProviderModelRef(effectiveProviderId, item.id);
      if (!normalized) continue;
      map.set(normalized, item.supportsImage);
    }
    for (const item of gatewayModels) {
      if (typeof item.supportsImage !== 'boolean') continue;
      const normalized = normalizeProviderModelRef(effectiveProviderId, item.id);
      if (!normalized) continue;
      map.set(normalized, item.supportsImage);
    }
    for (const id of normalizedExplicitImageModels) {
      map.set(id, true);
    }
    return map;
  }, [
    effectiveProviderId,
    gatewayModels,
    normalizedExplicitImageModels,
    normalizedTemplateProvider,
    providerCatalogModels,
  ]);
  const imageModelOptions = useMemo(
    () => normalizedModelOptions.filter((id) => imageSupportMap.get(id) === true),
    [normalizedModelOptions, imageSupportMap]
  );
  const imageCapableModelsForSubmission = useMemo(
    () => normalizedModelOptions.filter((id) => imageSupportMap.get(id) === true),
    [normalizedModelOptions, imageSupportMap]
  );
  const resolvedTextPrimaryModel = normalizedModelOptions.includes(textPrimaryModel)
    ? textPrimaryModel
    : normalizedModelOptions[0] ?? '';
  const resolvedImagePrimaryModel = imageModelOptions.includes(imagePrimaryModel)
    ? imagePrimaryModel
    : imageModelOptions[0] ?? '';
  const canSubmit = Boolean(profileName) && (
    isCustomLike
      ? Boolean(baseUrl.trim()) && modelsToAdd.length > 0
      : modelsToAdd.length > 0
  );
  const submission = canSubmit ? {
    profileKey: normalizeProfileKeyForProvider(effectiveProviderId, profileName),
    profile: {
      provider: effectiveProviderId,
      mode: authMode,
      ...(authModeNeedsApiKey(authMode) && apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    } satisfies AuthProfile,
    providerConfig: (
      isCustomLike ||
      resolvedBaseUrl ||
      resolvedTextPrimaryModel ||
      resolvedImagePrimaryModel
    )
      ? {
        baseUrl: isCustomLike || resolvedBaseUrl ? resolvedBaseUrl : undefined,
        api: tmpl.api,
        textPrimaryModel: resolvedTextPrimaryModel || undefined,
        imagePrimaryModel: resolvedImagePrimaryModel || undefined,
        imageCapableModels: imageCapableModelsForSubmission,
      }
      : undefined,
    models: modelsToAdd,
  } : null;

  const previewDraft = useMemo(() => {
    if (!submission) return undefined;
    return applyProviderAddition(
      config,
      submission.profileKey,
      submission.profile,
      submission.models,
      submission.providerConfig
    );
  }, [config, submission]);

  const previewChanges = useMemo(() => {
    if (!previewDraft) return undefined;
    return maskPreviewSecrets(buildPreviewChanges(config, previewDraft));
  }, [config, previewDraft]);

  const handleSubmit = async () => {
    if (!submission || saving) return;
    const preferredProbeModel = stripProviderNamespace(
      effectiveProviderId,
      resolvedTextPrimaryModel || selectedModels[0] || suggestedModels[0] || ''
    ) || undefined;
    const connectionProbe: ConnectionPrecheckProbe | undefined =
      canTestConnection && apiKey.trim()
        ? {
          providerId: effectiveProviderId,
          profileKey: submission.profileKey,
          baseUrl: effectiveBaseUrl,
          apiKey: apiKey.trim(),
          modelOverride: preferredProbeModel,
        }
        : undefined;
    await onSubmit(
      submission.profileKey,
      submission.profile,
      submission.models,
      submission.providerConfig,
      connectionProbe
    );
  };

  const effectiveBaseUrl = baseUrl.trim() || (tmpl.baseUrl ?? '').trim();
  const canTestConnection =
    effectiveBaseUrl &&
    authModeNeedsApiKey(authMode) &&
    (isCustomLike ||
      tmpl.api === 'openai-completions' ||
      tmpl.api === 'google-generative-ai' ||
      tmpl.api === 'anthropic-messages');

  const testConnection = async () => {
    if (!canTestConnection) return;
    setTestStatus('testing');
    setTestMessage('');
    const firstCustomModel = customModelIds.find((id) => id.trim())?.trim();
    const preferredProbeModel = stripProviderNamespace(
      effectiveProviderId,
      resolvedTextPrimaryModel || selectedModels[0] || suggestedModels[0] || ''
    );
    const result = await testProviderConnection(
      effectiveBaseUrl,
      apiKey,
      tmpl,
      firstCustomModel || preferredProbeModel
    );
    setTestStatus(result.ok ? 'ok' : 'error');
    const rawMsg = result.message ?? '';
    const i18nMatch = rawMsg.match(/^__i18n:([^:]+):(.+)__$/);
    const displayMsg = i18nMatch
      ? t(i18nMatch[1], { status: i18nMatch[2] })
      : rawMsg;
    setTestMessage(result.ok ? t('config.connected') : displayMsg);
  };

  const hasCatalogRegion = catalogEntry && catalogEntry.region !== 'none';
  const hasCatalogPlan   = catalogEntry && catalogEntry.plan   !== 'general';
  // Warn if user has changed baseUrl away from what the catalog specified.
  const baseUrlDrifted   = catalogEntry?.baseUrlOverride && baseUrl.trim() !== catalogEntry.baseUrlOverride;

  useEffect(() => {
    if (isCustomLike || selectedModels.length > 0 || suggestedModels.length === 0) return;
    const initialSelection: string[] = [];
    if (catalogEntry?.defaultModelRef) {
      const normalizedDefault = normalizeProviderModelRef(effectiveProviderId, catalogEntry.defaultModelRef);
      if (normalizedDefault && suggestedModels.includes(normalizedDefault)) {
        initialSelection.push(normalizedDefault);
      }
    }
    if (initialSelection.length === 0) {
      initialSelection.push(suggestedModels[0]);
    }
    setSelectedModels(initialSelection.filter(Boolean));
  }, [
    catalogEntry?.defaultModelRef,
    effectiveProviderId,
    isCustomLike,
    selectedModels.length,
    suggestedModels,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!isCustomLike) {
      setGatewayModels([]);
      setLoadingGatewayModels(false);
      return;
    }
    setLoadingGatewayModels(true);
    gateway.getAvailableModels()
      .then((res) => {
        if (cancelled) return;
        setGatewayModels(parseGatewayModelsResponse(res));
      })
      .catch(() => {
        if (cancelled) return;
        setGatewayModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingGatewayModels(false);
      });
    return () => { cancelled = true; };
  }, [isCustomLike]);

  useEffect(() => {
    let cancelled = false;
    if (
      !effectiveBaseUrl ||
      !authModeNeedsApiKey(authMode) ||
      !apiKey.trim() ||
      !isCustomLike
    ) {
      setProviderCatalogModels([]);
      setLoadingProviderCatalog(false);
      return;
    }
    setLoadingProviderCatalog(true);
    fetchProviderModelCatalog(effectiveBaseUrl, apiKey, tmpl)
      .then((rows) => {
        if (cancelled) return;
        const normalizedRows = rows
          .map((item) => {
            const id = normalizeProviderModelRef(effectiveProviderId, item.id);
            if (!id) return null;
            return { ...item, id };
          })
          .filter((item): item is GatewayModelOption => Boolean(item));
        const deduped = new Map<string, GatewayModelOption>();
        for (const item of normalizedRows) {
          if (!deduped.has(item.id)) deduped.set(item.id, item);
        }
        setProviderCatalogModels(Array.from(deduped.values()));
      })
      .catch(() => {
        if (cancelled) return;
        setProviderCatalogModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingProviderCatalog(false);
      });
    return () => { cancelled = true; };
  }, [effectiveBaseUrl, authMode, apiKey, tmpl, effectiveProviderId, isCustomLike]);

  return (
    <div className="flex flex-col gap-4">
      {/* Provider header — includes region/plan badges when driven by a catalog entry */}
      <div className="flex items-center gap-3 p-3 bg-aegis-elevated border border-aegis-border rounded-xl">
        <div
          className={clsx(
            'flex items-center justify-center w-10 h-10 rounded-xl font-black text-aegis-btn-primary-text text-base flex-shrink-0',
            `bg-gradient-to-br ${tmpl.colorClass}`
          )}
        >
          {tmpl.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-sm text-aegis-text">
              {catalogLabel ?? tmpl.name}
            </span>
            {hasCatalogRegion && (
              <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded-full border', REGION_STYLE[catalogEntry.region])}>
                {catalogEntry.region === 'cn' ? 'CN' : 'Global'}
              </span>
            )}
            {hasCatalogPlan && (
              <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded-full border', PLAN_STYLE[catalogEntry.plan] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/20')}>
                {catalogEntry.plan === 'coding' ? t('config.codingPlan') : t('config.authModeOption.oauth')}
              </span>
            )}
          </div>
          {tmpl.docsUrl && (
            <a
              href={tmpl.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-aegis-primary hover:underline"
            >
              Docs ↗
            </a>
          )}
        </div>
      </div>

      {/* Coding plan warning — shown whenever the selected catalog entry is a coding plan */}
      {catalogEntry?.planWarning && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-300 leading-snug">
          <span className="flex-shrink-0 mt-0.5"><AlertTriangle size={14} strokeWidth={1.75} />️</span>
          <span>{catalogEntry.planWarning}</span>
        </div>
      )}

      {/* Profile name */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
          {t('config.profileName')}
        </label>
        <input
          value={profileName}
          onChange={(e) => setProfileName(e.target.value)}
          className={clsx(
            'bg-aegis-surface border border-aegis-border rounded-lg px-3 py-2',
            'text-aegis-text text-sm font-mono outline-none focus:border-aegis-primary',
            'transition-colors duration-200'
          )}
        />
      </div>

      {/* Provider ID override — only shown for the "custom" template */}
      {tmpl.id === 'custom' && (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
            {t('config.providerId')}
          </label>
          <input
            value={customProviderId}
            onChange={(e) => {
              const nextProviderId = normalizeProviderIdForWrite(e.target.value) || 'custom';
              setCustomProviderId(e.target.value);
              setProfileName(`${nextProviderId}:main`);
            }}
            placeholder={t('config.providerIdPlaceholder')}
            className={clsx(
              'bg-aegis-surface border border-aegis-border rounded-lg px-3 py-2',
              'text-aegis-text text-sm font-mono outline-none focus:border-aegis-primary',
              'transition-colors duration-200'
            )}
          />
          <p className="text-[10px] text-aegis-text-muted leading-tight">
            {t('config.providerIdHint')}
          </p>
        </div>
      )}

      {/* API Endpoint (Base URL) — for providers that require a URL, or when baseUrl was overridden by catalog */}
      {(isCustomLike || catalogEntry?.baseUrlOverride) && (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
            {t('config.baseUrl')}
          </label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={tmpl.baseUrl || t('config.baseUrlPlaceholder')}
            className={clsx(
              'bg-aegis-surface border border-aegis-border rounded-lg px-3 py-2',
              'text-aegis-text text-sm font-mono outline-none focus:border-aegis-primary',
              'transition-colors duration-200'
            )}
          />
          {/* Drift warning: user changed the pre-filled URL */}
          {baseUrlDrifted && (
            <p className="text-[10px] text-amber-400 leading-tight">
              {t('config.baseUrlDriftWarning', { url: catalogEntry?.baseUrlOverride })}
            </p>
          )}
          {tmpl.hint && !baseUrlDrifted && (
            <p className="text-[10px] text-aegis-text-muted leading-tight">{tmpl.hint}</p>
          )}
        </div>
      )}

      {/* Model IDs — for providers that require manual model entry */}
      {isCustomLike && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
              {t('config.modelId')}
            </label>
            <ChipInput
              values={customModelIds}
              onChange={setCustomModelIds}
              placeholder={t('config.modelIdPlaceholder')}
            />
            <p className="text-[10px] text-aegis-text-muted leading-tight">
              {t('config.modelIdHint', { providerId: effectiveProviderId })}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
              {t('config.imageCapableModelsLabel', 'Image-capable Model IDs')}
            </label>
            <ChipInput
              values={imageCapableModelIds}
              onChange={setImageCapableModelIds}
              placeholder={t('config.imageCapableModelsPlaceholder', 'Enter model IDs that support images')}
            />
            <p className="text-[10px] text-aegis-text-muted leading-tight">
              {t(
                'config.imageCapableModelsHint',
                'Manual and unsupported providers default to text-only. Add only model IDs that really support image input.'
              )}
            </p>
          </div>
        </div>
      )}

      {/* Auth mode + API Key */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
            {t('config.authMode')}
          </label>
          <select
            value={authMode}
            onChange={(e) => setAuthMode(normalizeProviderAuthMode(e.target.value))}
            className={clsx(
              'bg-aegis-menu-bg border border-aegis-menu-border rounded-lg px-3 py-2',
              'text-aegis-text text-sm outline-none focus:border-aegis-primary',
              'transition-colors duration-200 cursor-pointer'
            )}
          >
            {tmpl.authModes.map((m) => (
              <option key={m} value={m}>
                {t(`config.authModeOption.${m}` as const, m)}
              </option>
            ))}
          </select>
        </div>
        {authModeNeedsApiKey(authMode) && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
              {t('config.apiKey')}
            </label>
            <MaskedInput
              value={apiKey}
              onChange={setApiKey}
              placeholder={tmpl.envKey || t('config.apiKeyPlaceholder')}
            />
          </div>
        )}
      </div>

      {tmpl.envKey && (
        <p className="text-[10px] text-aegis-text-muted -mt-2">
          {t('config.envKeyHint', { envKey: tmpl.envKey })}
          {tmpl.envKeyAlt && tmpl.envKeyAlt.length > 0 && (
            <span className="opacity-70"> {t('config.envKeyAltHint', { keys: tmpl.envKeyAlt.join(', ') })}</span>
          )}
        </p>
      )}

      {/* Test connection — all providers with baseUrl (OpenClaw-style: GET models endpoint) */}
      {canTestConnection && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={testConnection}
            disabled={testStatus === 'testing'}
            className={clsx(
              'self-start flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium',
              'border border-aegis-border text-aegis-text-secondary',
              'hover:bg-white/[0.03] hover:border-aegis-border-hover',
              'disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200'
            )}
          >
            {testStatus === 'testing' ? (
              <Loader2 size={12} className="animate-spin" />
            ) : null}
            {t('config.testConnection')}
          </button>
          {testStatus === 'ok' && (
            <p className="text-[11px] text-green-500 font-medium">{testMessage}</p>
          )}
          {testStatus === 'error' && testMessage && (
            <p className="text-[11px] text-red-400 font-mono break-all">{testMessage}</p>
          )}
        </div>
      )}

      {/* Suggested models */}
      {suggestedModels.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
              {t('config.suggestedModels')}
            </label>
            <span
              className={clsx(
                'text-[10px] font-semibold px-2 py-1 rounded-full border',
                modelSourceInfo.className
              )}
            >
              {modelSourceInfo.label}
            </span>
          </div>
          <p className="text-[10px] text-aegis-text-muted leading-tight">
            {modelSourceInfo.detail}
          </p>
          {(loadingGatewayModels || loadingProviderCatalog) && (
            <p className="text-[10px] text-aegis-text-muted">{t('config.loading', 'Loading...')}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {suggestedModels.map((id) => {
              const selected = selectedModels.includes(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleModel(id)}
                  className={clsx(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium',
                    'border transition-all duration-200',
                    selected
                      ? 'border-aegis-primary/40 bg-aegis-primary/10 text-aegis-primary'
                      : 'border-aegis-border bg-aegis-elevated text-aegis-text-secondary hover:border-aegis-border-hover'
                  )}
                >
                  {selected && <CheckCircle size={10} />}
                  <span>{id}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!isCustomLike && (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
            {t('config.modelId')}
          </label>
          <ChipInput
            values={extraModelIds}
            onChange={setExtraModelIds}
            placeholder={t('config.modelIdPlaceholder')}
          />
          <p className="text-[10px] text-aegis-text-muted leading-tight">
            {t('config.modelIdHint', { providerId: effectiveProviderId })}
          </p>
        </div>
      )}

      {normalizedModelOptions.length > 0 && (
        <div className="rounded-xl border border-aegis-border bg-aegis-surface p-3 space-y-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-aegis-text-muted">
              {t('config.defaultModelSettings', 'Default Model Settings')}
            </div>
            <p className="mt-1 text-[10px] text-aegis-text-muted leading-tight">
              {t('config.defaultModelSettingsHint', 'Choose which enabled model should handle normal text requests and image-capable requests.')}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
                {t('config.defaultTextModel', 'Default Text Model')}
              </label>
              <select
                value={resolvedTextPrimaryModel}
                onChange={(e) => setTextPrimaryModel(e.target.value)}
                className={clsx(
                  'bg-aegis-menu-bg border border-aegis-menu-border rounded-lg px-3 py-2',
                  'text-aegis-text text-sm outline-none focus:border-aegis-primary',
                  'transition-colors duration-200 cursor-pointer'
                )}
              >
                {normalizedModelOptions.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
                {t('config.defaultImageModel', 'Default Image Model')}
              </label>
              <select
                value={resolvedImagePrimaryModel}
                onChange={(e) => setImagePrimaryModel(e.target.value)}
                className={clsx(
                  'bg-aegis-menu-bg border border-aegis-menu-border rounded-lg px-3 py-2',
                  'text-aegis-text text-sm outline-none focus:border-aegis-primary',
                  'transition-colors duration-200 cursor-pointer'
                )}
              >
                <option value="">{t('config.notSet', 'Not set')}</option>
                {imageModelOptions.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
              {imageModelOptions.length === 0 && (
                <p className="text-[10px] text-aegis-text-muted">
                  {t('config.imageModelStrictHint', 'No image-capable models detected in current selection')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Config preview — shows exactly what will be written before the user clicks Add */}
      {(apiKey || effectiveBaseUrl || selectedModels.length > 0 || customModelIds.length > 0) && (
        <div className="rounded-xl border border-aegis-border bg-aegis-surface overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-aegis-text-muted">
              {t('config.configPreviewTitle')}
            </span>
            <button
              type="button"
              onClick={() => setPreviewOpen((open) => !open)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-semibold',
                'text-aegis-text-muted hover:text-aegis-text hover:bg-white/[0.04]',
                'transition-all duration-200'
              )}
            >
              <ChevronRight
                size={12}
                className={clsx('transition-transform duration-200', previewOpen && 'rotate-90')}
              />
              {previewOpen ? t('common.hide') : t('common.show')}
            </button>
          </div>
          {previewOpen && (
            <div className="border-t border-aegis-border p-3">
              {previewChanges ? (
                <pre className="whitespace-pre-wrap break-all text-[10px] font-mono leading-relaxed text-aegis-text-muted">
                  {JSON.stringify(previewChanges, null, 2)}
                </pre>
              ) : (
                <span className="text-[10px] italic text-aegis-text-muted">
                  {t('config.apiKeyEmpty')}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex gap-2 pt-1 border-t border-aegis-border">
        <button
          onClick={onBack}
          className={clsx(
            'px-4 py-2 rounded-lg text-sm font-medium',
            'border border-aegis-border text-aegis-text-secondary',
            'hover:bg-white/[0.03] hover:border-aegis-border-hover',
            'transition-all duration-200'
          )}
        >
          {t('config.back')}
        </button>
        <button
          onClick={() => void handleSubmit()}
          disabled={!canSubmit || saving}
          className={clsx(
            'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg',
            'text-sm font-bold bg-aegis-primary text-aegis-btn-primary-text',
            'hover:brightness-110 transition-all duration-200',
            'disabled:opacity-40 disabled:cursor-not-allowed'
          )}
        >
          <Save size={14} /> {saving ? t('config.saving') : t('config.saveAndRestart')}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Provider Modal — Shell
// ─────────────────────────────────────────────────────────────────────────────

interface AddProviderModalProps {
  config: GatewayRuntimeConfig;
  saving: boolean;
  onClose: () => void;
  onSubmit: (
    profileKey: string,
    profile: AuthProfile,
    models: string[],
    providerConfig?: ProviderConfigOverride,
    connectionProbe?: ConnectionPrecheckProbe
  ) => Promise<boolean>;
  /** Pre-select a template and skip to the configure step */
  initialTemplate?: ProviderTemplate;
}

function AddProviderModal({ config, saving, onClose, onSubmit, initialTemplate }: AddProviderModalProps) {
  const { t } = useTranslation();
  const [step, setStep]               = useState<'pick' | 'configure'>(
    initialTemplate ? 'configure' : 'pick'
  );
  const [selectedTmpl, setSelectedTmpl]   = useState<ProviderTemplate | null>(initialTemplate ?? null);
  const [selectedEntry, setSelectedEntry] = useState<ProviderCatalogEntry | undefined>(undefined);

  const handlePick = (tmpl: ProviderTemplate, entry?: ProviderCatalogEntry) => {
    setSelectedTmpl(tmpl);
    setSelectedEntry(entry);
    setStep('configure');
  };

  const handleBack = () => {
    setStep('pick');
    setSelectedTmpl(null);
    setSelectedEntry(undefined);
  };

  return (
    /* backdrop — allow close on pick step; block on configure/confirm to avoid losing form data */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget && step === 'pick') onClose(); }}
    >
      {/* modal */}
      <div
        className={clsx(
          'bg-aegis-card-solid border border-aegis-border rounded-2xl w-full max-w-lg',
          'max-h-[90vh] overflow-hidden flex flex-col',
          'shadow-[0_8px_30px_rgba(0,0,0,0.5)]',
          'animate-[pop-in_0.15s_ease-out]'
        )}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-aegis-border">
          <h3 className="text-sm font-bold text-aegis-text">
            {step === 'pick'
              ? t('config.addProvider')
              : t('config.configureProvider', {
                name: selectedEntry
                  ? t(`config.providerCatalog.${selectedEntry.catalogId}`, selectedEntry.label)
                  : selectedTmpl?.name ?? t('config.providers'),
              })}
          </h3>
          <button
            onClick={onClose}
            className="text-aegis-text-muted hover:text-aegis-text transition-colors p-1"
          >
            <X size={16} />
          </button>
        </div>

        {/* body */}
        <div className="p-5 overflow-y-auto flex-1">
          {step === 'pick' ? (
            <PickStep onPick={handlePick} onClose={onClose} />
          ) : selectedTmpl ? (
            <ConfigureStep
              config={config}
              tmpl={selectedTmpl}
              catalogEntry={selectedEntry}
              onBack={handleBack}
              saving={saving}
              onSubmit={async (key, profile, models, providerConfig, connectionProbe) => {
                const ok = await onSubmit(key, profile, models, providerConfig, connectionProbe);
                if (ok) onClose();
                return ok;
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ProvidersTab — Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function ProvidersTab({ config, onChange, onApplyAndSave, saving, addRequestId = 0 }: ProvidersTabProps) {
  const { t } = useTranslation();
  const [showModal, setShowModal]                   = useState(false);
  const [modalInitialTemplate, setModalInitialTemplate] = useState<ProviderTemplate | undefined>();

  const allModels    = config.agents?.defaults?.models ?? {};
  const allModelImageSupportMap = useMemo(
    () => buildConfiguredImageSupportMap(allModels),
    [allModels]
  );
  const primaryModel = config.agents?.defaults?.model?.primary;
  const imagePrimaryModel = config.agents?.defaults?.imageModel?.primary;
  const imageGenerationPrimaryModel = config.agents?.defaults?.imageGenerationModel?.primary;
  const videoGenerationPrimaryModel = config.agents?.defaults?.videoGenerationModel?.primary;
  const imageGenerationOptions = useMemo(
    () => Array.from(new Set([
      ...GENERATED_IMAGE_GENERATION_MODELS.map((entry) => entry.id),
      ...(imageGenerationPrimaryModel ? [imageGenerationPrimaryModel] : []),
    ])).sort((a, b) => a.localeCompare(b)),
    [imageGenerationPrimaryModel]
  );
  const videoGenerationOptions = useMemo(
    () => Array.from(new Set([
      ...GENERATED_VIDEO_GENERATION_MODELS.map((entry) => entry.id),
      ...(videoGenerationPrimaryModel ? [videoGenerationPrimaryModel] : []),
    ])).sort((a, b) => a.localeCompare(b)),
    [videoGenerationPrimaryModel]
  );

  useEffect(() => {
    const modelIds = Object.keys(allModels);
    if (modelIds.length === 0) return;
    const desiredPrimary = primaryModel && modelIds.includes(primaryModel)
      ? primaryModel
      : modelIds[0];
    const desiredImagePrimary = resolveImagePrimaryModel(
      imagePrimaryModel,
      modelIds,
      allModelImageSupportMap
    );
    if (desiredPrimary === primaryModel && desiredImagePrimary === imagePrimaryModel) return;
    onChange((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        defaults: {
          ...prev.agents?.defaults,
          model: {
            ...prev.agents?.defaults?.model,
            primary: desiredPrimary,
          },
          imageModel: desiredImagePrimary
            ? {
              ...prev.agents?.defaults?.imageModel,
              primary: desiredImagePrimary,
            }
            : undefined,
        },
      },
    }));
  }, [allModelImageSupportMap, allModels, imagePrimaryModel, onChange, primaryModel]);

  // ── Build unified provider list ──
  const unifiedProviders = useMemo(() => buildUnifiedProviders(config), [config]);

  // ── Stats ──
  const uniqueProviderCount = useMemo(
    () => new Set(unifiedProviders.map((p) => p.provider)).size,
    [unifiedProviders]
  );
  const modelCount = Object.keys(allModels).length;
  const aliasCount = Object.values(allModels).filter((m) => m.alias).length;

  // ── Open modal (optionally with a pre-selected template) ──
  const openModal = useCallback((template?: ProviderTemplate) => {
    setModalInitialTemplate(template);
    setShowModal(true);
  }, []);

  useEffect(() => {
    if (addRequestId > 0) openModal();
  }, [addRequestId, openModal]);

  // ── Add provider (auth profile + models) ──
  const handleAdd = (
    profileKey: string,
    profile: AuthProfile,
    models: string[],
    providerConfig?: ProviderConfigOverride
  ) => {
    onChange((prev) => applyProviderAddition(prev, profileKey, profile, models, providerConfig));
  };

  return (
    <div className="flex flex-col gap-5">

      {/* ── A) Overview Hero Card ── */}
      <div
        className={clsx(
          'rounded-xl border border-aegis-border p-5',
          'bg-white/[0.02] backdrop-blur-sm'
        )}
      >
        {/* top */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-aegis-text flex items-center gap-1.5"><Bot size={15} strokeWidth={1.75} /> {t('config.providers')}</h2>
            <p className="text-xs text-aegis-text-muted mt-0.5">
              {t('config.manageProvidersDesc')}
            </p>
          </div>
          <button
            onClick={() => openModal()}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold',
              'bg-aegis-primary text-aegis-btn-primary-text',
              'hover:brightness-110 transition-all duration-200'
            )}
          >
            <Plus size={12} /> {t('config.addProvider')}
          </button>
        </div>

        {/* stats row */}
        <div className="flex gap-5 p-3.5 bg-aegis-surface border border-aegis-border rounded-xl">
          <StatCard value={uniqueProviderCount} label={t('config.providers')} colorClass="text-aegis-primary" />
          <div className="w-px bg-aegis-border" />
          <StatCard value={modelCount} label={t('config.models')}  colorClass="text-blue-400" />
          <div className="w-px bg-aegis-border" />
          <StatCard value={aliasCount} label={t('config.aliases')} colorClass="text-purple-400" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <div className="flex items-center gap-3 p-3.5 bg-aegis-surface border border-aegis-primary/20 rounded-xl">
            <div
              className={clsx(
                'w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0',
                'bg-aegis-primary/10 border border-aegis-primary/20'
              )}
            >
              ⭐
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-aegis-text-muted uppercase tracking-wider font-bold">
                {t('config.primaryModel')}
              </div>
              <div className="text-sm font-bold text-aegis-primary truncate mt-0.5">
                {primaryModel ?? (
                  <span className="text-aegis-text-muted font-normal italic">
                    {t('config.notSet', 'Not set')}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3.5 bg-aegis-surface border border-blue-500/20 rounded-xl">
            <div
              className={clsx(
                'w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0',
                'bg-blue-500/10 border border-blue-500/20'
              )}
            >
              🖼
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-aegis-text-muted uppercase tracking-wider font-bold">
                {t('config.imageModel', 'Image Model')}
              </div>
              <div className="text-sm font-bold text-blue-400 truncate mt-0.5">
                {imagePrimaryModel ?? (
                  <span className="text-aegis-text-muted font-normal italic">
                    {t('config.notSet', 'Not set')}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <div className="flex items-center gap-3 p-3.5 bg-aegis-surface border border-emerald-500/20 rounded-xl">
            <div
              className={clsx(
                'w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0',
                'bg-emerald-500/10 border border-emerald-500/20'
              )}
            >
              <Palette size={14} strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-aegis-text-muted uppercase tracking-wider font-bold">
                {t('config.imageGenerationModel', 'Image Generation Model')}
              </div>
              <div className="text-sm font-bold text-emerald-400 truncate mt-0.5">
                {imageGenerationPrimaryModel ?? (
                  <span className="text-aegis-text-muted font-normal italic">
                    {t('config.notSet', 'Not set')}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3.5 bg-aegis-surface border border-pink-500/20 rounded-xl">
            <div
              className={clsx(
                'w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0',
                'bg-pink-500/10 border border-pink-500/20'
              )}
            >
              <Film size={14} strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-aegis-text-muted uppercase tracking-wider font-bold">
                {t('config.videoGenerationModel', 'Video Generation Model')}
              </div>
              <div className="text-sm font-bold text-pink-400 truncate mt-0.5">
                {videoGenerationPrimaryModel ?? (
                  <span className="text-aegis-text-muted font-normal italic">
                    {t('config.notSet', 'Not set')}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── B) Unified Providers List ── */}
      <div className="rounded-xl border border-aegis-border bg-aegis-elevated overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-aegis-border">
          <h3 className="text-xs font-bold uppercase tracking-widest text-aegis-text-secondary">
              <Plug size={20} strokeWidth={1.75} /> {t('config.providers')}
            </h3>
        </div>
        <div className="p-4">
          {unifiedProviders.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Bot size={40} strokeWidth={1.5} className="opacity-30 text-aegis-text-muted" />
              <p className="text-sm font-medium text-aegis-text-secondary">
                {t('config.noProviders')}
              </p>
              <p className="text-xs text-aegis-text-muted">{t('config.addFirstProvider')}</p>
              <button
                onClick={() => openModal()}
                className={clsx(
                  'mt-2 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold',
                  'bg-aegis-primary text-aegis-btn-primary-text hover:brightness-110',
                  'transition-all duration-200'
                )}
              >
                <Plus size={14} /> {t('config.addProvider')}
              </button>
            </div>
          ) : (
            <>
              {unifiedProviders.map((up) => {
                if (up.source === 'auth') {
                  return (
                    <ProfileRow
                      key={up.key}
                      profileKey={up.profileKey!}
                      profile={up.authProfile!}
                      allModels={allModels}
                      modelsProvider={up.modelsProvider}
                      primaryModel={primaryModel}
                      imagePrimaryModel={imagePrimaryModel}
                      imageSupportMap={allModelImageSupportMap}
                      apiKeyConfigured={up.envKeyFound}
                      apiKeySource={up.credentialSource}
                      credentialUnverified={up.credentialUnverified}
                      envKeyValue={up.envKeyValue}
                      onChange={onChange}
                      saving={saving}
                    />
                  );
                }
                if (up.source === 'models-provider') {
                  return (
                    <ModelsProviderRow
                      key={up.key}
                      unifiedProvider={up}
                      onChange={onChange}
                      primaryModel={primaryModel}
                      imagePrimaryModel={imagePrimaryModel}
                      imageSupportMap={allModelImageSupportMap}
                      saving={saving}
                    />
                  );
                }
                // env-only
                return (
                  <EnvOnlyRow
                    key={up.key}
                    unifiedProvider={up}
                    onConfigure={(tmpl) => openModal(tmpl)}
                  />
                );
              })}

              {/* Add row */}
              <button
                onClick={() => openModal()}
                className={clsx(
                  'w-full flex items-center justify-center gap-2 p-4 mt-1',
                  'border-2 border-dashed border-aegis-border rounded-xl',
                  'text-xs font-semibold text-aegis-text-muted',
                  'hover:border-aegis-primary hover:text-aegis-primary hover:bg-aegis-primary/5',
                  'transition-all duration-200 cursor-pointer'
                )}
              >
                <Plus size={13} /> {t('config.addProvider')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── C) Models & Aliases ── */}
      {modelCount > 0 && (
        <div className="rounded-xl border border-aegis-border bg-aegis-elevated overflow-hidden">
          <div className="px-5 py-3.5 border-b border-aegis-border">
            <h3 className="text-xs font-bold uppercase tracking-widest text-aegis-text-secondary">
              <FileText size={14} strokeWidth={1.75} /> {t('config.modelsAndAliases')}
            </h3>
          </div>
          <div className="p-4">
            <DefaultModelControls
              models={allModels}
              primaryModel={primaryModel}
              imageModel={imagePrimaryModel}
              imageSupportMap={allModelImageSupportMap}
              disabled={saving}
              onSetPrimary={(id) => {
                onChange((prev) => ({
                  ...prev,
                  agents: {
                    ...prev.agents,
                    defaults: buildDefaultsWithResolvedModels({
                      defaults: prev.agents?.defaults,
                      models: prev.agents?.defaults?.models ?? {},
                      primary: id,
                    }),
                  },
                }));
              }}
              onSetImageModel={(id) => {
                onChange((prev) => ({
                  ...prev,
                  agents: {
                    ...prev.agents,
                    defaults: buildDefaultsWithResolvedModels({
                      defaults: prev.agents?.defaults,
                      models: prev.agents?.defaults?.models ?? {},
                      imagePrimary: id,
                    }),
                  },
                }));
              }}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 my-4">
              <div className="rounded-lg border border-aegis-border bg-aegis-surface p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-aegis-text-muted mb-1.5">
                  {t('config.imageGenerationModel', 'Image Generation Model')}
                </div>
                <select
                  className="w-full rounded-lg border border-aegis-border bg-aegis-elevated px-2 py-2 text-xs text-aegis-text"
                  value={imageGenerationPrimaryModel ?? ''}
                  disabled={saving}
                  onChange={(e) => {
                    const value = e.target.value || undefined;
                    onChange((prev) => ({
                      ...prev,
                      agents: {
                        ...prev.agents,
                        defaults: {
                          ...prev.agents?.defaults,
                          imageGenerationModel: value
                            ? { ...prev.agents?.defaults?.imageGenerationModel, primary: value }
                            : undefined,
                        },
                      },
                    }));
                  }}
                >
                  <option value="">{t('config.notSet', 'Not set')}</option>
                  {imageGenerationOptions.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </div>
              <div className="rounded-lg border border-aegis-border bg-aegis-surface p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-aegis-text-muted mb-1.5">
                  {t('config.videoGenerationModel', 'Video Generation Model')}
                </div>
                <select
                  className="w-full rounded-lg border border-aegis-border bg-aegis-elevated px-2 py-2 text-xs text-aegis-text"
                  value={videoGenerationPrimaryModel ?? ''}
                  disabled={saving}
                  onChange={(e) => {
                    const value = e.target.value || undefined;
                    onChange((prev) => ({
                      ...prev,
                      agents: {
                        ...prev.agents,
                        defaults: {
                          ...prev.agents?.defaults,
                          videoGenerationModel: value
                            ? { ...prev.agents?.defaults?.videoGenerationModel, primary: value }
                            : undefined,
                        },
                      },
                    }));
                  }}
                >
                  <option value="">{t('config.notSet', 'Not set')}</option>
                  {videoGenerationOptions.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </div>
            </div>
            <ChipList
              models={allModels}
              primaryModel={primaryModel}
              imageModel={imagePrimaryModel}
              imageSupportMap={allModelImageSupportMap}
              disabled={saving}
              onSetPrimary={(id) => {
                onChange((prev) => ({
                  ...prev,
                  agents: {
                    ...prev.agents,
                    defaults: buildDefaultsWithResolvedModels({
                      defaults: prev.agents?.defaults,
                      models: prev.agents?.defaults?.models ?? {},
                      primary: id,
                    }),
                  },
                }));
              }}
              onSetImageModel={(id) => {
                onChange((prev) => ({
                  ...prev,
                  agents: {
                    ...prev.agents,
                    defaults: buildDefaultsWithResolvedModels({
                      defaults: prev.agents?.defaults,
                      models: prev.agents?.defaults?.models ?? {},
                      imagePrimary: id,
                    }),
                  },
                }));
              }}
              onRemove={(id) => {
                onChange((prev) => removeProviderModel({
                  config: prev,
                  providerId: getProviderFromModelId(id),
                  modelRef: id,
                }));
              }}
            />
          </div>
        </div>
      )}

      {/* ── Add Provider Modal ── */}
      {showModal && (
        <AddProviderModal
          config={config}
          saving={saving}
          onClose={() => {
            setShowModal(false);
            setModalInitialTemplate(undefined);
          }}
          onSubmit={async (profileKey, profile, models, providerConfig, connectionProbe) =>
            onApplyAndSave(
              (prev) => applyProviderAddition(prev, profileKey, profile, models, providerConfig),
              { connectionProbe }
            )
          }
          initialTemplate={modalInitialTemplate}
        />
      )}
    </div>
  );
}

export default ProvidersTab;
