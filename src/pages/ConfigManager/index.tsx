// ═══════════════════════════════════════════════════════════
// Config Manager — Complete (Phase 5)
// Full config state management + Diff Preview + Export/Import
// ═══════════════════════════════════════════════════════════

import { lazy, Suspense, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FileJson, CheckCircle2, AlertCircle, Pencil, History, RefreshCw, Bot, Users, MessageSquare, Wrench, SlidersHorizontal, KeyRound, Sparkles, type LucideIcon, Download, Upload, Check } from 'lucide-react';
import clsx from 'clsx';
import type { GatewayRuntimeConfig } from './types';
import { getTemplateById } from './providerTemplates';
import { GENERATED_PROVIDER_CATALOG } from '@/generated/providerCatalog.generated';
import { testProviderConnection, type ConnectionPrecheckProbe } from './providerConnectionTest';
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

type Tab = ConfigTab;

type ConfigBackup = {
  key: string;
  data: any;
  ts: number;
};

function readLocalConfigBackups(): ConfigBackup[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('aegis-config-backups') || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is ConfigBackup => (
        item &&
        typeof item === 'object' &&
        typeof item.key === 'string' &&
        typeof item.ts === 'number' &&
        'data' in item
      ))
      .sort((a, b) => a.ts - b.ts);
  } catch (err) {
    debugWarn('app', '[Config] Failed to read local backups:', err);
    return [];
  }
}

function summarizeBackupConfig(config: GatewayRuntimeConfig) {
  const providers = Object.keys(config.models?.providers ?? {}).length;
  const agents = config.agents?.list?.length ?? 0;
  const envVars = Object.keys(config.env?.vars ?? {}).length;
  return { providers, agents, envVars };
}

const ProvidersTab = lazy(() => import('./ProvidersTab').then((module) => ({ default: module.ProvidersTab })));
const AgentsTab = lazy(() => import('./AgentsTab').then((module) => ({ default: module.AgentsTab })));
const ChannelsTab = lazy(() => import('./ChannelsTab').then((module) => ({ default: module.ChannelsTab })));
const ToolsTab = lazy(() => import('./ToolsTab').then((module) => ({ default: module.ToolsTab })));
const AdvancedTab = lazy(() => import('./AdvancedTab').then((module) => ({ default: module.AdvancedTab })));
const SecretsTab = lazy(() => import('./SecretsTab').then((module) => ({ default: module.SecretsTab })));

// ─────────────────────────────────────────────────────────────
// smartMerge — applies only the user's changes (diff between
// original and current) on top of the latest disk version.
// This preserves any CLI / external edits made after page load.
//
// Rules:
//   current[key] !== original[key]  → user changed it   → use current
//   current[key] === original[key]  → user didn't touch  → use disk  (preserves external changes)
//   key in disk but NOT in original → external addition  → preserve
//   key in original but NOT in current → user deleted    → omit
//   Arrays are treated as atomic (no element-level merge)
// ─────────────────────────────────────────────────────────────
function smartMerge(disk: any, original: any, current: any): any {
  // Handle non-object / null cases
  if (disk === null || disk === undefined) return current;
  if (
    typeof disk !== 'object' ||
    typeof original !== 'object' ||
    typeof current !== 'object'
  ) {
    return JSON.stringify(original) !== JSON.stringify(current) ? current : disk;
  }

  // Arrays — treat as atomic (order matters, e.g. agents.list)
  if (Array.isArray(current) || Array.isArray(disk)) {
    return JSON.stringify(original) !== JSON.stringify(current) ? current : disk;
  }

  // Treat null original as empty object so deletion semantics work correctly
  if (original === null || original === undefined) original = {};

  const result: Record<string, any> = {};

  const allKeys = new Set([
    ...Object.keys(disk),
    ...Object.keys(current),
  ]);

  for (const key of allKeys) {
    const inDisk     = key in disk;
    const inOriginal = key in (original || {});
    const inCurrent  = key in current;

    if (inCurrent && !inOriginal && !inDisk) {
      // User added a brand-new key → include it
      result[key] = current[key];
    } else if (!inCurrent && inOriginal) {
      // User deleted this key → respect the deletion
      continue;
    } else if (inDisk && !inCurrent && !inOriginal) {
      // External addition (not in original, not in current) → preserve it
      result[key] = disk[key];
    } else if (inCurrent && inDisk) {
      // Both exist — recurse
      result[key] = smartMerge(disk[key], (original || {})[key], current[key]);
    } else if (inCurrent) {
      result[key] = current[key];
    } else if (inDisk) {
      result[key] = disk[key];
    }
  }

  return result;
}

