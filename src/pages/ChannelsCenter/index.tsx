import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, AlertCircle, Bot, Check, ChevronDown, Copy, Download, Link2, ListFilter, Loader2, LogOut, MessageSquare, Pencil, Play, Plus, Power, QrCode, RefreshCw, Save, Settings2, ShieldCheck, Square, TerminalSquare, Trash2, Wifi, WifiOff, X } from 'lucide-react';
import clsx from 'clsx';
import { PageTransition } from '@/components/shared/PageTransition';
import { showAlert, showConfirm } from '@/components/shared/AlertDialog';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import { gateway } from '@/services/gateway';
import type { LogEntry } from '@/api/tauri-commands';
import type { AgentConfig, GatewayRuntimeConfig } from '@/pages/ConfigManager/types';
import { getChannelTemplate } from '@/pages/ConfigManager/channelTemplates';
import { ChannelOfficialSchemaEditor } from '@/pages/ConfigManager/ChannelOfficialSchemaEditor';
import {
  assessChannelAccountReadiness,
  addChannelAccount,
  buildChannelGroups,
  channelAccountEditorValues,
  persistChannelsOnly,
  removeChannelAccount,
  removeChannel,
  summarizeChannelReadiness,
  updateChannelBinding,
  updateChannelEnabled,
  upsertChannelAccount,
  type ChannelAccountReadiness,
  type ChannelAccountReadinessState,
  type ChannelGroupView,
  type ChannelAccountBinding,
} from '@/services/channelConfig';
import { enqueueTerminalCommand } from '@/services/terminalCommandQueue';
import {
  buildChannelSetupCommand,
  channelAccountStatus,
  channelLinkMode,
  installManagedExternalChannelPlugin,
  loadOfficialChannelCapability,
  loadOfficialChannelCatalog,
  managedExternalChannelPlugin,
  redactChannelSecrets,
  type ChannelsRuntimeSnapshot,
  type OfficialChannelCatalog,
  type OfficialChannelCatalogEntry,
  type OfficialChannelCapability,
} from '@/services/openclawChannelRuntime';
import { ChannelQrLoginDialog } from './ChannelQrLoginDialog';

function channelName(t: ReturnType<typeof useTranslation>['t'], id: string) {
  return t(`config.channel.${id}`, { defaultValue: getChannelTemplate(id)?.id ?? id });
}

function channelIcon(id: string) {
  const label = getChannelTemplate(id)?.icon || id.slice(0, 2).toUpperCase();
  return label;
}

function catalogEntryStateLabel(
  t: ReturnType<typeof useTranslation>['t'],
  catalog: OfficialChannelCatalog,
  entry: OfficialChannelCatalogEntry,
) {
  if (catalog.source === 'offline-fallback') {
    return t('channelsCenter.catalogUnavailable', 'OpenClaw catalog unavailable');
  }
  return `${entry.installed ? t('channelsCenter.installed', 'Installed') : t('channelsCenter.installable', 'Installable')} · ${entry.origin}`;
}

type ChannelGroupWithName = ChannelGroupView & { name: string };
type ReadinessFilter = 'all' | ChannelAccountReadinessState;

interface EditingAccountState {
  mode: 'new' | 'edit';
  group: ChannelGroupWithName;
  account?: ChannelAccountBinding;
  /** Draft channel defaults for a just-installed plugin, not yet persisted. */
  baseConfig?: GatewayRuntimeConfig;
}

interface GatewayUiStatus {
  running: boolean;
  ready: boolean;
  error?: string | null;
}

function nextAccountId(channelId: string, groups: ChannelGroupWithName[]) {
  const used = new Set(groups.find((group) => group.id === channelId)?.accounts.map((account) => account.id) ?? []);
  let index = 1;
  let id = `${channelId}-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${channelId}-${index}`;
  }
  return id;
}

function cleanAccountConfig(values: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) next[key] = trimmed;
      continue;
    }
    if (value !== undefined && value !== null) next[key] = value;
  }
  return next;
}

function readinessTone(readiness: ChannelAccountReadiness, gatewayHealthy: boolean) {
  if (readiness.state === 'ready' && gatewayHealthy) return 'success';
  if (readiness.state === 'ready' && !gatewayHealthy) return 'warning';
  if (readiness.state === 'missing_credentials') return 'danger';
  if (readiness.state === 'unbound') return 'warning';
  return 'muted';
}

function readinessClasses(readiness: ChannelAccountReadiness, gatewayHealthy: boolean) {
  const tone = readinessTone(readiness, gatewayHealthy);
  if (tone === 'success') return 'bg-aegis-success/10 text-aegis-success border-aegis-success/20';
  if (tone === 'danger') return 'bg-aegis-danger/10 text-aegis-danger border-aegis-danger/20';
  if (tone === 'warning') return 'bg-aegis-warning/10 text-aegis-warning border-aegis-warning/20';
  return 'bg-[rgb(var(--aegis-overlay)/0.04)] text-aegis-text-dim border-[rgb(var(--aegis-overlay)/0.08)]';
}

function officialAccountReadiness(
  channelId: string,
  account: ChannelAccountBinding,
  snapshot: ChannelsRuntimeSnapshot | null,
): ChannelAccountReadiness {
  const runtime = channelAccountStatus(snapshot, channelId, account.id);
  return assessChannelAccountReadiness(channelId, account, runtime);
}

function textValue(config: Record<string, unknown>, key: string, fallback = '') {
  const value = config[key];
  return typeof value === 'string' ? value : fallback;
}

function boolValue(config: Record<string, unknown>, key: string, fallback: boolean) {
  const value = config[key];
  return typeof value === 'boolean' ? value : fallback;
}

interface ChannelAccountModalProps {
  state: EditingAccountState;
  agents: AgentConfig[];
  saving: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  onClose: () => void;
  onSave: (accountId: string, accountConfig: Record<string, unknown>) => void;
  onDelete: (account: ChannelAccountBinding) => void;
}

