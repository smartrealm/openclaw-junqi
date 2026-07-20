// ═══════════════════════════════════════════════════════════
// AgentSettingsPanel — Slide-out configuration panel
// Per-agent: Model selector + session stats
// NOTE: Per-agent params (cacheRetention, temperature, etc.)
// are NOT in the Gateway AgentEntrySchema (.strict()) as of v2026.2.23.
// They live in agents.defaults.models[].params (per-model, not per-agent).
//
// Fix: The `agents.list` API does NOT return `model` or `params`.
// They live only in the config. So we fetch `config.get` on open
// to hydrate the form with real values.
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Save, Loader2,
  Cpu, Check, ChevronDown, Activity, AlertCircle,
  Search, FolderOpen, Clock, Zap, MessageSquare, Puzzle,
} from 'lucide-react';
import { gateway } from '@/services/gateway';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { showAlert, showConfirm } from '@/components/shared/AlertDialog';
import { themeHex, themeAlpha } from '@/utils/theme-colors';
import type { GatewayRuntimeConfig } from '@/pages/ConfigManager/types';
import { getChannelTemplate } from '@/pages/ConfigManager/channelTemplates';
import {
  addChannel,
  addChannelAccount,
  buildChannelGroups,
  persistChannelsOnly,
  updateChannelBinding,
  type ChannelAccountBinding,
  type ChannelGroupView,
} from '@/services/channelConfig';
import type { AgentWorkspaceSkill } from './agentWorkspaceSkills';
import clsx from 'clsx';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface AgentForPanel {
  id: string;
  name?: string;
  model?: string;
  workspace?: string;
  params?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface SessionForPanel {
  key: string;
  label: string;
  model: string;
  totalTokens: number;
  running: boolean;
  updatedAt: number;
}

interface ModelOption {
  id: string;
  alias?: string;
  displayName: string;
}

interface AgentSettingsPanelProps {
  agent: AgentForPanel | null;
  agentSessions: SessionForPanel[];
  agentSkills: AgentWorkspaceSkill[];
  loadingAgentSkills: boolean;
  agentSkillsError: string | null;
  workspaceOpen: boolean;
  onClose: () => void;
  onOpenWorkspace: (agent: AgentForPanel, workspace?: string) => void;
  onRetryAgentSkills: () => void;
  onSaved: (patch?: Partial<AgentForPanel>) => void;
}

// Shape of an agent entry inside config.agents.list
// model can be string ("provider/model") or object ({ primary, fallbacks })
interface ConfigAgent {
  id: string;
  name?: string;
  model?: string | { primary?: string; fallbacks?: string[] };
  workspace?: string;
  params?: {
    cacheRetention?: string;
    temperature?: number;
    maxTokens?: number;
    context1m?: boolean;
  };
  [k: string]: unknown;
}

// Shape of the config.get response
interface ConfigGetResponse {
  baseHash?: string;
  hash?: string;
  config?: {
    agents?: {
      defaults?: {
        model?: string | { primary?: string; fallbacks?: string[] };
        workspace?: string;
      };
      list?: ConfigAgent[];
    };
    [k: string]: unknown;
  };
}

type ChannelGroupForPanel = ChannelGroupView & { name: string };

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

/** Flexible model ID matching — handles provider/model vs bare model */
function modelsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // Compare just the model name part (after the last /)
  const nameA = a.includes('/') ? a.split('/').pop() : a;
  const nameB = b.includes('/') ? b.split('/').pop() : b;
  return nameA === nameB;
}