function hasAnyAuthProfile(config: GatewayRuntimeConfig, providerId: string): boolean {
  const profiles = config.auth?.profiles ?? {};
  return Object.keys(profiles).some((k) => k.split(':')[0] === providerId);
}

/// Compare two configs to detect whether the user changed *which* provider
/// or its credentials (env vars, base URLs, models.providers). Used to
/// decide whether the WebSocket needs a full reconnect after save — a
/// sessions.patch alone is not enough when the active provider changes.
function detectProviderChange(
  prev: GatewayRuntimeConfig | null,
  next: GatewayRuntimeConfig,
): boolean {
  if (!prev) return false;

  // 1. env.vars — adding/removing/changing a key under a known envKey means
  //    the new auth material is in play. Compare by the union of keys.
  const prevEnv = (prev.env?.vars ?? {}) as Record<string, string>;
  const nextEnv = (next.env?.vars ?? {}) as Record<string, string>;
  const envKeys = new Set([...Object.keys(prevEnv), ...Object.keys(nextEnv)]);
  for (const k of envKeys) {
    if ((prevEnv[k] ?? '') !== (nextEnv[k] ?? '')) return true;
  }

  // 2. models.providers — switching active provider or its base URL counts.
  const prevProviders = (prev.models?.providers ?? {}) as Record<string, any>;
  const nextProviders = (next.models?.providers ?? {}) as Record<string, any>;
  const providerIds = new Set([...Object.keys(prevProviders), ...Object.keys(nextProviders)]);
  for (const id of providerIds) {
    const a = prevProviders[id] ?? {};
    const b = nextProviders[id] ?? {};
    if ((a.baseUrl ?? '') !== (b.baseUrl ?? '')) return true;
    if (JSON.stringify(a.models ?? {}) !== JSON.stringify(b.models ?? {})) return true;
  }

  return false;
}

function resolveConfiguredWebSearchProviders(config: GatewayRuntimeConfig): string[] {
  const envVars = config.env?.vars ?? {};
  const has = (k: string) => Boolean(String(envVars[k] ?? '').trim());
  const entries = config.plugins?.entries ?? {};
  const hasPlugin = (pluginId: string, field: 'apiKey' | 'baseUrl') =>
    Boolean(String(entries[pluginId]?.config?.webSearch?.[field] ?? '').trim());
  const set = new Set<string>();
  if (has('BRAVE_API_KEY') || hasPlugin('brave', 'apiKey')) set.add('brave');
  if (has('EXA_API_KEY') || hasPlugin('exa', 'apiKey')) set.add('exa');
  if (has('FIRECRAWL_API_KEY') || hasPlugin('firecrawl', 'apiKey')) set.add('firecrawl');
  if (has('GEMINI_API_KEY') || hasAnyAuthProfile(config, 'google') || hasPlugin('google', 'apiKey')) set.add('gemini');
  if (has('XAI_API_KEY') || hasAnyAuthProfile(config, 'xai') || hasPlugin('xai', 'apiKey')) set.add('grok');
  if (has('KIMI_API_KEY') || has('MOONSHOT_API_KEY') || hasAnyAuthProfile(config, 'moonshot') || hasAnyAuthProfile(config, 'kimi')) set.add('kimi');
  if (has('MINIMAX_CODE_PLAN_KEY') || has('MINIMAX_CODING_API_KEY') || has('MINIMAX_API_KEY') || hasAnyAuthProfile(config, 'minimax')) set.add('minimax');
  if (has('PERPLEXITY_API_KEY') || has('OPENROUTER_API_KEY') || hasAnyAuthProfile(config, 'perplexity')) set.add('perplexity');
  if (has('SEARXNG_BASE_URL') || hasPlugin('searxng', 'baseUrl')) set.add('searxng');
  if (has('TAVILY_API_KEY') || hasPlugin('tavily', 'apiKey')) set.add('tavily');
  if (hasAnyAuthProfile(config, 'ollama')) set.add('ollama');
  return Array.from(set);
}