function ChannelAccountModal({ state, agents, saving, t, onClose, onSave, onDelete }: ChannelAccountModalProps) {
  const tmpl = getChannelTemplate(state.group.id);
  const [accountId, setAccountId] = useState(state.account?.id ?? nextAccountId(state.group.id, [state.group]));
  const [values, setValues] = useState<Record<string, unknown>>(() => (
    channelAccountEditorValues(state.account, tmpl?.defaultMediaMaxMb ?? 10)
  ));

  const trimmedAccountId = accountId.trim();
  const accountIdValid = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(trimmedAccountId);
  const duplicateAccountId = state.mode === 'new' && state.group.accounts.some((account) => account.id === trimmedAccountId);
  const canSave = accountIdValid && !duplicateAccountId && !saving;

  const setField = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="fixed inset-0 z-[2147482000] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-[620px] max-h-[88vh] overflow-hidden rounded-lg border border-[rgb(var(--aegis-overlay)/0.12)] bg-aegis-bg shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[rgb(var(--aegis-overlay)/0.08)]">
          <div className="min-w-0">
            <h3 className="text-[16px] font-extrabold text-aegis-text">
              {state.mode === 'new'
                ? t('channelsCenter.addAccount', 'Add account')
                : t('channelsCenter.editAccount', 'Edit account')}
            </h3>
            <p className="text-[11px] text-aegis-text-dim mt-0.5">
              {state.group.name} · {state.group.id}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-aegis-text-dim hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.06)]">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[calc(88vh-132px)] px-5 py-4 space-y-5">
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('channelsCenter.accountId', 'Account ID')}>
              <input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                disabled={state.mode === 'edit'}
                aria-invalid={!accountIdValid || duplicateAccountId}
                className={clsx(
                  'w-full rounded-lg border bg-[rgb(var(--aegis-overlay)/0.04)] px-3 py-2 text-[12px] text-aegis-text font-mono focus:outline-none disabled:opacity-60',
                  (!accountIdValid || duplicateAccountId)
                    ? 'border-aegis-danger/45 focus:border-aegis-danger/60'
                    : 'border-[rgb(var(--aegis-overlay)/0.1)] focus:border-aegis-primary/40'
                )}
              />
              {!accountIdValid && state.mode === 'new' && (
                <div className="mt-1 text-[10px] text-aegis-danger">
                  {t('channelsCenter.invalidAccountId', 'Use 2-64 letters, numbers, hyphen, or underscore.')}
                </div>
              )}
              {accountIdValid && duplicateAccountId && (
                <div className="mt-1 text-[10px] text-aegis-danger">
                  {t('channelsCenter.duplicateAccountId', 'This account ID already exists in the selected channel.')}
                </div>
              )}
            </Field>
            <Field label={t('channelsCenter.accountName', 'Display name')}>
              <input
                value={textValue(values, 'name')}
                onChange={(e) => setField('name', e.target.value)}
                placeholder={t('channelsCenter.accountNamePlaceholder', 'Optional display name')}
                className="w-full rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.04)] px-3 py-2 text-[12px] text-aegis-text focus:outline-none focus:border-aegis-primary/40"
              />
            </Field>
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('channelsCenter.accountStatus', 'Status')}>
              <label className="flex items-center justify-between rounded-lg border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.025)] px-3 py-2">
                <span className="text-[12px] text-aegis-text">{t('config.enabled', 'Enabled')}</span>
                <input
                  type="checkbox"
                  checked={boolValue(values, 'enabled', true)}
                  onChange={(e) => setField('enabled', e.target.checked)}
                />
              </label>
            </Field>
            <Field label={t('channelsCenter.boundAgent', 'Bound agent')}>
              <select
                value={textValue(values, 'agentId')}
                onChange={(e) => setField('agentId', e.target.value)}
                className="w-full rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-aegis-bg px-3 py-2 text-[12px] text-aegis-text focus:outline-none focus:border-aegis-primary/40"
              >
                <option value="">{t('channelsCenter.noBinding', 'No bound agent')}</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>
                ))}
              </select>
            </Field>
          </section>

          <section className="space-y-3">
            <ChannelOfficialSchemaEditor
              channelId={state.group.id}
              value={values}
              account={state.account?.source === 'account' || state.mode === 'new'}
              initiallyOpen
              disabled={saving}
              onChange={setValues}
            />
          </section>
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-[rgb(var(--aegis-overlay)/0.08)]">
          {state.mode === 'edit' && state.account?.source === 'account' && (
            <button
              onClick={() => onDelete(state.account!)}
              disabled={saving}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-aegis-danger/25 bg-aegis-danger/10 text-aegis-danger text-[12px] font-bold disabled:opacity-50"
            >
              <Trash2 size={13} />
              {t('common.remove', 'Remove')}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg text-[12px] font-semibold text-aegis-text-dim hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.06)] disabled:opacity-50">
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={() => onSave(trimmedAccountId, cleanAccountConfig(values))}
            disabled={!canSave}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-aegis-primary text-[rgb(var(--aegis-btn-primary-text))] text-[12px] font-extrabold disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {t('settings.save', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold text-aegis-text-dim mb-1.5">{label}</span>
      {children}
    </label>
  );
}