/** Parse any shape the models.list API might return */
function parseModelsResponse(res: unknown): ModelOption[] {
  const list: ModelOption[] = [];

  // Format A: { models: { "provider/model": { alias, params } } }
  if (
    res !== null &&
    typeof res === 'object' &&
    'models' in res &&
    res.models !== null &&
    typeof res.models === 'object' &&
    !Array.isArray(res.models)
  ) {
    for (const [id, cfg] of Object.entries(res.models as Record<string, unknown>)) {
      const alias =
        cfg !== null && typeof cfg === 'object' && 'alias' in cfg
          ? (cfg as Record<string, unknown>).alias as string | undefined
          : undefined;
      list.push({ id, alias, displayName: alias ? `${alias} — ${id}` : id });
    }
  }
  // Format B: { models: [{ id, alias }] }
  else if (
    res !== null &&
    typeof res === 'object' &&
    'models' in res &&
    Array.isArray((res as Record<string, unknown>).models)
  ) {
    for (const m of (res as Record<string, unknown>).models as unknown[]) {
      if (m === null || typeof m !== 'object') continue;
      const mObj = m as Record<string, unknown>;
      const id = (mObj.id || mObj.model || '') as string;
      const alias = mObj.alias as string | undefined;
      if (id) list.push({ id, alias, displayName: alias ? `${alias} — ${id}` : id });
    }
  }
  // Format C: raw array
  else if (Array.isArray(res)) {
    for (const m of res as unknown[]) {
      const id = typeof m === 'string' ? m : ((m as Record<string, unknown>)?.id as string || '');
      const alias = typeof m === 'object' && m ? ((m as Record<string, unknown>).alias as string | undefined) : undefined;
      if (id) list.push({ id, alias, displayName: alias ? `${alias} — ${id}` : id });
    }
  }

  return list.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Format a token count to human-readable short form */
function formatTk(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** Format a timestamp to relative time string */
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function channelName(t: ReturnType<typeof useTranslation>['t'], id: string) {
  return t(`config.channel.${id}`, { defaultValue: getChannelTemplate(id)?.id ?? id });
}

function channelBindingKey(groupId: string, account: Pick<ChannelAccountBinding, 'id'>) {
  return `${groupId}:${account.id}`;
}

function nextAgentChannelAccountId(channelId: string, agentId: string, groups: ChannelGroupForPanel[]) {
  const safeAgentId = agentId.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+/, '') || 'agent';
  const used = new Set(groups.find((group) => group.id === channelId)?.accounts.map((account) => account.id) ?? []);
  let id = `${safeAgentId}-${channelId}`;
  let index = 2;
  while (used.has(id)) {
    id = `${safeAgentId}-${channelId}-${index}`;
    index += 1;
  }
  return id;
}

function defaultAgentImAccountConfig(channelId: string, agent: AgentForPanel): Record<string, unknown> {
  const label = agent.name || agent.id;
  const base: Record<string, unknown> = {
    enabled: true,
    agentId: agent.id,
    name: `${label} ${channelId}`,
  };
  if (channelId === 'dingtalk') {
    return {
      ...base,
      useStream: true,
      callbackUrl: '',
    };
  }
  if (channelId === 'feishu') {
    return {
      ...base,
      domain: 'feishu',
      typingIndicator: true,
      resolveSenderNames: true,
    };
  }
  return base;
}

// ═══════════════════════════════════════════════════════════
// Main Panel Component
// ═══════════════════════════════════════════════════════════

export function AgentSettingsPanel({
  agent,
  agentSessions,
  agentSkills,
  loadingAgentSkills,
  agentSkillsError,
  workspaceOpen,
  onClose,
  onOpenWorkspace,
  onRetryAgentSkills,
  onSaved,
}: AgentSettingsPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // ── Remote data ──
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // ── Config-fetch state ──
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // ── Save state ──
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // ── Channel binding state ──
  const [channelConfigPath, setChannelConfigPath] = useState('');
  const [channelConfig, setChannelConfig] = useState<GatewayRuntimeConfig | null>(null);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [savingChannelKey, setSavingChannelKey] = useState<string | null>(null);
  const [creatingImChannel, setCreatingImChannel] = useState<string | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);

  // ── Dropdown ──
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  // ── Model search filter (UI state only — does not affect logic) ──
  const [modelSearch, setModelSearch] = useState('');

  // ── Form values ──
  const [agentName, setAgentName] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [modelInherited, setModelInherited] = useState(false);
  const [channelsExpanded, setChannelsExpanded] = useState(false);

  // ── Original values (from config.get) — used for hasChanges ──
  const [origName, setOrigName] = useState('');
  const [origWorkspace, setOrigWorkspace] = useState('');
  const [origModel, setOrigModel] = useState('');

  // Track which agent we last initialized for — prevents polling
  // refreshes from overwriting unsaved user edits.
  const [initializedForId, setInitializedForId] = useState<string | null>(null);

  const loadChannelConfig = useCallback(async () => {
    if (!agent) {
      setChannelConfigPath('');
      setChannelConfig(null);
      setChannelError(null);
      return;
    }

    setLoadingChannels(true);
    setChannelError(null);
    try {
      const detected = await window.aegis.config.detect();
      setChannelConfigPath(detected.path);
      if (!detected.exists) {
        setChannelConfig(null);
        setChannelError(t('channelsCenter.configMissing', 'OpenClaw config file was not found.'));
        return;
      }
      const { data } = await window.aegis.config.read(detected.path);
      setChannelConfig(data as GatewayRuntimeConfig);
    } catch (err) {
      setChannelError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingChannels(false);
    }
  }, [agent?.id, t]);

  useEffect(() => {
    void loadChannelConfig();
  }, [loadChannelConfig]);

  useEffect(() => {
    const handler = () => { void loadChannelConfig(); };
    window.addEventListener('aegis:config-saved', handler);
    return () => window.removeEventListener('aegis:config-saved', handler);
  }, [loadChannelConfig]);

  // ── Fetch config on open (or when agent changes) ──
  useEffect(() => {
    const currentAgent = agentRef.current;
    if (!currentAgent) {
      setInitializedForId(null);
      return;
    }

    // Skip if already initialized for this exact agent
    if (currentAgent.id === initializedForId) return;

    let cancelled = false;
    setLoadingConfig(true);
    setConfigError(null);
    setModelDropdownOpen(false);
    setChannelsExpanded(false);
    setSaved(false);

    gateway.call('config.get', {})
      .then((res: unknown) => {
        if (cancelled) return;

        const snap = res as ConfigGetResponse;

        // Find this agent's entry in config.agents.list
        const agentConfig = snap?.config?.agents?.list?.find(
          (a: ConfigAgent) => a.id === currentAgent.id
        );

        // Resolve model: config first, then agentSessions fallback
        // Model can be string ("provider/model") or object ({ primary, fallbacks })
        const rawModel = agentConfig?.model;
        const cfgModel = typeof rawModel === 'string'
          ? rawModel
          : (rawModel && typeof rawModel === 'object' && 'primary' in rawModel)
            ? String((rawModel as Record<string, unknown>).primary ?? '')
            : '';
        const rawDefaultModel = snap?.config?.agents?.defaults?.model;
        const defaultModel = typeof rawDefaultModel === 'string'
          ? rawDefaultModel
          : (rawDefaultModel && typeof rawDefaultModel === 'object' && 'primary' in rawDefaultModel)
            ? String((rawDefaultModel as Record<string, unknown>).primary ?? '')
            : '';
        const currentAgentSessions = agentSessionsRef.current;
        const sessionModel = currentAgentSessions.length > 0 ? currentAgentSessions[0].model : '';
        const resolvedModel = cfgModel || defaultModel || sessionModel || '';
        const resolvedName = agentConfig?.name ?? currentAgent.name ?? '';
        const resolvedWorkspace = agentConfig?.workspace ?? currentAgent.workspace ?? '';

        setAgentName(resolvedName);
        setOrigName(resolvedName);
        setWorkspace(resolvedWorkspace);
        setOrigWorkspace(resolvedWorkspace);
        setSelectedModel(resolvedModel);
        setOrigModel(resolvedModel);
        setModelInherited(!cfgModel && !!defaultModel);
        setInitializedForId(currentAgent.id);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setConfigError(msg || tRef.current('agentSettings.failedToLoadConfig', 'Failed to load config'));
      })
      .finally(() => {
        if (!cancelled) setLoadingConfig(false);
      });

    return () => { cancelled = true; };
  }, [agent?.id, initializedForId]); // Only re-run when the agent ID changes or initialization state resets

  // ── Fetch available models when panel opens ──
  useEffect(() => {
    if (!agentRef.current) return;
    let cancelled = false;
    setLoadingModels(true);

    gateway.getAvailableModels()
      .then((res: unknown) => {
        if (cancelled) return;
        const parsed = parseModelsResponse(res);

        // If current model isn't in the list, prepend it so it shows in the dropdown
        const currentSelectedModel = selectedModelRef.current;
        if (currentSelectedModel && !parsed.find(m => modelsMatch(m.id, currentSelectedModel))) {
          parsed.unshift({
            id: currentSelectedModel,
            alias: undefined,
            displayName: `${currentSelectedModel.split('/').pop()} — ${currentSelectedModel} (current)`,
          });
        }

        setModels(parsed);
      })
      .catch(() => { if (!cancelled) setModels([]); })
      .finally(() => { if (!cancelled) setLoadingModels(false); });

    return () => { cancelled = true; };
  }, [agent?.id]);

  // ── hasChanges: disable Save button when nothing is different ──
  const trimmedAgentName = agentName.trim();
  const trimmedWorkspace = workspace.trim();
  const nameChanged = trimmedAgentName !== origName;
  const workspaceChanged = trimmedWorkspace !== origWorkspace;
  const modelChanged = !modelsMatch(selectedModel, origModel);
  const agentRef = useRef(agent);
  const agentSessionsRef = useRef(agentSessions);
  const selectedModelRef = useRef(selectedModel);
  const tRef = useRef(t);
  agentRef.current = agent;
  agentSessionsRef.current = agentSessions;
  selectedModelRef.current = selectedModel;
  tRef.current = t;
  const hasChanges = nameChanged || workspaceChanged || modelChanged;
  const canSave = hasChanges && !!trimmedAgentName && !saving && !loadingConfig && !configError;

  // ── Save handler ──
  // Send only fields accepted by the official agents.update RPC.
  // Per-agent params (cacheRetention, temperature, etc.) are NOT supported
  // in agents.list[] schema (.strict()), so they never enter this patch.
  const handleSave = useCallback(async () => {
    if (!agent) return;
    setSaving(true);
    try {
      const patch: Partial<AgentForPanel> = {};
      if (nameChanged) patch.name = trimmedAgentName;
      if (workspaceChanged) patch.workspace = trimmedWorkspace;
      if (selectedModel && modelChanged) patch.model = selectedModel;

      if (Object.keys(patch).length > 0) {
        // agents.update persists to config file (writeConfigFile) AND updates runtime
        // No need for config.get/config.set — agents.update handles everything
        await gateway.updateAgent(agent.id, patch);

        // Update local store so agent cards reflect the new model immediately
        const store = useGatewayDataStore.getState();
        store.setAgents(
          store.agents.map(a =>
            a.id === agent.id ? { ...a, ...patch } : a
          )
        );
      }

      setOrigName(trimmedAgentName);
      setOrigWorkspace(trimmedWorkspace);
      setOrigModel(selectedModel);
      if (patch.model) setModelInherited(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      setInitializedForId(null);
      onSaved(patch);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showAlert(t('agentSettings.saveFailed', '保存失败'), msg, 'error');
    } finally {
      setSaving(false);
    }
  }, [agent, selectedModel, onSaved, t, nameChanged, workspaceChanged, modelChanged, trimmedAgentName, trimmedWorkspace]);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (hasChanges) {
      showConfirm(
        t('agentSettings.unsavedTitle', 'Unsaved changes'),
        t('agentSettings.unsavedMessage', 'Close without saving your changes?'),
        onClose
      );
      return;
    }
    onClose();
  }, [saving, hasChanges, onClose, t]);

  // ── Escape key closes the panel ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [requestClose]);

  // ── Close model dropdown on outside click ──
  useEffect(() => {
    if (!modelDropdownOpen) return;
    // Delay by one tick to avoid closing on the same click that opened it
    const handler = () => setModelDropdownOpen(false);
    const timer = setTimeout(() => window.addEventListener('click', handler), 0);
    return () => { clearTimeout(timer); window.removeEventListener('click', handler); };
  }, [modelDropdownOpen]);

  // ── Session stats ──
  // Merge live sessions (from sessions.list) with historical usage data.
  // sessions.list only returns ACTIVE sessions — archived sub-agent sessions
  // (where sessions.json is {}) won't appear. sessionsUsage scans transcript
  // files and includes historical data, so we use it as a fallback.
  const sessionsUsage = useGatewayDataStore((s) => s.sessionsUsage);
  const runningSubAgents = useGatewayDataStore((s) => s.runningSubAgents);

  // Extract historical sessions for this agent from usage data
  const usageSessions = useMemo(() => {
    if (!agent || !sessionsUsage?.sessions) return [];
    const agentId = agent.id;
    return (sessionsUsage.sessions as any[]).filter((s: any) => {
      // Match by agentId field (if present) or by key pattern
      if (s.agentId === agentId) return true;
      const key = s.key || '';
      return key.startsWith(`agent:${agentId}:`);
    }).map((s: any) => ({
      key: s.key || s.sessionId || '',
      label: s.label || s.displayName || s.key || '',
      model: s.model || '',
      totalTokens: s.usage?.totalTokens ?? s.totalTokens ?? 0,
      running: false, // usage data is historical — never "running"
      updatedAt: s.updatedAt || s.usage?.lastActivity || 0,
    }));
  }, [agent, sessionsUsage]);

  // Merge: live sessions take priority (by key), usage sessions fill the gaps
  const mergedSessions = useMemo(() => {
    const liveKeys = new Set(agentSessions.map(s => s.key));
    const fromUsage = usageSessions.filter(s => !liveKeys.has(s.key));
    return [...agentSessions, ...fromUsage];
  }, [agentSessions, usageSessions]);

  // Check for spawned sub-agents (real-time tool stream tracking)
  const isSpawned = runningSubAgents.some(sa => sa.agentId === agent?.id);

  const activeSessions = agentSessions.filter(s => s.running).length + (isSpawned ? 1 : 0);
  const totalTokens = mergedSessions.reduce((sum, s) => sum + s.totalTokens, 0);
  const totalSessionCount = mergedSessions.length;

  // Latest session by updatedAt — used for "last activity"
  const latestSession = mergedSessions.length > 0
    ? mergedSessions.reduce((latest, s) => s.updatedAt > latest.updatedAt ? s : latest)
    : null;

  // Filtered models list based on search input
  const filteredModels = modelSearch.trim()
    ? models.filter(m => {
        const q = modelSearch.toLowerCase();
        return (
          m.id.toLowerCase().includes(q) ||
          (m.alias?.toLowerCase().includes(q) ?? false)
        );
      })
    : models;

  const channelGroups = useMemo<ChannelGroupForPanel[]>(
    () => buildChannelGroups(channelConfig).map((group) => ({ ...group, name: channelName(t, group.id) })),
    [channelConfig, t]
  );

  const boundChannelCount = useMemo(() => {
    if (!agent) return 0;
    return channelGroups.reduce(
      (sum, group) => sum + group.accounts.filter((account) => account.agentId === agent.id).length,
      0
    );
  }, [agent, channelGroups]);

  const handleChannelBinding = useCallback(async (
    group: ChannelGroupForPanel,
    account: ChannelAccountBinding,
    nextAgentId: string,
  ) => {
    if (!agent || !channelConfig || !channelConfigPath) return;
    const key = channelBindingKey(group.id, account);
    setSavingChannelKey(key);
    setChannelError(null);
    try {
      const next = updateChannelBinding(channelConfig, group.id, account, nextAgentId);
      const merged = await persistChannelsOnly(channelConfigPath, next);
      setChannelConfig(merged);
      const restart = await window.aegis.config.restart().catch((err: unknown) => ({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }));
      if (!restart?.success) {
        setChannelError(String(restart?.error ?? t('channelsCenter.savedWithRestartWarning', 'Saved, but Gateway restart failed')));
      }
      window.dispatchEvent(new CustomEvent('aegis:config-saved', { detail: { channelsChanged: true, agentId: agent.id } }));
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setChannelError(msg);
      showAlert(t('agentSettings.channelSaveFailed', 'Failed to save channel binding'), msg, 'error');
    } finally {
      setSavingChannelKey(null);
    }
  }, [agent, channelConfig, channelConfigPath, onSaved, t]);

  const handleCreateAgentImAccount = useCallback(async (channelId: 'feishu' | 'dingtalk') => {
    if (!agent || !channelConfig || !channelConfigPath || creatingImChannel) return;
    setCreatingImChannel(channelId);
    setChannelError(null);
    try {
      const withChannel = channelConfig.channels?.[channelId]
        ? channelConfig
        : addChannel(channelConfig, channelId);
      const accountId = nextAgentChannelAccountId(channelId, agent.id, channelGroups);
      const next = addChannelAccount(
        withChannel,
        channelId,
        accountId,
        defaultAgentImAccountConfig(channelId, agent),
      );
      const merged = await persistChannelsOnly(channelConfigPath, next);
      setChannelConfig(merged);
      const restart = await window.aegis.config.restart().catch((err: unknown) => ({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }));
      if (!restart?.success) {
        setChannelError(String(restart?.error ?? t('channelsCenter.savedWithRestartWarning', 'Saved, but Gateway restart failed')));
      }
      window.dispatchEvent(new CustomEvent('aegis:config-saved', { detail: { channelsChanged: true, agentId: agent.id } }));
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      onSaved();
      showAlert(
        t('agentSettings.imAccountCreatedTitle', 'IM account created'),
        t('agentSettings.imAccountCreatedMessage', 'The account is bound to this agent. Add credentials in Channel Center to activate it.'),
        'success'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setChannelError(msg);
      showAlert(t('agentSettings.channelSaveFailed', 'Failed to save channel binding'), msg, 'error');
    } finally {
      setCreatingImChannel(null);
    }
  }, [agent, channelConfig, channelConfigPath, channelGroups, creatingImChannel, onSaved, t]);

  if (!agent) return null;

  const primaryColor = themeHex('primary');
  const successColor = themeHex('success');

  // Short model name shown in header chip (just the part after last /)
  const currentModelShort = (selectedModel || origModel).split('/').pop() ?? '';
  const currentProvider = (selectedModel || origModel).includes('/')
    ? (selectedModel || origModel).split('/')[0]
    : '';

  return (
    <AnimatePresence>
      {agent && (
        <>
          {/* ── Backdrop ── */}
          {!workspaceOpen && (
            <motion.div
              key="settings-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed top-[56px] end-0 bottom-0 start-0 bg-black/40 backdrop-blur-sm z-[2147481000]"
              onClick={requestClose}
            />
          )}

          {/* ── Panel (340px — compact and clean) ── */}
          <motion.div
            key="settings-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed top-[56px] end-0 bottom-0 w-[340px] max-w-[92vw] z-[2147481001] flex flex-col bg-aegis-bg border-s border-aegis-border shadow-2xl"
          >

            {/* ═══ Header ═══ */}
            <div
              className="shrink-0 px-5 pt-4 pb-4"
              style={{ borderBottom: `1px solid ${themeAlpha('border', 0.6)}` }}
            >
              {/* Top row: name + close */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-extrabold text-aegis-text leading-tight truncate">
                    {agent.name || agent.id}
                  </h2>
                  <p className="text-[9px] text-aegis-text-dim font-mono mt-0.5 truncate">
                    {agent.id}
                  </p>
                </div>
                <button
                  onClick={requestClose}
                  className="shrink-0 p-1.5 rounded-lg text-aegis-text-dim hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.08)] transition-colors mt-0.5"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Current model chip */}
              {(currentModelShort || loadingConfig) && (
                <div className="flex items-center gap-1.5">
                  <Cpu size={10} style={{ color: primaryColor }} className="shrink-0" />
                  {loadingConfig
                    ? (
                      <div
                        className="h-4 w-24 rounded animate-pulse"
                        style={{ background: themeAlpha('overlay', 0.1) }}
                      />
                    )
                    : (
                      <div className="flex items-center gap-1 min-w-0">
                              <span
                                className="text-[10px] font-bold truncate"
                                style={{ color: primaryColor }}
                              >
                                {currentModelShort}
                              </span>
                              {modelInherited && (
                                <span
                                  className="text-[8px] text-aegis-text-dim shrink-0 px-1.5 py-0.5 rounded"
                                  style={{ background: themeAlpha('overlay', 0.07) }}
                                >
                                  {t('agentHub.inherited', 'Inherited')}
                                </span>
                              )}
                              {currentProvider && (
                          <span
                            className="text-[9px] text-aegis-text-dim truncate shrink-0 px-1.5 py-0.5 rounded"
                            style={{ background: themeAlpha('overlay', 0.07) }}
                          >
                            {currentProvider}
                          </span>
                        )}
                      </div>
                    )
                  }
                </div>
              )}
            </div>

            {/* ═══ Scrollable Body ═══ */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">

              {/* ── Loading: fetching config ── */}
              {loadingConfig && (
                <div className="flex flex-col items-center justify-center gap-2.5 py-12 text-aegis-text-dim">
                  <Loader2 size={24} className="animate-spin" style={{ color: primaryColor }} />
                  <span className="text-[11px]">{t('agentSettings.loadingConfig', 'Loading agent config…')}</span>
                </div>
              )}

              {/* ── Error: config.get failed ── */}
              {!loadingConfig && configError && (
                <div
                  className="rounded-xl border px-4 py-3 flex items-start gap-2.5"
                  style={{
                    background: themeAlpha('danger', 0.07),
                    borderColor: themeAlpha('danger', 0.25),
                  }}
                >
                  <AlertCircle
                    size={14}
                    className="shrink-0 mt-0.5"
                    style={{ color: themeHex('danger') }}
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold" style={{ color: themeHex('danger') }}>
                      {t('agentSettings.failedToLoadConfig', 'Failed to load config')}
                    </p>
                    <p className="text-[9px] text-aegis-text-dim mt-0.5 font-mono break-all">
                      {configError}
                    </p>
                    <button
                      className="mt-1.5 text-[10px] font-bold underline"
                      style={{ color: themeHex('danger') }}
                      onClick={() => setInitializedForId(null)}
                    >
                      {t('common.retry', 'Retry')}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Main form (shown once config is loaded) ── */}
              {!loadingConfig && !configError && (
                <>
                  {/* ── Section: Identity ── */}
                  <div>
                    <label className="flex items-center gap-1.5 text-[9px] text-aegis-text-muted uppercase tracking-widest font-bold mb-2">
                      <Activity size={10} />
                      {t('agentSettings.identity', 'Identity')}
                    </label>
                    <div className="space-y-2.5">
                      <div>
                        <div className="text-[9px] text-aegis-text-dim mb-1">
                          {t('agentSettings.name', 'Name')}
                        </div>
                        <input
                          value={agentName}
                          onChange={(e) => setAgentName(e.target.value)}
                          placeholder={agent.id}
                          className="w-full rounded-xl px-3.5 py-2.5 text-[12px] bg-[rgb(var(--aegis-overlay)/0.04)] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text placeholder:text-aegis-text-dim focus:outline-none focus:border-aegis-primary/40"
                        />
                        {!trimmedAgentName && (
                          <div className="mt-1 text-[9px]" style={{ color: themeHex('danger') }}>
                            {t('agentSettings.nameRequired', 'Name is required')}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-[9px] text-aegis-text-dim mb-1">
                          {t('agentSettings.workspace', 'Workspace')}
                        </div>
                        <input
                          value={workspace}
                          onChange={(e) => setWorkspace(e.target.value)}
                          placeholder={t('agentSettings.workspacePlaceholder', 'Use default workspace')}
                          className="w-full rounded-xl px-3.5 py-2.5 text-[11px] font-mono bg-[rgb(var(--aegis-overlay)/0.04)] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text placeholder:text-aegis-text-dim focus:outline-none focus:border-aegis-primary/40"
                        />
                        <button
                          type="button"
                          onClick={() => onOpenWorkspace(agent, trimmedWorkspace || undefined)}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-aegis-border px-2.5 py-1.5 text-[10px] font-bold text-aegis-text-muted hover:border-aegis-primary/35 hover:bg-aegis-primary/10 hover:text-aegis-primary transition-colors"
                        >
                          <FolderOpen size={12} />
                          {t('agentSettings.showWorkspaceFiles', 'Open workspace files')}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ── Section: Model Selector ── */}
                  <div>
                    <label className="flex items-center gap-1.5 text-[9px] text-aegis-text-muted uppercase tracking-widest font-bold mb-2">
                      <Cpu size={10} />
                      {t('agentSettings.model', 'Model')}
                    </label>

                    {/* Trigger button */}
                    <div className="relative" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          setModelDropdownOpen(v => !v);
                          if (!modelDropdownOpen) setModelSearch('');
                        }}
                        className={clsx(
                          'w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-start text-[12px] transition-all',
                          'border focus:outline-none',
                          modelDropdownOpen
                            ? 'border-aegis-primary/40 bg-[rgb(var(--aegis-overlay)/0.06)]'
                            : 'border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.04)] hover:border-aegis-primary/30'
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          {selectedModel ? (
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-aegis-text font-semibold truncate">
                                {selectedModel.split('/').pop()}
                              </span>
                              {selectedModel.includes('/') && (
                                <span
                                  className="text-[9px] text-aegis-text-dim shrink-0 px-1.5 py-0.5 rounded"
                                  style={{ background: themeAlpha('overlay', 0.08) }}
                                >
                                  {selectedModel.split('/')[0]}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-aegis-text-dim">
                              {t('agentSettings.selectModel', 'Select a model...')}
                            </span>
                          )}
                        </div>
                        {loadingModels
                          ? <Loader2 size={13} className="animate-spin text-aegis-text-dim shrink-0 ms-2" />
                          : (
                            <ChevronDown
                              size={13}
                              className={clsx(
                                'text-aegis-text-dim shrink-0 ms-2 transition-transform',
                                modelDropdownOpen && 'rotate-180'
                              )}
                            />
                          )
                        }
                      </button>

                      {/* Dropdown */}
                      <AnimatePresence>
                        {modelDropdownOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: -6, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -6, scale: 0.98 }}
                            transition={{ duration: 0.12 }}
                            className="absolute top-full mt-1.5 inset-x-0 z-20 rounded-xl border border-[rgb(var(--aegis-overlay)/0.12)] bg-aegis-bg shadow-2xl overflow-hidden"
                          >
                            {/* Search input */}
                            <div
                              className="px-3 py-2.5 border-b"
                              style={{ borderColor: themeAlpha('overlay', 0.08) }}
                            >
                              <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 bg-[rgb(var(--aegis-overlay)/0.06)]">
                                <Search size={11} className="text-aegis-text-dim shrink-0" />
                                <input
                                  autoFocus
                                  type="text"
                                  value={modelSearch}
                                  onChange={e => setModelSearch(e.target.value)}
                                  placeholder={t('agentSettings.filterModels', 'Filter models…')}
                                  className="flex-1 bg-transparent text-[11px] text-aegis-text placeholder:text-aegis-text-dim outline-none min-w-0"
                                />
                                {modelSearch && (
                                  <button
                                    onClick={() => setModelSearch('')}
                                    className="text-aegis-text-dim hover:text-aegis-text transition-colors"
                                  >
                                    <X size={10} />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Model list */}
                            <div className="max-h-[200px] overflow-y-auto">
                              {filteredModels.length === 0 && !loadingModels && (
                                <div className="px-4 py-3.5 text-[11px] text-aegis-text-dim text-center">
                                  {modelSearch
                                    ? `No models match "${modelSearch}"`
                                    : t('agentSettings.noModels', 'No models available')}
                                </div>
                              )}
                              {filteredModels.map(m => {
                                const isSelected = modelsMatch(selectedModel, m.id);
                                const modelName = m.id.split('/').pop() ?? m.id;
                                const provider = m.id.includes('/') ? m.id.split('/')[0] : '';
                                return (
                                  <button
                                    key={m.id}
                                    onClick={() => {
                                      setSelectedModel(m.id);
                                      setModelDropdownOpen(false);
                                      setModelSearch('');
                                    }}
                                    className={clsx(
                                      'w-full text-start px-3.5 py-2.5 transition-colors flex items-center gap-2.5',
                                      isSelected
                                        ? 'bg-aegis-accent/10'
                                        : 'hover:bg-[rgb(var(--aegis-overlay)/0.05)]'
                                    )}
                                  >
                                    {/* Selection indicator */}
                                    <div
                                      className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center border transition-colors"
                                      style={{
                                        borderColor: isSelected ? primaryColor : themeAlpha('overlay', 0.2),
                                        background: isSelected ? `${primaryColor}18` : 'transparent',
                                      }}
                                    >
                                      {isSelected && (
                                        <Check size={9} style={{ color: primaryColor }} />
                                      )}
                                    </div>

                                    {/* Model info */}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <span
                                          className={clsx(
                                            'text-[11px] font-semibold truncate',
                                            isSelected ? 'text-aegis-text' : 'text-aegis-text'
                                          )}
                                        >
                                          {modelName}
                                        </span>
                                        {m.alias && (
                                          <span
                                            className="text-[8px] font-bold shrink-0 px-1 py-0.5 rounded"
                                            style={{
                                              color: primaryColor,
                                              background: `${primaryColor}15`,
                                            }}
                                          >
                                            {m.alias}
                                          </span>
                                        )}
                                      </div>
                                      {provider && (
                                        <div className="text-[9px] text-aegis-text-dim mt-0.5 font-mono truncate">
                                          {provider}
                                        </div>
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* ── Section: Agent-owned workspace skills ── */}
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-aegis-text-muted">
                        <Puzzle size={10} />
                        {t('agentSettings.agentSkills', 'Agent Skills')}
                      </div>
                      {!loadingAgentSkills && (
                        <span className="text-[9px] font-bold text-aegis-text-dim">
                          {agentSkills.length}
                        </span>
                      )}
                    </div>
                    <div className="overflow-hidden rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.025)]">
                      {loadingAgentSkills ? (
                        <div className="flex items-center gap-2 px-3.5 py-3 text-[11px] text-aegis-text-dim">
                          <Loader2 size={13} className="animate-spin" style={{ color: primaryColor }} />
                          {t('agentSettings.loadingAgentSkills', 'Loading agent skills…')}
                        </div>
                      ) : agentSkillsError ? (
                        <div className="flex items-start gap-2.5 px-3.5 py-3">
                          <AlertCircle size={13} className="mt-0.5 shrink-0 text-aegis-danger" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-bold text-aegis-danger">
                              {t('agentSettings.agentSkillsLoadFailed', 'Failed to load agent skills')}
                            </p>
                            <p className="mt-0.5 break-words text-[9px] text-aegis-text-dim">{agentSkillsError}</p>
                            <button
                              type="button"
                              onClick={onRetryAgentSkills}
                              className="mt-1.5 text-[10px] font-bold text-aegis-primary hover:underline"
                            >
                              {t('common.retry', 'Retry')}
                            </button>
                          </div>
                        </div>
                      ) : agentSkills.length > 0 ? (
                        <div className="divide-y divide-[rgb(var(--aegis-overlay)/0.06)]">
                          {agentSkills.map((skill) => (
                            <div key={skill.name} className="flex items-start gap-2.5 px-3.5 py-2.5">
                              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-aegis-primary/10 text-aegis-primary">
                                <Puzzle size={11} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-[11px] font-bold text-aegis-text">{skill.name}</span>
                                  {(!skill.eligible || skill.disabled) && (
                                    <span className="shrink-0 rounded bg-[rgb(var(--aegis-overlay)/0.06)] px-1.5 py-0.5 text-[8px] font-bold text-aegis-text-dim">
                                      {t('agentSettings.skillUnavailable', 'Unavailable')}
                                    </span>
                                  )}
                                </div>
                                {skill.description && (
                                  <p className="mt-0.5 line-clamp-2 text-[9px] leading-relaxed text-aegis-text-dim">
                                    {skill.description}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="px-3.5 py-3 text-[10px] leading-relaxed text-aegis-text-dim">
                          {t('agentSettings.noAgentSkills', 'No skills are installed in this agent workspace.')}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Section: Channel Bindings ── */}
                  <div>
                    <button
                      type="button"
                      aria-expanded={channelsExpanded}
                      onClick={() => setChannelsExpanded((expanded) => !expanded)}
                      className="mb-2 flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-start transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.035)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary"
                    >
                      <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-aegis-text-muted">
                        <MessageSquare size={10} />
                        {t('agentSettings.channels', 'Channels')}
                      </span>
                      <span className="flex items-center gap-2">
                        {!loadingChannels && channelGroups.length > 0 && (
                          <span
                            className="rounded px-1.5 py-0.5 text-[9px] font-bold"
                            style={{
                              color: boundChannelCount > 0 ? primaryColor : themeAlpha('text-dim', 1),
                              background: boundChannelCount > 0 ? `${primaryColor}14` : themeAlpha('overlay', 0.06),
                            }}
                          >
                            {boundChannelCount} / {channelGroups.reduce((sum, group) => sum + group.accounts.length, 0)}
                          </span>
                        )}
                        <ChevronDown size={13} className={clsx('text-aegis-text-dim transition-transform', channelsExpanded && 'rotate-180')} />
                      </span>
                    </button>

                    {channelsExpanded && <div
                      className="rounded-xl border overflow-hidden"
                      style={{
                        borderColor: themeAlpha('overlay', 0.08),
                        background: themeAlpha('overlay', 0.025),
                      }}
                    >
                      {loadingChannels && (
                        <div className="flex items-center gap-2 px-3.5 py-3 text-[11px] text-aegis-text-dim">
                          <Loader2 size={13} className="animate-spin" style={{ color: primaryColor }} />
                          {t('agentSettings.loadingChannels', 'Loading channel bindings…')}
                        </div>
                      )}

                      {!loadingChannels && channelError && (
                        <div
                          className="flex items-start gap-2 px-3.5 py-3 text-[10px]"
                          style={{ color: themeHex('danger') }}
                        >
                          <AlertCircle size={12} className="shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="font-bold">{t('agentSettings.channelLoadFailed', 'Channel binding unavailable')}</div>
                            <div className="mt-0.5 font-mono break-all text-aegis-text-dim">{channelError}</div>
                          </div>
                        </div>
                      )}

                      {!loadingChannels && !channelError && channelGroups.length === 0 && (
                        <div className="px-3.5 py-3 text-[10px] text-aegis-text-dim leading-relaxed">
                          {t('agentSettings.noChannelsConfigured', 'No channels configured yet. Add channels in Channel Center first.')}
                        </div>
                      )}

                      {!loadingChannels && !channelError && (
                        <div className="border-t border-[rgb(var(--aegis-overlay)/0.06)] px-3.5 py-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[10px] font-extrabold uppercase tracking-wider text-aegis-text-muted">
                                {t('agentSettings.quickBindIm', 'Bind IM channel')}
                              </div>
                              <div className="mt-0.5 text-[9px] text-aegis-text-dim">
                                {t('agentSettings.quickBindImHint', 'Create a Feishu or DingTalk account for this agent, then fill credentials in Channel Center.')}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                navigate(`/channels?agent=${encodeURIComponent(agent.id)}`);
                                onClose();
                              }}
                              className="shrink-0 rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] px-2.5 py-1.5 text-[9px] font-bold text-aegis-text-dim hover:border-aegis-primary/25 hover:text-aegis-primary"
                            >
                              {t('channelsCenter.title', 'Channel Center')}
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {(['feishu', 'dingtalk'] as const).map((channelId) => {
                              const busy = creatingImChannel === channelId;
                              const alreadyBound = channelGroups.some(
                                (group) => group.id === channelId && group.accounts.some((account) => account.agentId === agent.id)
                              );
                              return (
                                <button
                                  key={channelId}
                                  type="button"
                                  disabled={Boolean(creatingImChannel) || Boolean(savingChannelKey) || alreadyBound}
                                  onClick={() => void handleCreateAgentImAccount(channelId)}
                                  className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border border-aegis-primary/20 bg-aegis-primary/10 px-2.5 py-2 text-[10px] font-extrabold text-aegis-primary transition-colors hover:bg-aegis-primary/15 disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                  {busy
                                    ? <Loader2 size={11} className="animate-spin" />
                                    : alreadyBound
                                      ? <Check size={11} />
                                      : <MessageSquare size={11} />}
                                  <span className="truncate">
                                    {alreadyBound
                                      ? t('agentSettings.imAccountAlreadyBound', {
                                          channel: channelName(t, channelId),
                                          defaultValue: `${channelName(t, channelId)} bound`,
                                        })
                                      : t('agentSettings.createImAccount', {
                                          channel: channelName(t, channelId),
                                          defaultValue: `Create ${channelName(t, channelId)}`,
                                        })}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {!loadingChannels && channelGroups.length > 0 && (
                        <div className="max-h-[228px] overflow-y-auto divide-y divide-[rgb(var(--aegis-overlay)/0.06)]">
                          {channelGroups.map((group) => (
                            <div key={group.id} className="px-3.5 py-3">
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-[11px] font-extrabold text-aegis-text truncate">
                                      {group.name}
                                    </span>
                                    {!group.enabled && (
                                      <span className="text-[8px] font-bold text-aegis-text-dim px-1.5 py-0.5 rounded bg-[rgb(var(--aegis-overlay)/0.06)]">
                                        {t('channelsCenter.disabled', 'Disabled')}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[9px] text-aegis-text-dim font-mono truncate">
                                    {group.id}
                                  </div>
                                </div>
                                {group.accounts.some((account) => account.agentId === agent.id) && (
                                  <Check size={13} className="shrink-0" style={{ color: themeHex('success') }} />
                                )}
                              </div>

                              <div className="space-y-1.5">
                                {group.accounts.map((account) => {
                                  const isCurrentAgent = account.agentId === agent.id;
                                  const isTaken = Boolean(account.agentId && !isCurrentAgent);
                                  const key = channelBindingKey(group.id, account);
                                  const busy = savingChannelKey === key;
                                  const actionLabel = isCurrentAgent
                                    ? t('agentSettings.unbindChannel', 'Unbind')
                                    : isTaken
                                      ? t('agentSettings.takeOverChannel', 'Take over')
                                      : t('agentSettings.bindChannel', 'Bind');

                                  return (
                                    <div
                                      key={key}
                                      className={clsx(
                                        'rounded-lg border px-2.5 py-2 transition-colors',
                                        isCurrentAgent
                                          ? 'border-aegis-primary/25 bg-aegis-primary/8'
                                          : 'border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.025)]'
                                      )}
                                    >
                                      <div className="flex items-center gap-2">
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-1.5 min-w-0">
                                            <span className="text-[10px] font-bold text-aegis-text truncate">
                                              {account.label}
                                            </span>
                                            {!account.enabled && (
                                              <span className="text-[8px] text-aegis-text-dim shrink-0">
                                                {t('channelsCenter.accountDisabled', 'Account disabled')}
                                              </span>
                                            )}
                                          </div>
                                          {account.agentId && !isCurrentAgent && (
                                            <div className="mt-0.5 text-[8px] text-aegis-text-dim font-mono truncate">
                                              {t('agentSettings.boundToAgent', 'Bound to')} {account.agentId}
                                            </div>
                                          )}
                                        </div>

                                        <button
                                          type="button"
                                          disabled={Boolean(savingChannelKey)}
                                          onClick={() => {
                                            void handleChannelBinding(group, account, isCurrentAgent ? '' : agent.id);
                                          }}
                                          className={clsx(
                                            'shrink-0 inline-flex items-center justify-center gap-1 rounded-md px-2.5 py-1.5 text-[9px] font-extrabold transition-colors disabled:opacity-45 disabled:cursor-not-allowed',
                                            isCurrentAgent
                                              ? 'text-aegis-text-dim hover:text-aegis-text bg-[rgb(var(--aegis-overlay)/0.06)]'
                                              : 'text-aegis-primary bg-aegis-primary/10 hover:bg-aegis-primary/15'
                                          )}
                                        >
                                          {busy && <Loader2 size={10} className="animate-spin" />}
                                          {actionLabel}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>}
                  </div>

                  {/* ── Section: Agent Info card ── */}
                  <div>
                    <div className="flex items-center gap-1.5 text-[9px] text-aegis-text-muted uppercase tracking-widest font-bold mb-2">
                      <Activity size={10} />
                      {t('agentSettings.stats', 'Session Stats')}
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      {/* Active sessions */}
                      <div
                        className="rounded-xl p-3 border"
                        style={{
                          background: themeAlpha('overlay', 0.03),
                          borderColor: themeAlpha('overlay', 0.08),
                        }}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <Zap size={10} style={{ color: themeHex('success') }} />
                          <span className="text-[8px] text-aegis-text-dim uppercase tracking-wider">
                            {t('agentSettings.activeSessions', 'Active')}
                          </span>
                        </div>
                        <div className="text-[22px] font-extrabold text-aegis-text leading-none">
                          {activeSessions}
                        </div>
                        <div className="text-[9px] text-aegis-text-dim mt-0.5">
                          {t('agentSettings.sessionsTotal', { total: totalSessionCount, defaultValue: 'of {{total}} total' })}
                        </div>
                      </div>

                      {/* Total tokens */}
                      <div
                        className="rounded-xl p-3 border"
                        style={{
                          background: themeAlpha('overlay', 0.03),
                          borderColor: themeAlpha('overlay', 0.08),
                        }}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <Activity size={10} style={{ color: primaryColor }} />
                          <span className="text-[8px] text-aegis-text-dim uppercase tracking-wider">
                            {t('agentSettings.totalTokens', 'Tokens')}
                          </span>
                        </div>
                        <div
                          className="text-[22px] font-extrabold leading-none"
                          style={{ color: primaryColor }}
                        >
                          {formatTk(totalTokens)}
                        </div>
                        <div className="text-[9px] text-aegis-text-dim mt-0.5">
                          {t('agentSettings.allSessions', 'all sessions')}
                        </div>
                      </div>
                    </div>

                    {/* Agent metadata rows */}
                    <div
                      className="rounded-xl border divide-y overflow-hidden"
                      style={{
                        borderColor: themeAlpha('overlay', 0.08),
                        '--tw-divide-opacity': 1,
                      } as CSSProperties & { '--tw-divide-opacity': number }}
                    >
                      {/* Last activity */}
                      {latestSession && (
                        <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-[rgb(var(--aegis-overlay)/0.02)]">
                          <Clock size={11} className="text-aegis-text-dim shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="text-[8px] text-aegis-text-dim uppercase tracking-wider mb-0.5">
                              {t('agentSettings.lastActivity', 'Last Activity')}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <div
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{
                                  background: latestSession.running
                                    ? themeHex('success')
                                    : themeAlpha('overlay', 0.3),
                                }}
                              />
                              <span className="text-[10px] text-aegis-text truncate">
                                {formatRelativeTime(latestSession.updatedAt)}
                              </span>
                              <span className="text-[9px] text-aegis-text-dim truncate">
                                · {latestSession.label}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* No sessions fallback */}
                      {mergedSessions.length === 0 && (
                        <div className="px-3.5 py-3 text-center text-[10px] text-aegis-text-dim bg-[rgb(var(--aegis-overlay)/0.02)]">
                          {t('agentSettings.noSessionsYet', 'No sessions yet')}
                        </div>
                      )}
                    </div>
                  </div>

                </>
              )}
            </div>

            {/* ═══ Footer ═══ */}
            <div
              className="shrink-0 px-5 py-4 flex items-center gap-2.5"
              style={{ borderTop: `1px solid ${themeAlpha('border', 0.6)}` }}
            >
              {/* Cancel — ghost/minimal */}
              <button
                onClick={requestClose}
                className="px-4 py-2 rounded-lg text-[12px] font-medium text-aegis-text-dim hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors"
              >
                {t('common.cancel', 'Cancel')}
              </button>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Save — solid primary */}
              <motion.button
                onClick={handleSave}
                disabled={!canSave}
                whileTap={hasChanges && !saving ? { scale: 0.97 } : undefined}
                className="flex items-center gap-1.5 px-5 py-2 rounded-lg text-[12px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: saved
                    ? `${successColor}22`
                    : hasChanges
                      ? primaryColor
                      : themeAlpha('overlay', 0.08),
                  color: saved
                    ? successColor
                    : hasChanges
                      ? `rgb(var(--aegis-btn-primary-text))`
                      : getComputedStyle(document.documentElement).getPropertyValue('--aegis-text-dim').trim() || '#5a6370',
                  border: `1px solid ${
                    saved
                      ? `${successColor}40`
                      : hasChanges
                        ? `${primaryColor}80`
                        : themeAlpha('overlay', 0.12)
                  }`,
                  boxShadow: hasChanges && !saved && !saving
                    ? `0 2px 12px ${primaryColor}30`
                    : 'none',
                }}
              >
                {saving
                  ? <Loader2 size={12} className="animate-spin" />
                  : saved
                    ? <Check size={12} />
                    : <Save size={12} />
                }
                {saving
                  ? t('agentSettings.saving', 'Saving...')
                  : saved
                    ? t('agentSettings.saved', 'Saved!')
                    : t('settings.save', 'Save')}
              </motion.button>
            </div>

          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