function resolveConfiguredWebFetchProviders(config: GatewayRuntimeConfig): string[] {
  const envVars = config.env?.vars ?? {};
  const has = (k: string) => Boolean(String(envVars[k] ?? '').trim());
  const firecrawlCfg = config.plugins?.entries?.firecrawl?.config?.webFetch;
  if (has('FIRECRAWL_API_KEY') || Boolean(String(firecrawlCfg?.apiKey ?? '').trim())) {
    return ['firecrawl'];
  }
  return [];
}

function applyPreferredWebProviders(config: GatewayRuntimeConfig): GatewayRuntimeConfig {
  const next = structuredClone(config);
  const searchConfigured = resolveConfiguredWebSearchProviders(next);
  const fetchConfigured = resolveConfiguredWebFetchProviders(next);
  const currentSearch = next.tools?.web?.search?.provider;
  const currentFetch = next.tools?.web?.fetch?.provider;

  if (searchConfigured.length === 1) {
    const only = searchConfigured[0];
    const shouldSet = !currentSearch || currentSearch === 'auto' || !searchConfigured.includes(currentSearch);
    if (shouldSet) {
      next.tools = {
        ...next.tools,
        web: {
          ...next.tools?.web,
          search: { ...next.tools?.web?.search, provider: only },
        },
      };
    }
  }

  if (fetchConfigured.length === 1) {
    const only = fetchConfigured[0];
    const shouldSet = !currentFetch || currentFetch === 'auto' || !fetchConfigured.includes(currentFetch);
    if (shouldSet) {
      next.tools = {
        ...next.tools,
        web: {
          ...next.tools?.web,
          fetch: { ...next.tools?.web?.fetch, provider: only },
        },
      };
    }
  }

  return next;
}

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
  const [showBackups, setShowBackups]     = useState(false);
  const [reloading, setReloading]         = useState(false);
  const [reloadSuccess, setReloadSuccess] = useState(false);
  const [connectionFailures, setConnectionFailures] = useState<string[] | null>(null);
  const connectionConfirmResolverRef = useRef<((value: boolean) => void) | null>(null);

  // ── Backup dropdown: portal-based to escape stacking contexts ──
  const backupBtnRef = useRef<HTMLButtonElement>(null);
  const [backupMenuPos, setBackupMenuPos] = useState<{ top: number; right: number } | null>(null);

  const openBackups = useCallback(() => {
    if (!backupBtnRef.current) return;
    const rect = backupBtnRef.current.getBoundingClientRect();
    setBackupMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    setShowBackups(true);
  }, []);

  useEffect(() => {
    if (!showBackups) return;
    const close = (e: MouseEvent) => {
      // Close if the click is outside the button and the portal menu
      const target = e.target as Node;
      if (
        backupBtnRef.current && !backupBtnRef.current.contains(target) &&
        !document.getElementById('backup-menu-portal')?.contains(target)
      ) {
        setShowBackups(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showBackups]);

  // ── Editable config path ──
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput]     = useState('');

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

        if (detected.exists) {
          const { data } = await window.aegis.config.read(detected.path);
          const normalized = normalizeConfig(data);
          setConfig(normalized);
          setOriginalConfig(structuredClone(normalized));
        }
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

  const handleRestoreBackup = useCallback((backup: ConfigBackup) => {
    try {
      const restoredNormalized = normalizeConfig(structuredClone(backup.data));
      setConfig(restoredNormalized);
      // 恢复只载入编辑区，不覆盖 originalConfig。这样浮动保存条会出现，用户确认后才写盘。
      setShowBackups(false);
      setError('');
    } catch (err: any) {
      setError(err?.message || t('config.restoreBackupFailed', '备份恢复失败'));
    }
  }, [t]);

  // ── Save ──
  async function persistConfig(
    targetConfig?: GatewayRuntimeConfig | null,
    options?: { connectionProbe?: ConnectionPrecheckProbe }
  ): Promise<boolean> {
    const configToSave = targetConfig ?? config;
    if (!configToSave || !configPath) return false;
    setSaving(true);

    // Detect whether the user changed Provider (env vars, base URLs, or
    // models.providers). On a Provider switch the Gateway needs a fresh
    // WebSocket so its handshake re-evaluates the new auth/credentials —
    // a simple sessions.patch is not enough.
    const providerChanged = detectProviderChange(originalConfig, configToSave);
    try {
      // 1. Re-read the latest version from disk to capture any external edits
      const { data: diskConfig } = await window.aegis.config.read(configPath);

      // 2. Apply only the user's changes on top of the fresh disk version
      const mergedRaw = smartMerge(diskConfig, originalConfig, configToSave);
      // Preserve provider env vars from disk when the UI state lost them but the
      // provider/profile still exists. Prevents accidental API key deletion.
      const merged = preserveProviderSecretsFromDisk(diskConfig, mergedRaw);
      const precheckResult = await runConnectionPrecheck(options?.connectionProbe);
      if (!precheckResult.ok) {
        const continueSave = await requestConnectionFailureConfirm(precheckResult.failures);
        if (!continueSave) return false;
      }

      // Auto-backup: save last 5 versions before overwriting
      try {
        const backupKey = `config-backup-${Date.now()}`;
        const backups: { key: string; data: any; ts: number }[] = JSON.parse(
          localStorage.getItem('aegis-config-backups') || '[]'
        );
        backups.push({ key: backupKey, data: structuredClone(diskConfig), ts: Date.now() });
        // Keep only last 5
        while (backups.length > 5) backups.shift();
        localStorage.setItem('aegis-config-backups', JSON.stringify(backups));
      } catch (backupErr) {
        debugWarn('app', '[Config] Backup failed:', backupErr);
      }

      // 3. Apply save-time provider preference for web tools, then write
      const mergedWithPreferredProviders = applyPreferredWebProviders(merged);
      const toWrite = normalizeConfigForDisk(mergedWithPreferredProviders);
      const savedPrimaryModel = toWrite.agents?.defaults?.model?.primary ?? null;
      await window.aegis.config.write(configPath, toWrite);

      // 3.5 Keep main agent runtime state clean:
      // normalize alias-drifted auth-profiles and force models.json rebuild.
      try {
        await window.aegis.agentAuth?.rehydrateMainRuntime?.();
      } catch (rehydrateErr) {
        debugWarn('app', '[Config] Failed to rehydrate main runtime state:', rehydrateErr);
      }

      // 4. Sync UI state from the actual saved config so in-memory state matches disk.
      const normalizedSavedConfig = normalizeConfig(toWrite);
      setConfig(structuredClone(normalizedSavedConfig));
      setOriginalConfig(structuredClone(normalizedSavedConfig));

      // Restart gateway after successful save — temporarily mark models
      // as loading so the chat view doesn't flash "no provider" banner.
      const chatStore = (await import('@/stores/chatStore')).useChatStore;
      chatStore.getState().setAvailableModels([]);
      chatStore.setState({ modelsLoading: true });

      // Restart gateway after successful save
      try {
        const restartResult = await window.aegis.config.restart();
        if (restartResult.method === 'gateway-restart') {
          window.dispatchEvent(new CustomEvent('aegis:gateway-restart-requested'));
        }
        if (restartResult.success) {
          if (restartResult.requiresAppRestart) {
            setError('Config saved. Restart the desktop app to apply shell-level changes.');
          } else {
            setError('');
          }
          setSaveSuccess(true);
          window.dispatchEvent(new CustomEvent('aegis:config-saved', {
            detail: { primaryModel: savedPrimaryModel, providerChanged },
          }));
          debugLog('app', '[Config] Apply method:', restartResult.method, restartResult.changedPaths);
        } else {
          // Save succeeded but restart failed — show warning with instructions
          setSaveSuccess(true);
          window.dispatchEvent(new CustomEvent('aegis:config-saved', {
            detail: { primaryModel: savedPrimaryModel, providerChanged },
          }));
          debugWarn('app', '[Config] Restart failed:', restartResult.error);
          setError(`Config saved, but gateway restart failed: ${restartResult.error || 'Unknown error'}`);
        }
      } catch {
        // restart IPC not available — still show save success
        setSaveSuccess(true);
        window.dispatchEvent(new CustomEvent('aegis:config-saved', {
          detail: { primaryModel: savedPrimaryModel },
        }));
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
    options?: { connectionProbe?: ConnectionPrecheckProbe }
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
        const data = JSON.parse(text);
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

  const normalizeChannelStreaming = (channels: GatewayRuntimeConfig['channels']) => {
    if (!channels || typeof channels !== 'object') return channels;

    const normalizedChannels = { ...channels };
    let mutated = false;

    for (const [channelId, channelConfig] of Object.entries(channels)) {
      if (!channelConfig || typeof channelConfig !== 'object') continue;
      if (!('streaming' in channelConfig)) continue;

      const raw = (channelConfig as any).streaming;
      if (raw === undefined || raw === null) continue;

      if (channelId === 'feishu') {
        let nextValue: boolean | undefined;
        if (typeof raw === 'boolean') {
          nextValue = raw;
        } else if (typeof raw === 'string') {
          const v = raw.trim().toLowerCase();
          nextValue = !(v === '' || v === 'off' || v === 'false' || v === '0' || v === 'no');
        } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const mode = String((raw as any).mode ?? '').trim().toLowerCase();
          if (mode) {
            nextValue = !(mode === 'off' || mode === 'false' || mode === '0' || mode === 'no');
          }
        }
        if (typeof nextValue === 'boolean' && raw !== nextValue) {
          mutated = true;
          normalizedChannels[channelId] = { ...(channelConfig as any), streaming: nextValue };
        }
        continue;
      }

      if (channelId === 'telegram' || channelId === 'discord' || channelId === 'slack') {
        let nextStreaming = raw;
        if (typeof raw === 'string') {
          const mode = raw.trim().toLowerCase();
          if (mode) nextStreaming = { mode };
        } else if (typeof raw === 'boolean') {
          nextStreaming = { mode: raw ? 'partial' : 'off' };
        } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const mode = String((raw as any).mode ?? '').trim();
          if (mode) {
            nextStreaming = { ...(raw as any), mode: mode.toLowerCase() };
          }
        }
        if (JSON.stringify(nextStreaming) !== JSON.stringify(raw)) {
          mutated = true;
          normalizedChannels[channelId] = { ...(channelConfig as any), streaming: nextStreaming };
        }
        continue;
      }

      // Channels that don't expose streaming in the current Desktop UI templates should not persist it.
      const { streaming: _streaming, ...rest } = channelConfig as Record<string, any>;
      mutated = true;
      normalizedChannels[channelId] = rest;
    }

    return mutated ? normalizedChannels : channels;
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
    let mutated = false;

    for (const [profileKey, profile] of Object.entries(profiles)) {
      const providerId = (profile as any).provider ?? profileKey.split(':')[0];
      const tmpl = getTemplateById(providerId);
      if (!tmpl?.envKey) continue;

      const key = (profile as any).token ?? (profile as any).apiKey ?? (profile as any).key;
      if (!key) continue;

      mutated = true;
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
    const withNormalizedChannelStreaming = {
      ...next,
      channels: normalizeChannelStreaming(next.channels),
    };
    const stripped = stripProviderSecrets(withNormalizedChannelStreaming);
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
    const channels = normalizeChannelStreaming(withPrivateProviderAccess.channels);
    const normalized = {
      ...withPrivateProviderAccess,
      channels,
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
    return normalized;
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

  const runConnectionPrecheck = async (probe?: ConnectionPrecheckProbe) => {
    if (!probe) {
      return { ok: true, failures: [] as string[] };
    }

    const providerId = canonicalProviderId(probe.providerId);
    const baseUrl = String(probe.baseUrl ?? '').trim();
    const apiKey = String(probe.apiKey ?? '').trim();
    if (!providerId || !baseUrl || !apiKey) {
      return { ok: true, failures: [] as string[] };
    }
    const template = getTemplateById(providerId);
    const modelOverride = stripProviderPrefix(providerId, probe.modelOverride);
    const result = await testProviderConnection(baseUrl, apiKey, template, modelOverride);
    const failures = result.ok
      ? []
      : (() => {
          const rawMsg = result.message ?? '';
          const i18nMatch = rawMsg.match(/^__i18n:([^:]+):(.+)__$/);
          const displayMsg = i18nMatch ? t(i18nMatch[1], { status: i18nMatch[2] }) : rawMsg;
          return [`${providerId}:${probe.profileKey} — ${displayMsg}`];
        })();

    return { ok: failures.length === 0, failures };
  };

  // ── Reload (re-detect path + re-read) ──
  const handleReload = async () => {
    if (reloading) return;
    setReloading(true);
    setError('');
    setReloadSuccess(false);
    try {
      const detected = await window.aegis.config.detect();
      const pathToUse = configPath || detected.path;
      setConfigPath(pathToUse);
      setConfigExists(detected.exists || !!pathToUse);

      const { data } = await window.aegis.config.read(pathToUse);
      const normalized = normalizeConfig(data);
      setConfig(normalized);
      setOriginalConfig(structuredClone(normalized));
      setConfigExists(true);
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

  // ── Path editing ──
  const handleStartEdit = () => {
    setPathInput(configPath);
    setEditingPath(true);
  };

  const handlePathApply = async () => {
    const trimmed = pathInput.trim();
    if (!trimmed) return;
    setConfigPath(trimmed);
    setEditingPath(false);
    try {
      // Try to read from new path
      const { data } = await window.aegis.config.read(trimmed);
      const normalized = normalizeConfig(data);
      setConfig(normalized);
      setOriginalConfig(structuredClone(normalized));
      setConfigExists(true);
      setError('');
      // Save path preference for next time
      if (window.aegis.settings?.save) {
        await window.aegis.settings.save('openclawConfigPath', trimmed);
      }
    } catch (err: any) {
      setConfigExists(false);
      setConfig(null);
      setOriginalConfig(null);
      setError(err.message || 'Failed to read config');
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
  const channelCount = config?.channels ? Object.keys(config.channels).length : 0;
  const modelCount = config?.agents?.defaults?.models ? Object.keys(config.agents.defaults.models).length : 0;

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

          {/* Restore from backup */}
          <div className="relative shrink-0">
            <button
              ref={backupBtnRef}
              onClick={() => showBackups ? setShowBackups(false) : openBackups()}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap',
                'border border-aegis-border text-aegis-text-secondary',
                'hover:bg-white/[0.03] hover:border-aegis-border-hover',
                'transition-all duration-200',
                showBackups && 'border-aegis-primary/40 text-aegis-primary bg-aegis-primary/5'
              )}
              title={t('config.restoreBackup')}
            >
              <History size={13} className="shrink-0" />
              <span className="whitespace-nowrap">{t('config.restoreBackup')}</span>
            </button>
          </div>
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
            ) : editingPath ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  className="flex-1 bg-aegis-surface border border-aegis-border rounded-lg px-3 py-1.5 text-aegis-text text-sm font-mono outline-none focus:border-aegis-primary transition-colors"
                  placeholder={t('config.pathPlaceholder', 'D:\\MyClawdbot\\clawdbot.json')}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handlePathApply();
                    if (e.key === 'Escape') setEditingPath(false);
                  }}
                />
                <button
                  onClick={handlePathApply}
                  className="px-2 py-1.5 rounded-lg text-xs font-medium bg-aegis-primary/10 text-aegis-primary border border-aegis-primary/20 hover:bg-aegis-primary/20 transition-colors"
                >
                  <Check size={14} strokeWidth={1.75} /> {t('common.apply', 'Apply')}
                </button>
                <button
                  onClick={() => setEditingPath(false)}
                  className="px-2 py-1.5 rounded-lg text-xs font-medium text-aegis-text-muted hover:text-aegis-text transition-colors"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-aegis-text font-mono truncate flex-1 min-w-0">
                  {configPath || '—'}
                </span>
                <button
                  onClick={handleStartEdit}
                  className="text-aegis-text-muted hover:text-aegis-primary transition-colors shrink-0"
                  title={t('config.editPath', 'Edit path')}
                >
                  <Pencil size={13} />
                </button>
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
        {!detecting && configExists && config && (
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
        ) : !configExists || !config ? (
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

      {/* ── Backup dropdown portal — rendered to body to escape stacking contexts ── */}
      {showBackups && backupMenuPos && createPortal(
        <div
          id="backup-menu-portal"
          style={{ position: 'fixed', top: backupMenuPos.top, right: backupMenuPos.right, zIndex: 9999 }}
          className={clsx(
            'w-72',
            'bg-aegis-menu-bg border border-aegis-menu-border rounded-xl',
            'shadow-[0_8px_30px_rgba(0,0,0,0.4)]',
            'overflow-hidden'
          )}
        >
          <div className="px-3 py-2 border-b border-aegis-border">
            <span className="text-[10px] font-bold uppercase tracking-wider text-aegis-text-muted">
              {t('config.recentBackups')}
            </span>
            <p className="mt-1 text-[11px] leading-relaxed text-aegis-text-muted">
              {t('config.restoreBackupHint')}
            </p>
          </div>
          <div className="p-1">
            {(() => {
              const backups = readLocalConfigBackups();
              if (backups.length === 0) {
                return (
                  <div className="px-3 py-4 text-xs text-aegis-text-muted text-center">
                    {t('config.noBackupsYet')}
                  </div>
                );
              }
              return backups.slice().reverse().map((b, i) => {
                let summary: ReturnType<typeof summarizeBackupConfig> | null = null;
                try {
                  summary = summarizeBackupConfig(normalizeConfig(structuredClone(b.data)));
                } catch (err) {
                  debugWarn('app', '[Config] Invalid backup skipped in menu:', err);
                }

                return summary ? (
                  <button
                    key={b.key}
                    onClick={() => handleRestoreBackup(b)}
                    className={clsx(
                      'w-full flex items-start justify-between gap-3 px-3 py-2.5 rounded-lg',
                      'text-left transition-colors duration-150',
                      'hover:bg-white/[0.05]'
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-aegis-text">
                        {new Date(b.ts).toLocaleString()}
                      </div>
                      <div className="text-[10px] text-aegis-text-muted mt-0.5">
                        {i === 0 ? t('config.latestBackup') : t('config.savesAgo', { count: i + 1 })}
                      </div>
                      <div className="mt-1 text-[10px] text-aegis-text-secondary">
                        {t('config.backupSummary', summary)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-aegis-primary shrink-0 pt-0.5">
                      <History size={12} className="shrink-0" />
                      <span>{t('config.restoreToEditor')}</span>
                    </div>
                  </button>
                ) : (
                  <div
                    key={b.key}
                    className="w-full px-3 py-2.5 rounded-lg text-left opacity-60"
                  >
                    <div className="text-xs font-medium text-aegis-text-muted">
                      {new Date(b.ts).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-red-300/80 mt-0.5">
                      {t('config.invalidBackup')}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default ConfigManagerPage;