export function ChannelsCenterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusedAgentId = searchParams.get('agent')?.trim() || '';
  const [configPath, setConfigPath] = useState('');
  const [config, setConfig] = useState<GatewayRuntimeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<EditingAccountState | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayUiStatus | null>(null);
  const [gatewayLogs, setGatewayLogs] = useState<LogEntry[]>([]);
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [gatewayActionBusy, setGatewayActionBusy] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>('all');
  const [catalog, setCatalog] = useState<OfficialChannelCatalog>({ source: 'openclaw-cli', entries: [] });
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<ChannelsRuntimeSnapshot | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [accountActionBusy, setAccountActionBusy] = useState('');
  const [channelLogPayloads, setChannelLogPayloads] = useState<Record<string, unknown>>({});
  const [channelLogsBusy, setChannelLogsBusy] = useState('');
  const [pluginInstalling, setPluginInstalling] = useState('');
  const [qrTarget, setQrTarget] = useState<{ channelId: string; accountId: string } | null>(null);
  const [capabilityByChannel, setCapabilityByChannel] = useState<Record<string, OfficialChannelCapability | null>>({});
  const savingRef = useRef(false);
  const gatewayRefreshTimersRef = useRef<number[]>([]);

  const loadGatewaySnapshot = useCallback(async () => {
    setGatewayLoading(true);
    try {
      if (!window.aegis?.gateway) {
        throw new Error('Gateway API unavailable');
      }
      const [status, logs] = await Promise.all([
        window.aegis.gateway.getStatus(),
        window.aegis.gateway.getLogs?.(120) ?? Promise.resolve([]),
      ]);
      setGatewayStatus(status as GatewayUiStatus);
      setGatewayLogs(logs as LogEntry[]);
    } catch (err) {
      setGatewayStatus({ running: false, ready: false, error: err instanceof Error ? err.message : String(err) });
      setGatewayLogs([]);
    } finally {
      setGatewayLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const detected = await window.aegis.config.detect();
      setConfigPath(detected.path);
      if (!detected.exists) {
        setConfig(null);
        setError(t('channelsCenter.configMissing', 'OpenClaw config file was not found.'));
        return;
      }
      const { data } = await window.aegis.config.read(detected.path);
      setConfig(data as GatewayRuntimeConfig);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadOfficialState = useCallback(async (probe = false, channelId?: string) => {
    setRuntimeLoading(true);
    try {
      const [nextCatalog, nextSnapshot] = await Promise.all([
        loadOfficialChannelCatalog(probe),
        gateway.call('channels.status', {
          probe,
          timeoutMs: probe ? 15000 : 8000,
          ...(channelId ? { channel: channelId } : {}),
        }).catch(() => window.aegis.channelRuntime.status(channelId, probe)),
      ]);
      setCatalog(nextCatalog);
      if (channelId) {
        const partial = nextSnapshot as ChannelsRuntimeSnapshot;
        setRuntimeSnapshot((current) => ({
          ...(current ?? {}),
          ...partial,
          channelAccounts: { ...(current?.channelAccounts ?? {}), ...(partial.channelAccounts ?? {}) },
          channels: { ...(current?.channels ?? {}), ...(partial.channels ?? {}) },
        }));
      } else {
        setRuntimeSnapshot(nextSnapshot as ChannelsRuntimeSnapshot);
      }
    } catch (reason: any) {
      setError(reason?.message || String(reason));
    } finally {
      setRuntimeLoading(false);
    }
  }, []);

  const clearGatewayRefreshTimers = useCallback(() => {
    gatewayRefreshTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    gatewayRefreshTimersRef.current = [];
  }, []);

  const scheduleGatewayRefresh = useCallback(() => {
    clearGatewayRefreshTimers();
    [900, 2200, 4200, 7000].forEach((delay) => {
      const timerId = window.setTimeout(() => {
        void loadGatewaySnapshot();
        void load();
        void loadOfficialState(false);
      }, delay);
      gatewayRefreshTimersRef.current.push(timerId);
    });
  }, [clearGatewayRefreshTimers, loadGatewaySnapshot, load, loadOfficialState]);

  useEffect(() => {
    void load();
    void loadGatewaySnapshot();
    void loadOfficialState(false);
    return () => clearGatewayRefreshTimers();
  }, [clearGatewayRefreshTimers, load, loadGatewaySnapshot, loadOfficialState]);

  const officialChannelIds = useMemo(() => new Set(catalog.entries.map((entry) => entry.id)), [catalog]);
  const groups = useMemo(() =>
    buildChannelGroups(config).map((group) => ({
      ...group,
      known: group.known || officialChannelIds.has(group.id),
      name: channelName(t, group.id),
    })),
    [config, officialChannelIds, t]
  );
  const agents = useMemo(() => (config?.agents?.list ?? []) as AgentConfig[], [config]);
  const accountCount = groups.reduce((sum, group) => sum + group.accounts.length, 0);
  const readinessSummary = useMemo(() => {
    const summary = summarizeChannelReadiness([]);
    for (const group of groups) {
      for (const account of group.accounts) {
        summary[officialAccountReadiness(group.id, account, runtimeSnapshot).state] += 1;
      }
    }
    return summary;
  }, [groups, runtimeSnapshot]);
  const focusedAgent = useMemo(() => (
    focusedAgentId ? agents.find((agent) => agent.id === focusedAgentId) : undefined
  ), [agents, focusedAgentId]);

  const filteredGroups = useMemo(() => {
    return groups
      .map((group) => ({
        ...group,
        accounts: group.accounts.filter((account) => {
          const matchesAgent = !focusedAgentId || account.agentId === focusedAgentId || !account.agentId;
          const matchesReadiness = readinessFilter === 'all'
            || officialAccountReadiness(group.id, account, runtimeSnapshot).state === readinessFilter;
          return matchesAgent && matchesReadiness;
        }),
      }))
      .filter((group) => group.accounts.length > 0);
  }, [groups, focusedAgentId, readinessFilter, runtimeSnapshot]);

  useEffect(() => {
    if (!focusedAgentId || filteredGroups.length === 0) return;
    setExpanded((current) => current ?? filteredGroups[0].id);
  }, [focusedAgentId, filteredGroups]);

  const filteredAccountCount = filteredGroups.reduce((sum, group) => sum + group.accounts.length, 0);
  const addableEntries = catalog.entries.filter((entry) => !groups.some((group) => group.id === entry.id));
  const gatewayHealthy = Boolean(gatewayStatus?.running && gatewayStatus?.ready);
  const gatewayStateLabel = gatewayLoading
    ? t('channelsCenter.gatewayChecking', 'Checking Gateway')
    : gatewayHealthy
      ? t('channelsCenter.gatewayHealthy', 'Gateway running')
      : t('channelsCenter.gatewayOffline', 'Gateway offline');
  const latestGatewayLog = gatewayLogs[gatewayLogs.length - 1];

  const saveConfig = async (next: GatewayRuntimeConfig, successMessage: string) => {
    if (savingRef.current) return;
    if (!configPath) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const merged = await persistChannelsOnly(configPath, next);
      setConfig(merged);
      const restart = await window.aegis.config.restart().catch((err: unknown) => ({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }));
      if (!restart?.success) {
        showAlert(t('channelsCenter.savedWithRestartWarning', 'Saved, but Gateway restart failed'), String(restart?.error ?? ''), 'warning');
      } else {
        showAlert(t('common.saved', 'Saved'), successMessage, 'success');
      }
      scheduleGatewayRefresh();
      window.dispatchEvent(new CustomEvent('aegis:config-saved', { detail: { channelsChanged: true } }));
    } catch (err) {
      showAlert(t('config.saveFailed', 'Save failed'), err instanceof Error ? err.message : String(err), 'error');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleToggle = (channelId: string, enabled: boolean) => {
    if (!config) return;
    void saveConfig(updateChannelEnabled(config, channelId, enabled), t('channelsCenter.channelUpdated', 'Channel updated.'));
  };

  const handleBind = (group: ChannelGroupView & { name: string }, account: ChannelAccountBinding, agentId: string) => {
    if (!config) return;
    void saveConfig(updateChannelBinding(config, group.id, account, agentId), t('channelsCenter.bindingUpdated', 'Binding updated.'));
  };

  const openChannelTerminal = (command: string) => {
    enqueueTerminalCommand({ command });
    navigate('/terminal');
  };

  const handleLinkAccount = (
    entry: OfficialChannelCatalogEntry | undefined,
    group: ChannelGroupWithName,
    account: ChannelAccountBinding,
  ) => {
    const mode = channelLinkMode(capabilityByChannel[group.id], entry?.installed === true);
    if (mode === 'embedded_qr') {
      setQrTarget({ channelId: group.id, accountId: account.id });
      return;
    }
    openChannelTerminal(buildChannelSetupCommand(group.id, account.id));
  };

  const handleAccountRuntimeAction = async (
    method: 'channels.start' | 'channels.stop' | 'channels.logout',
    group: ChannelGroupWithName,
    account: ChannelAccountBinding,
  ) => {
    const key = `${method}:${group.id}:${account.id}`;
    if (accountActionBusy) return;
    setAccountActionBusy(key);
    try {
      await gateway.call(method, {
        channel: group.id,
        ...(account.id !== 'default' ? { accountId: account.id } : {}),
      });
      await loadOfficialState(true, group.id);
    } catch (reason: any) {
      showAlert(t('channelsCenter.channelActionFailed', 'Channel action failed'), reason?.message || String(reason), 'error');
    } finally {
      setAccountActionBusy('');
    }
  };

  const handleChannelLogs = async (channelId: string) => {
    if (channelLogsBusy) return;
    if (Object.prototype.hasOwnProperty.call(channelLogPayloads, channelId)) {
      setChannelLogPayloads((current) => {
        const next = { ...current };
        delete next[channelId];
        return next;
      });
      return;
    }
    setChannelLogsBusy(channelId);
    try {
      const payload = await window.aegis.channelRuntime.logs(channelId, 200);
      setChannelLogPayloads((current) => ({ ...current, [channelId]: redactChannelSecrets(payload) }));
    } catch (reason: any) {
      showAlert(t('channelsCenter.logsFailed', 'Unable to load channel logs'), reason?.message || String(reason), 'error');
    } finally {
      setChannelLogsBusy('');
    }
  };

  const handleGatewayRestart = async () => {
    if (gatewayActionBusy) return;
    setGatewayActionBusy(true);
    try {
      const result = await gatewayManager.restart();
      if (!result?.success) {
        throw new Error(result?.error || 'Gateway restart failed');
      }
      showAlert(t('common.saved', 'Saved'), t('channelsCenter.gatewayRestarted', 'Gateway restart triggered.'), 'success');
      scheduleGatewayRefresh();
    } catch (err) {
      showAlert(t('channelsCenter.gatewayRestartFailed', 'Gateway restart failed'), err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setGatewayActionBusy(false);
      void loadGatewaySnapshot();
    }
  };

  const handleCopyDiagnostics = async () => {
    const payload = {
      status: gatewayStatus,
      logs: gatewayLogs,
      officialRuntime: redactChannelSecrets(runtimeSnapshot),
      channels: groups.map((group) => ({
        id: group.id,
        enabled: group.enabled,
        known: group.known,
        accounts: group.accounts.map((account) => ({
          id: account.id,
          enabled: account.enabled,
          source: account.source,
          agentId: account.agentId ?? null,
          readiness: officialAccountReadiness(group.id, account, runtimeSnapshot),
        })),
      })),
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).catch(() => undefined);
    showAlert(t('common.copied', 'Copied'), t('channelsCenter.diagnosticsCopied', 'Diagnostics copied.'), 'success');
  };

  const handleClearGatewayLogs = async () => {
    const ok = await window.aegis?.gateway?.clearLogs?.();
    if (ok) setGatewayLogs([]);
  };

  const handleSaveAccount = async (accountId: string, accountConfig: Record<string, unknown>) => {
    if (!config || !editingAccount) return;
    if (editingAccount.mode === 'new' && editingAccount.group.accounts.some((account) => account.id === accountId)) {
      showAlert(
        t('channelsCenter.duplicateAccountTitle', 'Duplicate account ID'),
        t('channelsCenter.duplicateAccountId', 'This account ID already exists in the selected channel.'),
        'error'
      );
      return;
    }
    const baseConfig = editingAccount.baseConfig ?? config;
    const next = editingAccount.mode === 'new'
      ? addChannelAccount(baseConfig, editingAccount.group.id, accountId, accountConfig)
      : upsertChannelAccount(
        baseConfig,
        editingAccount.group.id,
        editingAccount.account ?? { id: accountId, source: 'account' },
        accountConfig,
      );
    await saveConfig(next, t('channelsCenter.accountSaved', 'Account saved.'));
    setExpanded(editingAccount.group.id);
    setEditingAccount(null);
  };

  const handleDeleteAccount = (group: ChannelGroupWithName, account: ChannelAccountBinding) => {
    if (!config || account.source !== 'account') return;
    showConfirm(
      t('channelsCenter.removeAccountTitle', 'Remove account'),
      t('channelsCenter.removeAccountMessage', { account: account.label, defaultValue: `Remove ${account.label}?` }),
      () => {
        void saveConfig(removeChannelAccount(config, group.id, account.id), t('channelsCenter.accountRemoved', 'Account removed.'));
        setEditingAccount(null);
      }
    );
  };

  const handleRemove = (group: ChannelGroupView & { name: string }) => {
    if (!config) return;
    showConfirm(
      t('channelsCenter.removeTitle', 'Remove channel'),
      t('channelsCenter.removeMessage', { channel: group.name, defaultValue: `Remove ${group.name}?` }),
      () => { void saveConfig(removeChannel(config, group.id), t('channelsCenter.channelRemoved', 'Channel removed.')); }
    );
  };

  const handleAdd = async (entry: OfficialChannelCatalogEntry) => {
    // 已安装渠道不一定要走终端命令——catalog 声明支持扫码绑定时,与
    // handleLinkAccount 一样把首次关联也交给 ChannelQrLoginDialog。未安装
    // 渠道的安装语义由 `openclaw channels add` 承担,终端仍是合适场景。
    if (entry.installed) {
      let capability = capabilityByChannel[entry.id];
      if (capability === undefined) {
        capability = await loadOfficialChannelCapability(entry.id)
          .catch(() => null);
        setCapabilityByChannel((current) => ({ ...current, [entry.id]: capability ?? null }));
      }
      if (channelLinkMode(capability ?? null, true) === 'embedded_qr') {
        const accountId = nextAccountId(entry.id, groups);
        setQrTarget({ channelId: entry.id, accountId });
        return;
      }
    }
    const managedPlugin = managedExternalChannelPlugin(entry.id);
    if (managedPlugin && entry.installed && config) {
      // Keep the draft out of live React state until the user explicitly
      // saves credentials. The schema is read from the installed OpenClaw
      // plugin, so JunQi never invents DingTalk configuration fields.
      const draftConfig: GatewayRuntimeConfig = {
        ...config,
        channels: {
          ...(config.channels ?? {}),
          // The plugin owns all non-universal defaults. In particular, do
          // not carry JunQi's retired DingTalk streaming fields into a live
          // OpenClaw schema.
          [entry.id]: { enabled: true },
        },
      };
      const draftGroup = buildChannelGroups(draftConfig).find((group) => group.id === entry.id);
      if (draftGroup) {
        setEditingAccount({ mode: 'new', group: { ...draftGroup, name: channelName(t, entry.id) }, baseConfig: draftConfig });
        return;
      }
    }
    openChannelTerminal(buildChannelSetupCommand(entry.id));
  };

  const handleInstallManagedPlugin = async (channelId: string) => {
    const plugin = managedExternalChannelPlugin(channelId);
    const currentEntry = catalog.entries.find((entry) => entry.id === channelId);
    if (!plugin || currentEntry?.installed || pluginInstalling) return;
    setPluginInstalling(channelId);
    try {
      const result = await installManagedExternalChannelPlugin(channelId);
      await Promise.all([load(), loadOfficialState(true)]);
      showAlert(
        t('channelsCenter.pluginInstalled', 'Official plugin installed'),
        t('channelsCenter.pluginInstalledHint', {
          channel: channelName(t, result.channel),
          defaultValue: `${channelName(t, result.channel)} is installed by OpenClaw. Configure its credentials next.`,
        }),
        'success',
      );
    } catch (reason: any) {
      showAlert(
        t('channelsCenter.pluginInstallFailed', 'Plugin installation failed'),
        reason?.message || String(reason),
        'error',
      );
    } finally {
      setPluginInstalling('');
    }
  };

  const handleExpand = (group: ChannelGroupWithName, open: boolean) => {
    setExpanded(open ? null : group.id);
    if (!open && !Object.prototype.hasOwnProperty.call(capabilityByChannel, group.id)) {
      void loadOfficialChannelCapability(group.id)
        .then((capability) => setCapabilityByChannel((current) => ({ ...current, [group.id]: capability })))
        .catch(() => setCapabilityByChannel((current) => ({ ...current, [group.id]: null })));
    }
  };

  return (
    <PageTransition className="p-5 space-y-5 max-w-[1100px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold text-aegis-text">
            {t('sidebar.nav.channels', 'Channels')}
          </h1>
          <p className="text-[12px] text-aegis-text-dim mt-0.5">
            {t('channelsCenter.subtitle', 'Connect agents to Feishu, DingTalk, Telegram, Discord and other message channels.')}
            <span className="ml-2 font-mono text-[10px] text-aegis-text-muted">{catalog.version || catalog.source}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => { void load(); void loadOfficialState(false); }} disabled={loading || saving || runtimeLoading} title={t('common.refresh', 'Refresh')} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-muted hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.05)] disabled:opacity-50">
            <RefreshCw size={15} className={loading || runtimeLoading ? 'animate-spin' : undefined} />
          </button>
          <button onClick={() => setDiagnosticsOpen((open) => !open)} className="inline-flex items-center gap-2 px-3 h-8 rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-muted hover:text-aegis-text text-[11px] font-semibold">
            <TerminalSquare size={14} />
            {t('channelsCenter.diagnostics', 'Diagnostics')}
          </button>
          <button onClick={() => navigate('/config?tab=channels')} className="inline-flex items-center gap-2 px-3 h-8 rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-muted hover:text-aegis-text font-semibold text-[11px]">
            <Settings2 size={15} />
            {t('channelsCenter.advancedConfig', 'Advanced config')}
          </button>
          <button onClick={() => document.getElementById('available-channels')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="inline-flex items-center gap-2 px-3 h-8 rounded-md bg-aegis-primary text-white font-semibold text-[11px] hover:opacity-90">
            <Plus size={14} />
            {t('channelsCenter.addChannels', 'Add channel')}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-aegis-danger/20 bg-aegis-danger/10 px-4 py-3 text-[12px] text-aegis-danger">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24 text-aegis-text-dim">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : (
        <>
          {(!gatewayHealthy || diagnosticsOpen) && <section className={clsx(
            'rounded-md border px-4 py-3',
            gatewayHealthy
              ? 'border-aegis-success/20 bg-aegis-success/5'
              : 'border-aegis-warning/25 bg-aegis-warning/10'
          )}>
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className={clsx(
                  'w-9 h-9 rounded-md flex items-center justify-center shrink-0',
                  gatewayHealthy ? 'bg-aegis-success/12 text-aegis-success' : 'bg-aegis-warning/12 text-aegis-warning'
                )}>
                  {gatewayLoading
                    ? <Loader2 size={18} className="animate-spin" />
                    : gatewayHealthy
                      ? <Wifi size={18} />
                      : <WifiOff size={18} />}
                </div>
                <div className="min-w-0">
                  <div className="text-[14px] font-extrabold text-aegis-text">{gatewayStateLabel}</div>
                  <div className="mt-0.5 text-[11px] text-aegis-text-dim truncate">
                    {gatewayStatus?.error
                      ? gatewayStatus.error
                      : latestGatewayLog
                        ? latestGatewayLog.message
                        : t('channelsCenter.gatewayHint', 'Channel changes require Gateway restart before runtime adapters reconnect.')}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void loadGatewaySnapshot()}
                  disabled={gatewayLoading || gatewayActionBusy}
                  className="inline-flex items-center gap-2 px-3 h-8 rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] text-[11px] font-semibold text-aegis-text-muted hover:text-aegis-text disabled:opacity-50"
                >
                  <RefreshCw size={13} className={gatewayLoading ? 'animate-spin' : undefined} />
                  {t('common.refresh', 'Refresh')}
                </button>
                <button
                  onClick={() => void handleGatewayRestart()}
                  disabled={gatewayActionBusy}
                  className="inline-flex items-center gap-2 px-3 h-8 rounded-md border border-aegis-primary/25 bg-aegis-primary/10 text-[11px] font-semibold text-aegis-primary disabled:opacity-50"
                >
                  {gatewayActionBusy ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
                  {t('channelsCenter.restartGateway', 'Restart Gateway')}
                </button>
                <button
                  onClick={() => void handleCopyDiagnostics()}
                  className="inline-flex items-center gap-2 px-3 h-8 rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] text-[11px] font-semibold text-aegis-text-muted hover:text-aegis-text"
                >
                  <Copy size={13} />
                  {t('channelsCenter.copyDiagnostics', 'Copy diagnostics')}
                </button>
                <button
                  onClick={() => setDiagnosticsOpen((open) => !open)}
                  className="inline-flex items-center gap-2 px-3 h-8 rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] text-[11px] font-semibold text-aegis-text-muted hover:text-aegis-text"
                >
                  <TerminalSquare size={13} />
                  {diagnosticsOpen ? t('channelsCenter.hideLogs', 'Hide logs') : t('channelsCenter.showLogs', 'Show logs')}
                </button>
              </div>
            </div>

            {diagnosticsOpen && (
              <div className="mt-3 rounded-lg border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.035)] overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[rgb(var(--aegis-overlay)/0.08)]">
                  <span className="text-[10px] uppercase tracking-widest font-extrabold text-aegis-text-muted">
                    {t('channelsCenter.gatewayLogs', 'Gateway logs')}
                  </span>
                  <button
                    onClick={() => void handleClearGatewayLogs()}
                    className="text-[10px] font-bold text-aegis-text-dim hover:text-aegis-text"
                  >
                    {t('settings.gatewayLog.clear', 'Clear')}
                  </button>
                </div>
                {gatewayLogs.length === 0 ? (
                  <div className="px-3 py-5 text-center text-[11px] text-aegis-text-dim">
                    {t('settings.gatewayLog.empty', 'No log entries yet. Start the Gateway to see stdout/stderr here.')}
                  </div>
                ) : (
                  <pre className="max-h-[240px] overflow-auto px-3 py-2 text-[10px] leading-relaxed text-aegis-text-dim whitespace-pre-wrap break-all">
                    {gatewayLogs.map((entry) => {
                      const time = new Date(entry.timestamp_ms).toLocaleTimeString();
                      return `[${time}] ${entry.level.toUpperCase()} ${entry.source}: ${entry.message}`;
                    }).join('\n')}
                  </pre>
                )}
              </div>
            )}
          </section>}

          <section className="space-y-3">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                <h2 className="text-[13px] font-semibold text-aegis-text-secondary">
                  {t('channelsCenter.configured', 'Configured channels')}
                </h2>
                <div className="mt-0.5 text-[10px] text-aegis-text-dim">
                  {groups.length} {t('channelsCenter.enabledChannels', 'channels')} · {readinessSummary.ready} / {accountCount} {t('channelsCenter.readyAccounts', 'ready')}
                </div>
                </div>
                {saving && <span className="inline-flex items-center gap-1.5 text-[11px] text-aegis-primary"><Loader2 size={12} className="animate-spin" />{t('agentSettings.saving', 'Saving...')}</span>}
              </div>

              {groups.length > 0 && (
                <div className="flex flex-col gap-2 border-y border-[rgb(var(--aegis-overlay)/0.08)] py-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-aegis-text-dim">
                      <ListFilter size={13} />
                      {t('channelsCenter.filterByStatus', 'Filter by status')}
                      <span className="font-mono text-[10px] text-aegis-text-muted">
                        {filteredAccountCount} / {accountCount}
                      </span>
                    </div>
                    {focusedAgentId && (
                      <div className="flex items-center gap-2 rounded-lg border border-aegis-primary/20 bg-aegis-primary/10 px-2.5 py-1.5">
                        <Bot size={12} className="text-aegis-primary" />
                        <span className="text-[11px] font-bold text-aegis-primary truncate max-w-[220px]">
                          {t('channelsCenter.focusedAgent', 'Focused agent')}: {focusedAgent?.name || focusedAgentId}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const next = new URLSearchParams(searchParams);
                            next.delete('agent');
                            setSearchParams(next, { replace: true });
                          }}
                          className="rounded p-0.5 text-aegis-primary/70 hover:bg-aegis-primary/15 hover:text-aegis-primary"
                          title={t('channelsCenter.clearAgentFocus', 'Clear agent focus')}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {([
                      ['all', t('channelsCenter.filterAll', 'All'), accountCount],
                      ['ready', t('channelsCenter.readiness.ready', 'Ready'), readinessSummary.ready],
                      ['missing_credentials', t('channelsCenter.readiness.missing_credentials', 'Missing credentials'), readinessSummary.missing_credentials],
                      ['unbound', t('channelsCenter.readiness.unbound', 'Unbound'), readinessSummary.unbound],
                      ['disabled', t('channelsCenter.readiness.disabled', 'Disabled'), readinessSummary.disabled],
                    ] as const).map(([key, label, count]) => (
                      <button
                        key={key}
                        onClick={() => setReadinessFilter(key)}
                        className={clsx(
                          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                          readinessFilter === key
                            ? 'bg-aegis-primary/10 text-aegis-primary'
                            : 'text-aegis-text-dim hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]'
                        )}
                      >
                        <span>{label}</span>
                        <span className="rounded bg-[rgb(var(--aegis-overlay)/0.08)] px-1.5 py-0.5 text-[9px]">
                          {count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {groups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[rgb(var(--aegis-overlay)/0.12)] py-14 text-center">
                <MessageSquare size={32} className="mx-auto text-aegis-text-dim opacity-50" />
                <div className="mt-3 text-[14px] font-semibold text-aegis-text">{t('channelsCenter.emptyTitle', 'No channels configured')}</div>
                <div className="mt-1 text-[12px] text-aegis-text-dim">{t('channelsCenter.emptyHint', 'Add a channel below to let agents receive and respond from messaging apps.')}</div>
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[rgb(var(--aegis-overlay)/0.12)] py-10 text-center">
                <ListFilter size={28} className="mx-auto text-aegis-text-dim opacity-50" />
                <div className="mt-3 text-[14px] font-semibold text-aegis-text">{t('channelsCenter.noFilterResults', 'No matching accounts')}</div>
                <div className="mt-1 text-[12px] text-aegis-text-dim">{t('channelsCenter.noFilterResultsHint', 'Change the status filter to view other channel accounts.')}</div>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredGroups.map((group) => {
                  const open = expanded === group.id;
                  const originalAccountCount = groups.find((item) => item.id === group.id)?.accounts.length ?? group.accounts.length;
                  const catalogEntry = catalog.entries.find((entry) => entry.id === group.id);
                  const managedPlugin = managedExternalChannelPlugin(group.id);
                  const pluginMissing = Boolean(
                    managedPlugin
                    && catalog.source === 'openclaw-cli'
                    && catalogEntry?.installed === false,
                  );
                  return (
                    <div key={group.id} className="rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.018)] overflow-hidden">
                      <button onClick={() => handleExpand(group, open)} className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[rgb(var(--aegis-overlay)/0.03)]">
                        <div className="w-8 h-8 rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.04)] flex items-center justify-center text-[10px] font-bold text-aegis-text-muted">
                          {channelIcon(group.id)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[14px] font-bold text-aegis-text">{group.name}</span>
                            {!group.known && <span className="rounded px-1.5 py-0.5 text-[9px] font-bold bg-yellow-500/10 text-yellow-400">{t('config.unknownChannel', 'Unknown')}</span>}
                          </div>
                          <div className="text-[11px] text-aegis-text-dim font-mono">
                            {group.id} · {group.accounts.length}{readinessFilter !== 'all' ? ` / ${originalAccountCount}` : ''} {t('channelsCenter.accountUnit', 'account(s)')}
                          </div>
                        </div>
                        <span className={clsx('inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold', group.enabled ? 'text-aegis-success' : 'text-aegis-text-dim')}>
                          {group.enabled ? <Check size={11} /> : <AlertCircle size={11} />}
                          {group.enabled ? t('config.enabled', 'Enabled') : t('config.disabled', 'Disabled')}
                        </span>
                        <ChevronDown size={15} className={clsx('text-aegis-text-dim transition-transform', open && 'rotate-180')} />
                      </button>

                      {open && (
                        <div className="border-t border-[rgb(var(--aegis-overlay)/0.08)] px-4 py-4 space-y-4">
                          <div className="flex flex-wrap items-center gap-2">
                            {pluginMissing && (
                              <button
                                type="button"
                                onClick={() => void handleInstallManagedPlugin(group.id)}
                                disabled={saving || Boolean(pluginInstalling)}
                                className="inline-flex items-center gap-2 rounded-lg border border-aegis-primary/25 bg-aegis-primary/10 px-3 py-1.5 text-[12px] font-semibold text-aegis-primary disabled:opacity-50"
                              >
                                {pluginInstalling === group.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                                {t('channelsCenter.installOfficialPlugin', 'Install official plugin')}
                              </button>
                            )}
                            <button onClick={() => handleToggle(group.id, !group.enabled)} disabled={saving} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-[12px] font-semibold text-aegis-text-muted hover:text-aegis-text">
                              <ShieldCheck size={13} />
                              {group.enabled ? t('channelsCenter.disable', 'Disable') : t('channelsCenter.enable', 'Enable')}
                            </button>
                            {capabilityByChannel[group.id]?.schema.accounts?.additionalProperties && (
                              <button
                                onClick={() => setEditingAccount({ mode: 'new', group })}
                                disabled={saving}
                                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-aegis-primary/25 bg-aegis-primary/10 text-[12px] font-semibold text-aegis-primary disabled:opacity-50"
                              >
                                <Plus size={13} />
                                {t('channelsCenter.addAccount', 'Add account')}
                              </button>
                            )}
                            <button onClick={() => void loadOfficialState(true, group.id)} disabled={runtimeLoading} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-[12px] font-semibold text-aegis-text-muted hover:text-aegis-text disabled:opacity-50">
                              <Activity size={13} />
                              {t('channelsCenter.probe', 'Probe')}
                            </button>
                            <button onClick={() => void handleChannelLogs(group.id)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-[12px] font-semibold text-aegis-text-muted hover:text-aegis-text">
                              {channelLogsBusy === group.id ? <Loader2 size={13} className="animate-spin" /> : <TerminalSquare size={13} />}
                              {t('channelsCenter.channelLogs', 'Channel logs')}
                            </button>
                            <button onClick={() => navigator.clipboard.writeText(JSON.stringify(redactChannelSecrets(group.config), null, 2)).catch(() => undefined)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-[12px] font-semibold text-aegis-text-muted hover:text-aegis-text">
                              <Copy size={13} />
                              {t('channelsCenter.copyRedacted', 'Copy redacted')}
                            </button>
                            <button onClick={() => handleRemove(group)} disabled={saving} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-aegis-danger/25 bg-aegis-danger/10 text-[12px] font-semibold text-aegis-danger">
                              <Trash2 size={13} />
                              {t('common.remove', 'Remove')}
                            </button>
                          </div>

                          {Object.prototype.hasOwnProperty.call(channelLogPayloads, group.id) && (
                            <pre className="max-h-64 overflow-auto rounded-md border border-aegis-border bg-aegis-bg p-3 text-[10px] leading-relaxed text-aegis-text-muted whitespace-pre-wrap break-all">{JSON.stringify(channelLogPayloads[group.id], null, 2)}</pre>
                          )}

                          <div className="space-y-2">
                            {group.accounts.map((account) => {
                              const runtime = channelAccountStatus(runtimeSnapshot, group.id, account.id);
                              const readiness = officialAccountReadiness(group.id, account, runtimeSnapshot);
                              const readinessLabel = readiness.state === 'ready' && !gatewayHealthy
                                ? t('channelsCenter.waitingGateway', 'Waiting for Gateway')
                                : t(`channelsCenter.readiness.${readiness.state}`, readiness.state);
                              const readinessHint = readiness.state === 'missing_credentials'
                                ? t('channelsCenter.missingFields', { fields: readiness.missingFields.join(', '), defaultValue: `Missing ${readiness.missingFields.join(', ')}` })
                                : readiness.state === 'ready' && !gatewayHealthy
                                  ? t('channelsCenter.gatewayOfflineHint', 'Gateway is offline. Restart or refresh Gateway to activate this account.')
                                  : t(`channelsCenter.readinessHint.${readiness.state}`, '');

                              const catalogEntry = catalog.entries.find((entry) => entry.id === group.id);
                              const linkMode = channelLinkMode(capabilityByChannel[group.id], catalogEntry?.installed === true);
                              const runtimeBusyPrefix = `${group.id}:${account.id}`;

                              return (
                                <div key={account.id} className="rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] bg-aegis-bg px-3 py-2.5">
                                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px] md:items-center">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <MessageSquare size={13} className="text-aegis-text-dim" />
                                      <span className="text-[13px] font-semibold text-aegis-text truncate">{account.label}</span>
                                      <span className="text-[10px] font-mono text-aegis-text-dim">{account.id}</span>
                                      <span className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-extrabold', readinessClasses(readiness, gatewayHealthy))}>
                                        {readiness.state === 'ready' && gatewayHealthy ? <Check size={10} /> : <AlertCircle size={10} />}
                                        {readinessLabel}
                                      </span>
                                    </div>
                                    {readinessHint && (
                                      <div className="mt-1 text-[11px] text-aegis-text-dim">
                                        {readinessHint}
                                      </div>
                                    )}
                                    {runtime && (
                                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-aegis-text-muted">
                                        <span>{t('channelsCenter.configuredState', 'Configured')}: {String(runtime.configured ?? false)}</span>
                                        <span>{t('channelsCenter.linkedState', 'Linked')}: {String(runtime.linked ?? false)}</span>
                                        <span>{t('channelsCenter.runningState', 'Running')}: {String(runtime.running ?? false)}</span>
                                        <span>{t('channelsCenter.connectedState', 'Connected')}: {String(runtime.connected ?? false)}</span>
                                        {runtime.lastError && <span className="basis-full text-aegis-danger">{runtime.lastError}</span>}
                                      </div>
                                    )}
                                  </div>
                                  <select
                                    value={account.agentId ?? ''}
                                    onChange={(e) => handleBind(group, account, e.target.value)}
                                    disabled={saving}
                                    className="w-full rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-aegis-bg px-3 py-2 text-[12px] text-aegis-text focus:outline-none focus:border-aegis-primary/40"
                                  >
                                    <option value="">{t('channelsCenter.noBinding', 'No bound agent')}</option>
                                    {agents.map((agent) => (
                                      <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>
                                    ))}
                                  </select>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-aegis-border pt-2">
                                    {linkMode !== 'none' && (
                                      <button onClick={() => handleLinkAccount(catalogEntry, group, account)} disabled={Boolean(accountActionBusy)} className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-aegis-primary/20 bg-aegis-primary/10 text-aegis-primary text-[11px] font-bold disabled:opacity-50">
                                        {linkMode === 'embedded_qr' ? <QrCode size={12} /> : <Link2 size={12} />}
                                        {linkMode === 'embedded_qr' ? t('channelsCenter.showQr', 'Show QR') : t('channelsCenter.linkAccount', 'Link account')}
                                      </button>
                                    )}
                                    <button onClick={() => void handleAccountRuntimeAction('channels.start', group, account)} disabled={Boolean(accountActionBusy)} title={t('channelsCenter.startAccount', 'Start account')} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-aegis-success/20 text-aegis-success disabled:opacity-50">
                                      {accountActionBusy === `channels.start:${runtimeBusyPrefix}` ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                                    </button>
                                    <button onClick={() => void handleAccountRuntimeAction('channels.stop', group, account)} disabled={Boolean(accountActionBusy)} title={t('channelsCenter.stopAccount', 'Stop account')} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-aegis-border text-aegis-text-muted disabled:opacity-50">
                                      {accountActionBusy === `channels.stop:${runtimeBusyPrefix}` ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
                                    </button>
                                    {(runtime?.linked || linkMode !== 'none') && (
                                      <button onClick={() => void handleAccountRuntimeAction('channels.logout', group, account)} disabled={Boolean(accountActionBusy)} title={t('channelsCenter.logoutAccount', 'Log out account')} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-aegis-warning/20 text-aegis-warning disabled:opacity-50">
                                        {accountActionBusy === `channels.logout:${runtimeBusyPrefix}` ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                                      </button>
                                    )}
                                    <button
                                      onClick={() => setEditingAccount({ mode: 'edit', group, account })}
                                      disabled={saving}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-aegis-primary/20 bg-aegis-primary/10 text-aegis-primary text-[11px] font-bold disabled:opacity-50"
                                    >
                                      <Pencil size={12} />
                                      {t('common.edit', 'Edit')}
                                    </button>
                                    {account.source === 'account' && (
                                      <button
                                        onClick={() => handleDeleteAccount(group, account)}
                                        disabled={saving}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-aegis-danger/20 bg-aegis-danger/10 text-aegis-danger text-[11px] font-bold disabled:opacity-50"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section id="available-channels" className="space-y-3 scroll-mt-4">
            <h2 className="text-[13px] font-semibold text-aegis-text-secondary">
              {t('channelsCenter.addChannels', 'Add channels')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {addableEntries.map((entry) => {
                const managedPlugin = managedExternalChannelPlugin(entry.id);
                const pluginMissing = Boolean(
                  managedPlugin
                  && catalog.source === 'openclaw-cli'
                  && !entry.installed,
                );
                const installBusy = pluginInstalling === entry.id;
                return (
                  <div key={entry.id} className="flex items-center gap-2 rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.018)] p-2">
                    <button
                      type="button"
                      onClick={() => void handleAdd(entry)}
                      disabled={!config || saving || pluginMissing}
                      title={pluginMissing ? t('channelsCenter.installPluginFirst', 'Install the official plugin first') : t('channelsCenter.configureChannel', 'Configure channel')}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded px-1 py-0.5 text-left hover:bg-aegis-primary/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.04)] text-[10px] font-bold text-aegis-text-muted">
                        {channelIcon(entry.id)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-bold text-aegis-text">{channelName(t, entry.id)}</div>
                        <div className="truncate text-[10px] text-aegis-text-dim">
                          {pluginMissing
                            ? `${t('channelsCenter.officialExternalPlugin', 'Official external plugin')} · ${t('channelsCenter.installable', 'Installable')}`
                            : catalogEntryStateLabel(t, catalog, entry)}
                        </div>
                      </div>
                      <Plus size={14} className="shrink-0 text-aegis-primary" />
                    </button>
                    {pluginMissing && (
                      <button
                        type="button"
                        onClick={() => void handleInstallManagedPlugin(entry.id)}
                        disabled={!config || saving || Boolean(pluginInstalling)}
                        title={t('channelsCenter.installOfficialPlugin', 'Install official plugin')}
                        aria-label={t('channelsCenter.installOfficialPlugin', 'Install official plugin')}
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-aegis-primary/25 bg-aegis-primary/10 px-2 text-[11px] font-semibold text-aegis-primary transition-colors hover:bg-aegis-primary/16 disabled:cursor-wait disabled:opacity-50"
                      >
                        {installBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                        {t('channelsCenter.installOfficialPlugin', 'Install official plugin')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

        </>
      )}
      {editingAccount && (
        <ChannelAccountModal
          key={`${editingAccount.mode}:${editingAccount.group.id}:${editingAccount.account?.id ?? 'new'}`}
          state={editingAccount}
          agents={agents}
          saving={saving}
          t={t}
          onClose={() => setEditingAccount(null)}
          onSave={(accountId, accountConfig) => { void handleSaveAccount(accountId, accountConfig); }}
          onDelete={(account) => handleDeleteAccount(editingAccount.group, account)}
        />
      )}
      {qrTarget && (
        <ChannelQrLoginDialog
          channelId={qrTarget.channelId}
          accountId={qrTarget.accountId}
          onClose={() => setQrTarget(null)}
          onConnected={() => {
            void loadOfficialState(true, qrTarget.channelId);
            scheduleGatewayRefresh();
          }}
        />
      )}
    </PageTransition>
  );
}

export default ChannelsCenterPage;
