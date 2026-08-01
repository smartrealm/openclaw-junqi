// ═══════════════════════════════════════════════════════════
// Config Manager — Complete (Phase 5)
// Full config state management + Diff Preview + Export/Import
// ═══════════════════════════════════════════════════════════

import { lazy, Suspense, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FileJson, CheckCircle2, AlertCircle, RefreshCw, Bot, Users, MessageSquare, Wrench, SlidersHorizontal, KeyRound, type LucideIcon, Download, Upload } from 'lucide-react';
import clsx from 'clsx';
import type { GatewayRuntimeConfig } from './types';
import { getTemplateById } from './providerTemplates';
import { GENERATED_PROVIDER_CATALOG } from '@/generated/providerCatalog.generated';
import { gateway } from '@/services/gateway';
import { gatewayLifecycle } from '@/services/gateway/gatewayLifecycle';
import {
  summarizeOfficialProviderProbe,
  type ProviderProbeRequest,
  type ProviderProbeSummary,
} from '@/services/openclawProviderRuntime';
import {
  normalizeAgentsForRuntime,
  normalizeModelsProvidersForRuntime,
} from './runtimeNormalization';
import {
  authProfilesForRuntime,
  normalizeAuthProfilesFromDisk,
} from './configUtils';
import { deriveProviderApiKeyEnvKey, preserveProviderSecretsFromDisk } from './providerSecretResolver';
import { FloatingSaveButton, ChangesPill } from './components';
import { debugLog, debugWarn } from '@/utils/debugLog';
import { resolveModelSupportsImage } from '@/utils/providerModelCapabilities';
import { readConfigNavigationIntent, type ConfigTab } from './configNavigation';
import { migrateLegacyChannelBindings } from '@/services/channelConfig';
import { isChannelConfigurationMetadataKey } from '@/services/channelConfigMerge';
import { smartMerge } from './configMerge';
import { diffConfigPaths, planConfigReload } from '@/services/gateway/configReloadPlan';

type Tab = ConfigTab;

const ProvidersTab = lazy(() => import('./ProvidersTab').then((module) => ({ default: module.ProvidersTab })));
const AgentsTab = lazy(() => import('./AgentsTab').then((module) => ({ default: module.AgentsTab })));
const ChannelsTab = lazy(() => import('./ChannelsTab').then((module) => ({ default: module.ChannelsTab })));
const ToolsTab = lazy(() => import('./ToolsTab').then((module) => ({ default: module.ToolsTab })));
const AdvancedTab = lazy(() => import('./AdvancedTab').then((module) => ({ default: module.AdvancedTab })));
const SecretsTab = lazy(() => import('./SecretsTab').then((module) => ({ default: module.SecretsTab })));

export function ConfigManagerPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('providers');
  const [providerAddRequestId, setProviderAddRequestId] = useState(0);

  // `tab` is durable navigation state. `action` is consumed once so direct
  // links can open a workflow without coupling the sidebar to modal state.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const intent = readConfigNavigationIntent(searchParams);
    if (intent.tab) {
      setActiveTab(intent.tab);
    }
    if (intent.addProvider) {
      setProviderAddRequestId((current) => current + 1);
      setSearchParams(intent.consumedParams!, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // ── Config detection ──
  const [detecting, setDetecting]     = useState(true);
  const [configPath, setConfigPath]   = useState<string>('');
  const [configExists, setConfigExists] = useState(false);
  const [error, setError]             = useState<string>('');

  // ── Config state (live + original for diff) ──
  const [config, setConfig]                 = useState<GatewayRuntimeConfig | null>(null);
  const [originalConfig, setOriginalConfig] = useState<GatewayRuntimeConfig | null>(null);
  const [saving, setSaving]                 = useState(false);

  // ── Modal / toast state ──
  const [saveSuccess, setSaveSuccess]     = useState(false);
  const [reloading, setReloading]         = useState(false);
  const [reloadSuccess, setReloadSuccess] = useState(false);
  const [connectionFailures, setConnectionFailures] = useState<string[] | null>(null);
  const connectionConfirmResolverRef = useRef<((value: boolean) => void) | null>(null);

  // ── hasChanges — true when config differs from disk ──
  const hasChanges = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(originalConfig),
    [config, originalConfig]
  );

  // ── Load config on mount ──
  useEffect(() => {
    const init = async () => {
      try {
        setDetecting(true);
        setError('');

        const detected = await window.aegis.config.detect();
        setConfigPath(detected.path);
        setConfigExists(detected.exists);
        if (!detected.valid) {
          throw new Error(detected.error || 'The selected OpenClaw config is invalid.');
        }

        // A missing openclaw.json is a valid first-run state. The backend read
        // contract returns an empty object for that case. Keep the editor
        // usable and let the first save create the selected-runtime file.
        const { data } = await window.aegis.config.read();
        const normalized = normalizeConfig(data);
        setConfig(normalized);
        setOriginalConfig(structuredClone(normalized));
      } catch (err: any) {
        setError(err.message || 'Unknown error');
      } finally {
        setDetecting(false);
      }
    };

    init();
  }, []);

  // ── Ctrl+S shortcut — saves directly ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (hasChanges && config && !saving) void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hasChanges, config, saving, handleSave]);

  // ── onChange handler — takes an updater function ──
  const handleChange = useCallback(
    (updater: (prev: GatewayRuntimeConfig) => GatewayRuntimeConfig) => {
      setConfig((prev) => (prev ? updater(prev) : prev));
    },
    []
  );

  // ── Save ──
  async function persistConfig(
    targetConfig?: GatewayRuntimeConfig | null,
    options?: { connectionProbe?: ProviderProbeRequest }
  ): Promise<boolean> {
    const configToSave = targetConfig ?? config;
    if (!configToSave) return false;
    setSaving(true);

    try {
      // 1. Re-read the latest version from disk to capture any external edits
      const { data: diskConfig, revision } = await window.aegis.config.read();

      // 2. Apply only the user's changes on top of the fresh disk version
      const mergedRaw = smartMerge(diskConfig, originalConfig, configToSave) as GatewayRuntimeConfig;
      // Preserve provider env vars from disk when the UI state lost them but the
      // provider/profile still exists. Prevents accidental API key deletion.
      const merged = preserveProviderSecretsFromDisk(diskConfig, mergedRaw);

      // Strip UI-only fields before validation/probing. Do not infer or replace
      // OpenClaw tool providers from JunQi-owned credential heuristics: only an
      // explicit user edit or the selected Runtime may choose those values.
      const toWrite = normalizeConfigForDisk(merged);
      const precheckResult = await runConnectionPrecheck(toWrite, options?.connectionProbe);
      if (!precheckResult.ok) {
        const continueSave = await requestConnectionFailureConfirm(precheckResult.failures);
        if (!continueSave) return false;
      }

      // 3. Write the already validated candidate.
      const writeResult = await window.aegis.config.write(toWrite, revision);
      if (!writeResult.success) {
        throw new Error(writeResult.error || t('config.saveFailed'));
      }
      setConfigExists(true);

      // 3.5 Keep main agent runtime state clean:
      // normalize alias-drifted auth-profiles and force models.json rebuild.
      try {
        await window.aegis.agentAuth?.rehydrateMainRuntime?.();
      } catch (rehydrateErr) {
        debugWarn('app', '[Config] Failed to rehydrate main runtime state:', rehydrateErr);
      }

      // 4. Sync UI state from the actual saved config so in-memory state matches disk.
      const normalizedSavedConfig = normalizeConfig(toWrite);
      // Captured before the state setters below: the reload plan needs the
      // pre-save baseline, and relying on the stale closure value of
      // `originalConfig` would break the moment this moves to a ref.
      const reloadBaseline = originalConfig;
      setConfig(structuredClone(normalizedSavedConfig));
      setOriginalConfig(structuredClone(normalizedSavedConfig));

      // Keep the last confirmed catalog mounted while the Gateway reloads.
      // Clearing it here unmounts the composer control and causes a visible flash.
      const chatStore = (await import('@/stores/chatStore')).useChatStore;
      chatStore.setState({ modelsLoading: true });

      // Only restart when OpenClaw says this change needs it. reloadKind is
      // per-path and only available from config.schema.lookup; an unknown or
      // unavailable answer degrades to restart rather than skipping it.
      const changedPaths = diffConfigPaths(reloadBaseline ?? {}, normalizedSavedConfig);
      const reloadPlan = await planConfigReload(
        changedPaths,
        (path) => gateway.callPrivileged('config.schema.lookup', { path }),
      );
      if (reloadPlan.fallbackReason) {
        debugWarn('app', '[Config] Reload semantics unavailable, restarting:', reloadPlan.fallbackReason);
      }
      debugLog('app', '[Config] Reload plan:', reloadPlan.kind, reloadPlan.decidingPaths);

      if (reloadPlan.kind !== 'restart') {
        // `hot` is applied by the Gateway itself; `none` needs nothing at all.
        setError('');
        setSaveSuccess(true);
        window.dispatchEvent(new Event('aegis:config-saved'));
        chatStore.setState({ modelsLoading: false });
        return true;
      }

      try {
        const restartResult = await gatewayLifecycle.restart('config-manager');
        if (restartResult.success) {
          if (restartResult.requiresAppRestart) {
            setError('Config saved. Restart the desktop app to apply shell-level changes.');
          } else {
            setError('');
          }
          setSaveSuccess(true);
          window.dispatchEvent(new Event('aegis:config-saved'));
          debugLog('app', '[Config] Apply method:', restartResult.method, restartResult.changedPaths);
        } else {
          // Save succeeded but restart failed — show warning with instructions
          setSaveSuccess(true);
          window.dispatchEvent(new Event('aegis:config-saved'));
          debugWarn('app', '[Config] Restart failed:', restartResult.error);
          setError(`Config saved, but gateway restart failed: ${restartResult.error || 'Unknown error'}`);
        }
      } catch {
        // restart IPC not available — still show save success
        setSaveSuccess(true);
        window.dispatchEvent(new Event('aegis:config-saved'));
        debugWarn('app', '[Config] Restart IPC unavailable');
      }

      setTimeout(() => setSaveSuccess(false), 3000);
      return true;
    } catch (err: any) {
      setError(err.message || t('config.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    return persistConfig();
  }

  async function handleApplyAndSave(
    updater: (prev: GatewayRuntimeConfig) => GatewayRuntimeConfig,
    options?: { connectionProbe?: ProviderProbeRequest }
  ): Promise<boolean> {
    if (!config) return false;
    return persistConfig(updater(config), options);
  }

  // ── Export ──
  const handleExport = () => {
    if (!config) return;
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openclaw-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Import ──
  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.json5';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const data = await window.aegis.config.parse(text);
        setConfig(normalizeConfig(data));
        // Don't update originalConfig — so hasChanges becomes true
      } catch {
        setError(t('config.importError'));
      }
    };
    input.click();
  };

  // ── Normalization ──
  // auth.profiles may contain legacy fields ("type"/"key") or newer UI fields ("mode"/"apiKey"/"token").
  // Normalize to mode/apiKey/token when writing to disk.
  const canonicalProviderId = (providerId: string | undefined): string => {
    const normalized = String(providerId ?? '').trim().toLowerCase();
    if (normalized === 'modelstudio' || normalized === 'qwencloud' || normalized === 'qwen-dashscope') return 'qwen';
    if (normalized === 'z.ai' || normalized === 'z-ai') return 'zai';
    if (normalized === 'kimi-coding' || normalized === 'kimi-code' || normalized === 'kimi') return 'kimi-coding';
    return normalized;
  };

  const stripProviderPrefix = (providerId: string, modelId: string | undefined): string => {
    const trimmed = String(modelId ?? '').trim();
    if (!trimmed) return trimmed;
    const slashIndex = trimmed.indexOf('/');
    if (slashIndex <= 0) return trimmed;
    const head = trimmed.slice(0, slashIndex);
    if (canonicalProviderId(head) !== canonicalProviderId(providerId)) return trimmed;
    return trimmed.slice(slashIndex + 1);
  };

  const canonicalizeModelRef = (modelRef: string | undefined): string | undefined => {
    const trimmed = String(modelRef ?? '').trim();
    if (!trimmed) return undefined;
    const slashIndex = trimmed.indexOf('/');
    if (slashIndex <= 0) return trimmed;
    const provider = canonicalProviderId(trimmed.slice(0, slashIndex));
    const model = trimmed.slice(slashIndex + 1).trim();
    return provider && model ? `${provider}/${model}` : trimmed;
  };

  const PROVIDER_API_KEY_REF_RE = /^\$\{[^}]+\}$/;

  const isProviderApiKeyReference = (value: unknown): boolean => {
    if (typeof value === 'string') {
      return PROVIDER_API_KEY_REF_RE.test(value.trim());
    }
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return typeof record.source === 'string' || typeof record.id === 'string';
  };

  const hydrateAgentModelCapabilitiesForUi = (data: GatewayRuntimeConfig): GatewayRuntimeConfig => {
    const models = data.agents?.defaults?.models;
    if (!models || Object.keys(models).length === 0) return data;

    let mutated = false;
    const providerConfigs = data.models?.providers ?? {};
    const nextModels: Record<string, any> = {};
    for (const [modelRef, modelEntry] of Object.entries(models)) {
      const existingEntry =
        modelEntry && typeof modelEntry === 'object'
          ? { ...(modelEntry as Record<string, any>) }
          : {};
      const explicitSupport = resolveModelSupportsImage(existingEntry);
      if (typeof explicitSupport === 'boolean') {
        nextModels[modelRef] = existingEntry;
        continue;
      }

      const canonicalRef = canonicalizeModelRef(modelRef) ?? modelRef;
      const slashIndex = canonicalRef.indexOf('/');
      const providerId = slashIndex > 0 ? canonicalProviderId(canonicalRef.slice(0, slashIndex)) : undefined;
      const rawModelId = slashIndex > 0 ? canonicalRef.slice(slashIndex + 1) : canonicalRef;
      const providerModels = providerId ? providerConfigs[providerId]?.models : undefined;
      const providerModel = Array.isArray(providerModels)
        ? providerModels.find((item: any) => stripProviderPrefix(providerId!, String(item?.id ?? '')) === rawModelId)
        : undefined;
      const generatedSupport =
        typeof providerId === 'string'
          ? GENERATED_PROVIDER_CATALOG[providerId]?.find(
            (item) => stripProviderPrefix(providerId, item.id) === rawModelId
          )?.supportsImage
          : undefined;
      const inferredSupport =
        resolveModelSupportsImage(providerModel)
        ?? generatedSupport;

      if (typeof inferredSupport === 'boolean') {
        mutated = true;
        nextModels[modelRef] = {
          ...existingEntry,
          supportsImage: inferredSupport,
          input: inferredSupport ? ['text', 'image'] : ['text'],
        };
        continue;
      }

      nextModels[modelRef] = existingEntry;
    }

    if (!mutated) return data;
    return {
      ...data,
      agents: {
        ...data.agents,
        defaults: {
          ...data.agents?.defaults,
          models: nextModels,
        },
      },
    };
  };

  const isPrivateHostname = (hostname: string): boolean => {
    const normalized = String(hostname ?? '').trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === 'localhost' || normalized.endsWith('.local')) return true;
    const ipv4Match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4Match) return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd');
    const [a, b, c, d] = ipv4Match.slice(1).map((part) => Number(part));
    if ([a, b, c, d].some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false;
    if (a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    return false;
  };

  const shouldAutoAllowPrivateProviderNetwork = (
    providerId: string,
    providerConfig: Record<string, any> | undefined,
  ): boolean => {
    const baseUrl = String(providerConfig?.baseUrl ?? '').trim();
    if (!baseUrl) return false;
    const template = getTemplateById(providerId);
    const isCustomLike = !template || template.id === 'custom' || template.id === 'vllm' || template.id === 'ollama';
    if (!isCustomLike) return false;
    try {
      return isPrivateHostname(new URL(baseUrl).hostname);
    } catch {
      return false;
    }
  };

  const ensurePrivateProviderNetworkAccess = (data: GatewayRuntimeConfig): GatewayRuntimeConfig => {
    const providers = data.models?.providers;
    if (!providers || Object.keys(providers).length === 0) return data;

    let mutated = false;
    const nextProviders: Record<string, any> = {};
    for (const [rawProviderId, providerValue] of Object.entries(providers)) {
      const providerId = canonicalProviderId(rawProviderId);
      const providerConfig =
        providerValue && typeof providerValue === 'object'
          ? { ...(providerValue as Record<string, any>) }
          : providerValue;
      if (
        providerConfig &&
        typeof providerConfig === 'object' &&
        shouldAutoAllowPrivateProviderNetwork(providerId, providerConfig) &&
        providerConfig.request?.allowPrivateNetwork !== false
      ) {
        const nextRequest = {
          ...(providerConfig.request ?? {}),
          allowPrivateNetwork: true,
        };
        if (JSON.stringify(nextRequest) !== JSON.stringify(providerConfig.request ?? {})) {
          mutated = true;
          nextProviders[providerId] = {
            ...providerConfig,
            request: nextRequest,
          };
          continue;
        }
      }
      nextProviders[providerId] = providerConfig;
    }

    if (!mutated) return data;
    return {
      ...data,
      models: {
        ...data.models,
        providers: nextProviders,
      },
    };
  };

  const stripProviderSecrets = (data: GatewayRuntimeConfig): GatewayRuntimeConfig => {
    const providers = data.models?.providers;
    if (!providers) return data;

    let mutated = false;
    const nextProviders: Record<string, any> = {};
    for (const [providerId, providerConfig] of Object.entries(providers)) {
      if (
        providerConfig &&
        typeof providerConfig === 'object' &&
        'apiKey' in providerConfig &&
        !isProviderApiKeyReference((providerConfig as Record<string, unknown>).apiKey)
      ) {
        const { apiKey: _apiKey, ...rest } = providerConfig as Record<string, any>;
        nextProviders[providerId] = rest;
        mutated = true;
      } else {
        nextProviders[providerId] = providerConfig;
      }
    }

    if (!mutated) return data;
    return {
      ...data,
      models: {
        ...data.models,
        providers: nextProviders,
      },
    };
  };

  // Bring existing configs in line with latest schema:
  // - For any auth.profiles[*] whose provider has an envKey template,
  //   move token/apiKey into env.vars[envKey] and clear them from profile.
  const normalizeConfig = (data: GatewayRuntimeConfig): GatewayRuntimeConfig => {
    let next: GatewayRuntimeConfig = { ...data };
    // Ensure auth.profiles use apiKey/mode for UI (from key/type on disk)
    if (next.auth?.profiles) {
      next = {
        ...next,
        auth: {
          ...next.auth,
          profiles: normalizeAuthProfilesFromDisk(next.auth.profiles) ?? next.auth.profiles,
        },
      };
    }
    const profiles = next.auth?.profiles ?? {};

    for (const [profileKey, profile] of Object.entries(profiles)) {
      const providerId = (profile as any).provider ?? profileKey.split(':')[0];
      const tmpl = getTemplateById(providerId);
      if (!tmpl?.envKey) continue;

      const key = (profile as any).token ?? (profile as any).apiKey ?? (profile as any).key;
      if (!key) continue;

      next = {
        ...next,
        env: {
          ...next.env,
          vars: {
            ...(next.env?.vars ?? {}),
            [tmpl.envKey]: key,
          },
        },
        auth: {
          ...next.auth,
          profiles: {
            ...(next.auth?.profiles ?? {}),
            [profileKey]: {
              ...profile,
              token: undefined,
              apiKey: undefined,
            },
          },
        },
      };
    }
    const stripped = stripProviderSecrets(next);
    return hydrateAgentModelCapabilitiesForUi(stripped);
  };

  const migrateCustomProviderSecretsToModels = (data: GatewayRuntimeConfig): GatewayRuntimeConfig => {
    const profiles = data.auth?.profiles;
    if (!profiles || Object.keys(profiles).length === 0) return data;

    let mutated = false;
    const nextProfiles: Record<string, any> = {};
    const nextEnvVars = { ...(data.env?.vars ?? {}) };
    const nextProviders = { ...(data.models?.providers ?? {}) };

    for (const [profileKey, profileValue] of Object.entries(profiles)) {
      const profile = profileValue && typeof profileValue === 'object'
        ? { ...(profileValue as Record<string, any>) }
        : {};
      const providerId = canonicalProviderId(profile.provider ?? profileKey.split(':')[0]);
      const template = getTemplateById(providerId);
      const secret = profile.token ?? profile.apiKey ?? profile.key;
      const shouldUseProviderApiKey = Boolean(secret) && (!template || template.id === 'custom');

      if (!shouldUseProviderApiKey) {
        nextProfiles[profileKey] = profile;
        continue;
      }

      const envKey = deriveProviderApiKeyEnvKey(providerId, template);
      nextEnvVars[envKey] = String(secret);
      nextProviders[providerId] = {
        ...(nextProviders[providerId] ?? {}),
        apiKey: `\${${envKey}}`,
      };
      nextProfiles[profileKey] = {
        ...profile,
        provider: providerId,
        token: undefined,
        apiKey: undefined,
        key: undefined,
      };
      mutated = true;
    }

    if (!mutated) return data;
    return {
      ...data,
      env: {
        ...data.env,
        vars: nextEnvVars,
      },
      auth: {
        ...data.auth,
        profiles: nextProfiles,
      },
      models: {
        ...data.models,
        providers: nextProviders,
      },
    };
  };

  const normalizeConfigForDisk = (data: GatewayRuntimeConfig): GatewayRuntimeConfig => {
    const migrated = migrateCustomProviderSecretsToModels(data);
    const withPrivateProviderAccess = ensurePrivateProviderNetworkAccess(migrated);
    const auth = withPrivateProviderAccess.auth;
    const normalized = {
      ...withPrivateProviderAccess,
      agents: normalizeAgentsForRuntime({
        agents: withPrivateProviderAccess.agents,
        providers: withPrivateProviderAccess.models?.providers,
        generatedProviderCatalog: GENERATED_PROVIDER_CATALOG,
        canonicalizeModelRef,
      }),
      models: withPrivateProviderAccess.models
        ? {
          ...withPrivateProviderAccess.models,
          providers: normalizeModelsProvidersForRuntime({
            providers: withPrivateProviderAccess.models.providers,
            agents: withPrivateProviderAccess.agents,
            generatedProviderCatalog: GENERATED_PROVIDER_CATALOG,
            canonicalProviderId,
            stripProviderPrefix,
            canonicalizeModelRef,
            getTemplateById,
          }),
        }
        : data.models,
      auth: !auth?.profiles ? auth : {
        ...auth,
        profiles: authProfilesForRuntime(auth.profiles, canonicalProviderId),
      },
    };
    return migrateLegacyChannelBindings(normalized);
  };

  const requestConnectionFailureConfirm = (failures: string[]) => {
    return new Promise<boolean>((resolve) => {
      connectionConfirmResolverRef.current = resolve;
      setConnectionFailures(failures);
    });
  };

  const resolveConnectionFailureConfirm = (value: boolean) => {
    const resolver = connectionConfirmResolverRef.current;
    connectionConfirmResolverRef.current = null;
    setConnectionFailures(null);
    resolver?.(value);
  };

  const probeProviderCandidate = async (
    candidate: GatewayRuntimeConfig,
    probe: ProviderProbeRequest,
  ): Promise<ProviderProbeSummary> => {
    const providerId = canonicalProviderId(probe.providerId);
    if (!providerId) {
      return { ok: false, status: 'unknown', detail: 'Provider ID is required.' };
    }
    const normalizedCandidate = normalizeConfigForDisk(candidate);
    const payload = await window.aegis.providerRuntime.probe(
      normalizedCandidate,
      providerId,
      probe.profileKey,
    );
    return summarizeOfficialProviderProbe(payload);
  };

  const runConnectionPrecheck = async (
    candidate: GatewayRuntimeConfig,
    probe?: ProviderProbeRequest,
  ) => {
    if (!probe) {
      return { ok: true, failures: [] as string[] };
    }
    const providerId = canonicalProviderId(probe.providerId);
    try {
      const result = await probeProviderCandidate(candidate, probe);
      if (result.ok) return { ok: true, failures: [] as string[] };
      const detail = [result.status, result.reasonCode, result.detail]
        .filter(Boolean)
        .join(' · ');
      return {
        ok: false,
        failures: [`${providerId}:${probe.profileKey ?? 'default'} — ${detail}`],
      };
    } catch (error: any) {
      return {
        ok: false,
        failures: [`${providerId}:${probe.profileKey ?? 'default'} — ${error?.message || String(error)}`],
      };
    }
  };

  // ── Reload (re-detect path + re-read) ──
  const handleReload = async () => {
    if (reloading) return;
    setReloading(true);
    setError('');
    setReloadSuccess(false);
    try {
      const detected = await window.aegis.config.detect();
      setConfigPath(detected.path);
      setConfigExists(detected.exists);
      if (!detected.valid) {
        throw new Error(detected.error || 'The selected OpenClaw config is invalid.');
      }

      const { data } = await window.aegis.config.read();
      const normalized = normalizeConfig(data);
      setConfig(normalized);
      setOriginalConfig(structuredClone(normalized));
      setReloadSuccess(true);
      setTimeout(() => setReloadSuccess(false), 2000);
    } catch (err: any) {
      setError(err.message || 'Reload failed');
    } finally {
      setReloading(false);
    }
  };

  // ── Discard ──
  const handleDiscard = () => {
    if (originalConfig) {
      setConfig(structuredClone(originalConfig));
    }
  };

  // ── Derived counts ──
  const providerCount = (() => {
    const authIds = new Set(
      Object.values(config?.auth?.profiles ?? {}).map((p: any) =>
        p?.provider ?? 'unknown'
      )
    );
    const modelIds = new Set(Object.keys(config?.models?.providers ?? {}));
    const allIds = new Set([...authIds, ...modelIds]);
    allIds.delete('unknown');
    return allIds.size;
  })();
  const rawAgents = config?.agents?.list ?? [];
  const hasMainAgent = rawAgents.some((a) => a.id === 'main');
  // UI always shows a "Main" agent row, even when it isn't explicitly in agents.list.
  // Count should match what the user sees in the Agents tab.
  const agentCount = hasMainAgent ? rawAgents.length : rawAgents.length + 1;
  const channelCount = config?.channels
    ? Object.keys(config.channels).filter((channelId) => !isChannelConfigurationMetadataKey(channelId)).length
    : 0;

  // ── Smart tab badges ──
  const toolCount = [
    config?.tools?.profile,
    config?.tools?.deny?.length,
    config?.tools?.allow?.length,
    config?.tools?.web?.search?.enabled,
    config?.tools?.web?.fetch?.enabled,
  ].filter(Boolean).length;

  const tabs: { id: Tab; labelKey: string; icon: LucideIcon; badge?: number | string }[] = [
    { id: 'providers', labelKey: 'config.providers', icon: Bot,         badge: providerCount           },
    { id: 'agents',    labelKey: 'config.agents',    icon: Users,       badge: agentCount              },
    { id: 'channels',  labelKey: 'config.channels',  icon: MessageSquare, badge: channelCount           },
    { id: 'tools',     labelKey: 'config.toolsConfig', icon: Wrench,     badge: toolCount || undefined  },
    { id: 'advanced',  labelKey: 'config.advanced',  icon: SlidersHorizontal, badge: undefined          },
    { id: 'secrets',   labelKey: 'config.secrets',   icon: KeyRound,    badge: undefined               },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-aegis-border bg-aegis-card/80 backdrop-blur-md flex-shrink-0 gap-4 flex-nowrap">
        <div className="flex items-center gap-3 shrink-0">
          <h1 className="text-lg font-bold text-aegis-text whitespace-nowrap">{t('config.title')}</h1>
          {hasChanges && <ChangesPill label={t('config.unsavedChanges')} />}
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-nowrap">
          <button
            onClick={handleReload}
            disabled={reloading}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border whitespace-nowrap',
              'transition-all duration-200',
              reloadSuccess
                ? 'border-aegis-success/40 text-aegis-success bg-aegis-success/8'
                : 'border-aegis-border text-aegis-text-secondary hover:bg-white/[0.03] hover:border-aegis-border-hover',
              reloading && 'opacity-60 cursor-not-allowed',
            )}
          >
            <RefreshCw size={12} className={clsx('shrink-0', reloading && 'animate-spin')} />
            <span className="whitespace-nowrap">
              {reloading
                ? t('config.reloading')
                : reloadSuccess
                  ? t('config.reloadDone')
                  : t('config.reload')}
            </span>
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border whitespace-nowrap border-aegis-border text-aegis-text-secondary hover:bg-white/[0.03] hover:border-aegis-border-hover transition-all duration-200"
          >
            <Download size={14} strokeWidth={1.75} className="shrink-0" />
            <span className="whitespace-nowrap">{t('config.exportConfig')}</span>
          </button>
          <button
            onClick={handleImport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border whitespace-nowrap border-aegis-border text-aegis-text-secondary hover:bg-white/[0.03] hover:border-aegis-border-hover transition-all duration-200"
          >
            <Upload size={14} strokeWidth={1.75} className="shrink-0" />
            <span className="whitespace-nowrap">{t('config.importConfig')}</span>
          </button>

        </div>
      </div>

      {/* ── Tabs bar ── */}
      <div className="border-b border-aegis-border flex gap-0 overflow-x-auto flex-shrink-0 bg-aegis-card/60 backdrop-blur-sm">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap',
              'border-b-2 transition-all duration-200',
              activeTab === tab.id
                ? 'text-aegis-primary border-aegis-primary bg-white/[0.02]'
                : 'text-aegis-text-muted border-transparent hover:text-aegis-text-secondary hover:bg-white/[0.02]'
            )}
          >
            <tab.icon size={15} strokeWidth={1.75} />
            <span>{t(tab.labelKey)}</span>
            {tab.badge != null && (typeof tab.badge === 'string' || tab.badge > 0) && (
              <span
                className={clsx(
                  'text-[10px] font-bold px-1.5 py-0.5 rounded-full border',
                  activeTab === tab.id
                    ? 'bg-aegis-primary/10 text-aegis-primary border-aegis-primary/20'
                    : 'bg-aegis-elevated text-aegis-text-muted border-aegis-border'
                )}
              >
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto p-6 pb-24">

        {/* Config path card */}
        <div className="rounded-xl border border-aegis-border bg-aegis-elevated p-4 flex items-start gap-3 mb-5">
          <FileJson className="text-aegis-primary mt-0.5 shrink-0" size={16} />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-aegis-text-muted mb-1 font-medium">{t('config.configPath')}</div>
            {detecting ? (
              <div className="text-sm text-aegis-text-muted animate-pulse">{t('config.detecting')}</div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-aegis-text font-mono truncate flex-1 min-w-0">
                  {configPath || '—'}
                </span>
                {configExists ? (
                  <CheckCircle2 size={13} className="text-aegis-primary shrink-0" />
                ) : (
                  <AlertCircle size={13} className="text-aegis-text-muted shrink-0" />
                )}
              </div>
            )}
            {!detecting && !configExists && (
              <div className="text-xs text-aegis-text-muted mt-1">{t('config.noFile')}</div>
            )}
          </div>
        </div>

        {/* Quick stats (only when config loaded) */}
        {!detecting && config && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { val: providerCount, label: t('config.providers'), color: 'text-aegis-primary' },
              { val: agentCount,    label: t('config.agents'),    color: 'text-blue-400' },
              { val: channelCount,  label: t('config.channels'),  color: 'text-purple-400' },
            ].map(({ val, label, color }) => (
              <div
                key={label}
                className="rounded-xl border border-aegis-border bg-aegis-elevated p-4 text-center"
              >
                <div className={clsx('text-2xl font-extrabold', color)}>{val}</div>
                <div className="text-xs text-aegis-text-muted mt-1">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tab content */}
        {detecting ? (
          <div className="flex items-center justify-center py-20 text-aegis-text-muted text-sm animate-pulse">
            {t('config.detecting')}
          </div>
        ) : !config ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <AlertCircle size={32} className="text-aegis-text-muted" />
            <p className="text-sm text-aegis-text-secondary">{t('config.noFile')}</p>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-20 text-aegis-text-muted text-sm animate-pulse">
                {t('common.loading', 'Loading...')}
              </div>
            }
          >
            {activeTab === 'providers' ? (
              <ProvidersTab
                config={config}
                onChange={handleChange}
                onApplyAndSave={handleApplyAndSave}
                onProbeProvider={probeProviderCandidate}
                saving={saving}
                addRequestId={providerAddRequestId}
              />
            ) : activeTab === 'agents' ? (
              <AgentsTab config={config} onChange={handleChange} />
            ) : activeTab === 'channels' ? (
              <ChannelsTab config={config} onChange={handleChange} />
            ) : activeTab === 'tools' ? (
              <ToolsTab config={config} onChange={handleChange} />
            ) : activeTab === 'advanced' ? (
              <AdvancedTab config={config} onChange={handleChange} />
            ) : activeTab === 'secrets' ? (
              <SecretsTab config={config} />
            ) : null}
          </Suspense>
        )}

        {/* Error display */}
        {error && (
          <div className="mt-4 rounded-xl border border-aegis-border bg-aegis-elevated p-4 flex items-start gap-3">
            <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
            <span className="text-sm text-red-400">{error}</span>
          </div>
        )}
      </div>

      {/* ── Floating Save ── */}
      <FloatingSaveButton
        hasChanges={hasChanges}
        saving={saving}
        onSave={() => void handleSave()}
        onDiscard={handleDiscard}
      />

      {connectionFailures && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl border border-aegis-border bg-aegis-card-solid shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
            <div className="px-5 py-4 border-b border-aegis-border">
              <h3 className="text-sm font-bold text-aegis-text">
                {t('config.connectionPrecheckTitle', '连接测试未全部通过')}
              </h3>
              <p className="text-xs text-aegis-text-muted mt-1">
                {t('config.connectionPrecheckHint', '建议先修复连接再保存；你也可以选择继续保存并重启 Gateway。')}
              </p>
            </div>
            <div className="px-5 py-4 max-h-64 overflow-auto">
              <div className="text-xs text-aegis-text-muted mb-2">
                {t('config.connectionPrecheckFailedList', '失败项：')}
              </div>
              <div className="space-y-1.5">
                {connectionFailures.map((item) => (
                  <div
                    key={item}
                    className="text-xs font-mono break-all rounded-lg border border-red-500/20 bg-red-500/8 text-red-300 px-2.5 py-2"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="px-5 py-4 border-t border-aegis-border flex items-center justify-end gap-2">
              <button
                autoFocus
                onClick={() => resolveConnectionFailureConfirm(false)}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-aegis-border text-aegis-text-secondary hover:bg-white/[0.03] transition-colors"
              >
                {t('config.connectionPrecheckCancel', '取消保存')}
              </button>
              <button
                onClick={() => resolveConnectionFailureConfirm(true)}
                className="px-3.5 py-2 rounded-lg text-xs font-bold bg-aegis-primary text-aegis-btn-primary-text hover:brightness-110 transition-all"
              >
                {t('config.connectionPrecheckContinue', '仍然继续保存')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Save Success Toast — portal to body so it is not squeezed/covered by page stacking contexts ── */}
      {saveSuccess && createPortal(
        <div
          className="fixed top-4 right-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-aegis-primary/10 border border-aegis-primary/20 text-aegis-primary text-sm font-medium animate-[float-in_0.3s_ease-out] shadow-lg backdrop-blur-xl"
          style={{ zIndex: 2147483000, minWidth: 220, maxWidth: 'min(360px, calc(100vw - 32px))' }}
        >
          <CheckCircle2 size={15} className="shrink-0" />
          <span className="whitespace-nowrap overflow-hidden text-ellipsis">{t('config.configSaved')}</span>
        </div>,
        document.body
      )}

    </div>
  );
}

export default ConfigManagerPage;
