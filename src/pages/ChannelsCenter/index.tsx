import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, MoreHorizontal, Plus, RefreshCw, Settings2 } from 'lucide-react';
import { PageTransition } from '@/components/shared/PageTransition';
import { WORKSPACE_PAGE_FRAME_CLASS_NAME } from '@/components/shared/workspacePageLayout';
import { showAlert, showConfirm } from '@/components/shared/AlertDialog';
import { gatewayLifecycle } from '@/runtime/gatewayLifecycle';
import { gateway, openClawChannelQrLoginClient } from '@/services/gateway';
import type { AgentConfig, GatewayRuntimeConfig } from '@/types/openclawConfig';
import {
  assessChannelAccountReadiness,
  addChannelAccount,
  buildChannelGroups,
  getChannelAgentOptions,
  persistChannelsOnly,
  removeChannelAccount,
  removeChannel,
  summarizeChannelReadiness,
  updateChannelBinding,
  updateChannelEnabled,
  upsertChannelAccount,
  type ChannelAccountReadiness,
  type ChannelGroupView,
  type ChannelAccountBinding,
} from '@/services/channelConfig';
import { enqueueTerminalCommand } from '@/services/terminalCommandQueue';
import {
  buildChannelSetupCommand,
  channelAccountStatus,
  channelErrorMessage,
  installManagedExternalChannelPlugin,
  loadOfficialChannelCapability,
  loadOfficialChannelCatalog,
  loadOfficialChannelLogs,
  loadOfficialChannelRuntimeState,
  resolveUniqueWebLoginProvider,
  redactChannelSecrets,
  runtimeChannelIds,
  type ChannelsRuntimeSnapshot,
  type OfficialChannelCatalog,
  type OfficialChannelCatalogEntry,
  type OfficialChannelCapability,
} from '@/services/openclawChannelRuntime';
import { ChannelQrLoginDialog } from './ChannelQrLoginDialog';
import { ChannelSetupWizardDialog } from './ChannelSetupWizardDialog';
import type { OpenClawWizardConfiguredAccount } from '@/services/openclawWizard';
import { ChannelAccountDialog } from './ChannelAccountDialog';
import { ChannelCatalogDialog, type ChannelCatalogItem } from './ChannelCatalogDialog';
import { ChannelDetailPanel } from './ChannelDetailPanel';
import { ChannelListPanel, type ChannelReadinessFilter } from './ChannelListPanel';
import {
  type ChannelGroupWithName,
  type EditingAccountState,
} from './channelCenterTypes';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { runChannelRuntimeAction } from '@/services/channelRuntimeActions';
import { openClawRuntimeConfigClient } from '@/services/gateway';
import { useNotificationStore } from '@/stores/notificationStore';
import {
  shouldShowChannelCenterSkeleton,
} from './channelCenterPresentation';

function channelName(
  t: ReturnType<typeof useTranslation>['t'],
  id: string,
  runtimeLabel?: string,
) {
  return runtimeLabel?.trim() || t(`config.channel.${id}`, { defaultValue: id });
}

function catalogEntryStateLabel(
  t: ReturnType<typeof useTranslation>['t'],
  catalog: OfficialChannelCatalog,
  entry: OfficialChannelCatalogEntry,
) {
  if (catalog.source === 'unavailable') {
    return t('channelsCenter.catalogUnavailable', 'OpenClaw catalog unavailable');
  }
  return `${entry.installed ? t('channelsCenter.installed', 'Installed') : t('channelsCenter.installable', 'Installable')} · ${entry.origin}`;
}


function officialAccountReadiness(
  channelId: string,
  account: ChannelAccountBinding,
  snapshot: ChannelsRuntimeSnapshot | null,
): ChannelAccountReadiness {
  const runtime = channelAccountStatus(snapshot, channelId, account.id);
  return assessChannelAccountReadiness(channelId, account, runtime);
}

export function ChannelsCenterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useNotificationStore((state) => state.addToast);
  const [searchParams, setSearchParams] = useSearchParams();
  const focusedAgentId = searchParams.get('agent')?.trim() || '';
  const [config, setConfig] = useState<GatewayRuntimeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<EditingAccountState | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [readinessFilter, setReadinessFilter] = useState<ChannelReadinessFilter>('all');
  const [catalog, setCatalog] = useState<OfficialChannelCatalog>({ source: 'unavailable', entries: [] });
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<ChannelsRuntimeSnapshot | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeLoaded, setRuntimeLoaded] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');
  const [accountActionBusy, setAccountActionBusy] = useState('');
  const [channelLogPayloads, setChannelLogPayloads] = useState<Record<string, unknown>>({});
  const [channelLogsBusy, setChannelLogsBusy] = useState('');
  const [pluginInstalling, setPluginInstalling] = useState('');
  const [qrTarget, setQrTarget] = useState<{ channelId: string; channelLabel: string; accountId: string } | null>(null);
  const [wizardTarget, setWizardTarget] = useState<{ channelId: string; channelLabel: string } | null>(null);
  const [capabilityByChannel, setCapabilityByChannel] = useState<Record<string, OfficialChannelCapability | null>>({});
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const snapshot = await openClawRuntimeConfigClient.read();
      if (!snapshot.exists) {
        setConfig(null);
        setError(t('channelsCenter.configMissing', 'OpenClaw config file was not found.'));
        return;
      }
      setConfig(snapshot.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadOfficialState = useCallback(async (probe = false, channelId?: string) => {
    setRuntimeLoading(true);
    setRuntimeError('');
    try {
      const [nextCatalog, nextSnapshot] = await Promise.all([
        loadOfficialChannelCatalog(probe),
        loadOfficialChannelRuntimeState(
          (method, params) => gateway.call(method, params),
          channelId,
          probe,
        ),
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
    } catch (reason: unknown) {
      setCatalog({ source: 'unavailable', entries: [] });
      setRuntimeError(channelErrorMessage(reason));
    } finally {
      setRuntimeLoaded(true);
      setRuntimeLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadOfficialState(false);
  }, [load, loadOfficialState]);

  const officialChannelIds = useMemo(() => new Set(catalog.entries.map((entry) => entry.id)), [catalog]);
  const groups = useMemo(() =>
    buildChannelGroups(config).map((group) => ({
      ...group,
      known: officialChannelIds.has(group.id),
      name: channelName(t, group.id, runtimeSnapshot?.channelLabels?.[group.id]),
    })),
    [config, officialChannelIds, runtimeSnapshot?.channelLabels, t]
  );
  const agents = useMemo<AgentConfig[]>(() => (
    getChannelAgentOptions(config).map((agent) => ({
      id: agent.id,
      name: agent.name,
      default: agent.isDefault,
    }))
  ), [config]);
  const accountCount = groups.reduce((sum, group) => sum + group.accounts.length, 0);
  const configuredChannelIds = useMemo(() => new Set([
    ...groups.map((group) => group.id),
    ...runtimeChannelIds(runtimeSnapshot),
  ]), [groups, runtimeSnapshot]);
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

  const initialLoading = shouldShowChannelCenterSkeleton({
    runtimeLoaded,
    loadingConfig: loading,
    hasConfig: config !== null,
  });
  const selectedGroup = filteredGroups.find((group) => group.id === expanded) ?? filteredGroups[0];
  const catalogItems = useMemo<ChannelCatalogItem[]>(() => catalog.entries.map((entry) => ({
    entry,
    label: channelName(t, entry.id, runtimeSnapshot?.channelLabels?.[entry.id]),
    stateLabel: catalogEntryStateLabel(t, catalog, entry),
    configured: configuredChannelIds.has(entry.id),
    systemImage: runtimeSnapshot?.channelSystemImages?.[entry.id],
    requiresManagedInstall: Boolean(
      entry.managedInstall
      && catalog.source === 'openclaw-cli'
      && !entry.installed
    ),
  })), [catalog, configuredChannelIds, runtimeSnapshot?.channelLabels, runtimeSnapshot?.channelSystemImages, t]);

  useEffect(() => {
    if (filteredGroups.length === 0) {
      setExpanded(null);
      return;
    }
    if (!filteredGroups.some((group) => group.id === expanded)) {
      setExpanded(filteredGroups[0].id);
    }
  }, [expanded, filteredGroups]);

  const saveConfig = async (
    base: GatewayRuntimeConfig,
    next: GatewayRuntimeConfig,
    successMessage: string,
  ): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const merged = await persistChannelsOnly(base, next);
      setConfig(merged);
      const restart = await gatewayLifecycle.restart('channels-config-save').catch((err: unknown) => ({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }));
      if (!restart?.success) {
        showAlert(t('channelsCenter.savedWithRestartWarning', 'Saved, but Gateway restart failed'), String(restart?.error ?? ''), 'warning');
      } else {
        showAlert(t('common.saved', 'Saved'), successMessage, 'success');
      }
      await Promise.all([load(), loadOfficialState(false)]);
      window.dispatchEvent(new CustomEvent('aegis:config-saved', { detail: { channelsChanged: true } }));
      return true;
    } catch (err) {
      showAlert(t('config.saveFailed', 'Save failed'), err instanceof Error ? err.message : String(err), 'error');
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleToggle = (channelId: string, enabled: boolean) => {
    if (!config) return;
    void saveConfig(config, updateChannelEnabled(config, channelId, enabled), t('channelsCenter.channelUpdated', 'Channel updated.'));
  };

  const handleBind = (group: ChannelGroupView & { name: string }, account: ChannelAccountBinding, agentId: string) => {
    if (!config) return;
    void saveConfig(config, updateChannelBinding(config, group.id, account, agentId), t('channelsCenter.bindingUpdated', 'Binding updated.'));
  };

  const openChannelTerminal = (command: string) => {
    enqueueTerminalCommand({ command });
    navigate('/terminal');
  };

  const handleLinkAccount = (
    _entry: OfficialChannelCatalogEntry | undefined,
    group: ChannelGroupWithName,
    _account: ChannelAccountBinding,
  ) => {
    setWizardTarget({ channelId: group.id, channelLabel: group.name });
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
      await runChannelRuntimeAction(gateway.callPrivileged, method, {
        channelId: group.id,
        accountId: account.id,
      });
      await loadOfficialState(true, group.id);
    } catch (reason: unknown) {
      showAlert(t('channelsCenter.channelActionFailed', 'Channel action failed'), channelErrorMessage(reason), 'error');
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
      const payload = await loadOfficialChannelLogs(channelId, 200);
      setChannelLogPayloads((current) => ({ ...current, [channelId]: redactChannelSecrets(payload) }));
    } catch (reason: unknown) {
      showAlert(t('channelsCenter.logsFailed', 'Unable to load channel logs'), channelErrorMessage(reason), 'error');
    } finally {
      setChannelLogsBusy('');
    }
  };

  const handleCopyRedacted = async (group: ChannelGroupWithName) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(redactChannelSecrets(group.config), null, 2));
      addToast(
        'info',
        t('channelsCenter.copyRedacted', 'Copy redacted'),
        t('common.copied', 'Copied'),
      );
    } catch (reason: unknown) {
      addToast(
        'error',
        t('channelsCenter.copyRedacted', 'Copy redacted'),
        reason instanceof Error
          ? reason.message
          : t('settings.attachmentsOperationFailed', 'Operation failed'),
      );
    }
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
    const editConfig = editingAccount.draftConfig ?? config;
    const next = editingAccount.mode === 'new'
      ? addChannelAccount(editConfig, editingAccount.group.id, accountId, accountConfig)
      : upsertChannelAccount(
        editConfig,
        editingAccount.group.id,
        editingAccount.account ?? { id: accountId, source: 'account' },
        accountConfig,
      );
    const saved = await saveConfig(config, next, t('channelsCenter.accountSaved', 'Account saved.'));
    if (saved) {
      setExpanded(editingAccount.group.id);
      setEditingAccount(null);
    }
  };

  const handleDeleteAccount = async (group: ChannelGroupWithName, account: ChannelAccountBinding) => {
    if (!config || account.source !== 'account') return;
    showConfirm(
      t('channelsCenter.removeAccountTitle', 'Remove account'),
      t('channelsCenter.removeAccountMessage', { account: account.label, defaultValue: `Remove ${account.label}?` }),
      async () => {
        const saved = await saveConfig(
          config,
          removeChannelAccount(config, group.id, account.id),
          t('channelsCenter.accountRemoved', 'Account removed.'),
        );
        if (saved) setEditingAccount(null);
      }
    );
  };

  const handleRemove = (group: ChannelGroupView & { name: string }) => {
    if (!config) return;
    showConfirm(
      t('channelsCenter.removeTitle', 'Remove channel'),
      t('channelsCenter.removeMessage', { channel: group.name, defaultValue: `Remove ${group.name}?` }),
      () => { void saveConfig(config, removeChannel(config, group.id), t('channelsCenter.channelRemoved', 'Channel removed.')); }
    );
  };

  const handleAdd = (entry: OfficialChannelCatalogEntry) => {
    setWizardTarget({
      channelId: entry.id,
      channelLabel: channelName(t, entry.id, runtimeSnapshot?.channelLabels?.[entry.id]),
    });
  };

  const handleCatalogEntry = (entry: OfficialChannelCatalogEntry) => {
    setCatalogOpen(false);
    const configured = groups.find((group) => group.id === entry.id);
    if (!configured) {
      handleAdd(entry);
      return;
    }
    handleAdd(entry);
  };

  const handleWizardComplete = async (accounts: OpenClawWizardConfiguredAccount[]) => {
    if (!wizardTarget) return;
    const completedTarget = wizardTarget;
    setWizardTarget(null);
    try {
      const [nextCatalog] = await Promise.all([
        loadOfficialChannelCatalog(true),
        load(),
        loadOfficialState(true),
      ]);
      const provider = await resolveUniqueWebLoginProvider(nextCatalog);
      const matchingAccounts = accounts.filter((account) => account.channel === completedTarget.channelId);
      if (provider === completedTarget.channelId && matchingAccounts.length === 1) {
        setQrTarget({
          channelId: completedTarget.channelId,
          channelLabel: completedTarget.channelLabel,
          accountId: matchingAccounts[0].accountId,
        });
      }
    } catch (reason: unknown) {
      showAlert(
        t('channelsCenter.channelRefreshFailed', 'Channel setup completed, but the updated Runtime state could not be loaded.'),
        channelErrorMessage(reason),
        'warning',
      );
    }
  };

  const handleInstallManagedPlugin = async (channelId: string) => {
    const currentEntry = catalog.entries.find((entry) => entry.id === channelId);
    if (!currentEntry?.managedInstall || currentEntry.installed || pluginInstalling) return;
    setPluginInstalling(channelId);
    try {
      const result = await installManagedExternalChannelPlugin(channelId);
      await Promise.all([load(), loadOfficialState(true)]);
      showAlert(
        t('channelsCenter.pluginInstalled', 'Official plugin installed'),
        t('channelsCenter.pluginInstalledHint', {
          channel: channelName(t, result.channel, runtimeSnapshot?.channelLabels?.[result.channel]),
          defaultValue: `${channelName(t, result.channel, runtimeSnapshot?.channelLabels?.[result.channel])} is installed by OpenClaw. Configure its credentials next.`,
        }),
        'success',
      );
    } catch (reason: unknown) {
      showAlert(
        t('channelsCenter.pluginInstallFailed', 'Plugin installation failed'),
        channelErrorMessage(reason),
        'error',
      );
    } finally {
      setPluginInstalling('');
    }
  };

  const handleSelectGroup = (group: ChannelGroupWithName) => {
    setExpanded(group.id);
    if (!Object.prototype.hasOwnProperty.call(capabilityByChannel, group.id)) {
      void loadOfficialChannelCapability(group.id)
        .then((capability) => setCapabilityByChannel((current) => ({ ...current, [group.id]: capability })))
        .catch(() => setCapabilityByChannel((current) => ({ ...current, [group.id]: null })));
    }
  };

  return (
    <PageTransition className={`${WORKSPACE_PAGE_FRAME_CLASS_NAME} space-y-4`}>
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h1 className="text-[18px] font-bold text-aegis-text">
            {t('sidebar.nav.channels', 'Channels')}
          </h1>
          <p className="mt-0.5 text-[12px] text-aegis-text-dim">
            {t('channelsCenter.subtitle', 'Connect agents to channels provided by the selected OpenClaw Runtime.')}
          </p>
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-aegis-text-muted">
            <span>{catalog.source === 'unavailable' ? t('channelsCenter.catalogUnavailable', 'OpenClaw catalog unavailable') : catalog.source}</span>
            {catalog.version && <span className="font-mono">{catalog.version}</span>}
            {runtimeLoading && <LoadingIndicator size={10} />}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { void load(); void loadOfficialState(false); }}
            disabled={loading || saving || runtimeLoading}
            title={t('common.refresh', 'Refresh')}
            aria-label={t('common.refresh', 'Refresh')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-aegis-border text-aegis-text-muted hover:bg-aegis-hover hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading || runtimeLoading ? 'animate-spin' : undefined} />
          </button>
          <button
            type="button"
            data-tour="channels-add"
            onClick={() => setCatalogOpen(true)}
            disabled={catalog.source === 'unavailable'}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-aegis-primary px-3 text-[11px] font-semibold text-[rgb(var(--aegis-btn-primary-text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35 disabled:opacity-50"
          >
            <Plus size={13} />
            {t('channelsCenter.addChannels', 'Add channel')}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('channelsCenter.moreActions', 'More channel actions')}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-aegis-border text-aegis-text-muted hover:bg-aegis-hover hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35"
              >
                <MoreHorizontal size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 text-[11px]">
              <DropdownMenuItem onSelect={() => navigate('/config?tab=channels')} className="justify-start">
                <Settings2 size={13} />
                {t('channelsCenter.advancedConfig', 'Advanced config')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {(error || runtimeError) && (
        <div className="flex items-start gap-2 rounded-md border border-aegis-danger/20 bg-aegis-danger/5 px-3 py-2.5 text-[11px] text-aegis-danger" role="alert">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div className="min-w-0 space-y-1">
            {error && <div className="break-words">{error}</div>}
            {runtimeError && (
              <div className="break-words">
                {t('channelsCenter.runtimeLoadFailed', 'Unable to load channels from the selected OpenClaw Runtime')}: {runtimeError}
              </div>
            )}
          </div>
        </div>
      )}

      {initialLoading ? (
        <div
          className="grid min-h-[520px] grid-cols-1 overflow-hidden rounded-lg border border-aegis-border bg-aegis-card lg:grid-cols-[260px_minmax(0,1fr)]"
          aria-busy="true"
          aria-label={t('channelsCenter.loadingRuntime', 'Loading the OpenClaw channel catalog')}
        >
          <div className="space-y-2 border-b border-aegis-border p-3 lg:border-b-0 lg:border-e">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-12 animate-pulse rounded-md bg-aegis-surface" />
            ))}
          </div>
          <div className="flex items-center justify-center gap-2 text-[12px] text-aegis-text-muted">
            <LoadingIndicator size={18} />
            {t('channelsCenter.loadingRuntime', 'Loading the OpenClaw channel catalog')}
          </div>
        </div>
      ) : (
        <div className="grid min-h-[520px] grid-cols-1 overflow-hidden rounded-lg border border-aegis-border bg-aegis-card lg:grid-cols-[260px_minmax(0,1fr)]">
          <ChannelListPanel
            groups={groups}
            filteredGroups={filteredGroups}
            selectedGroupId={selectedGroup?.id}
            runtimeSnapshot={runtimeSnapshot}
            accountCount={accountCount}
            readyCount={readinessSummary.ready}
            readinessCounts={readinessSummary}
            readinessFilter={readinessFilter}
            saving={saving}
            focusedAgentName={focusedAgentId ? focusedAgent?.name || focusedAgentId : undefined}
            getReadiness={(group, accountId) => {
              const account = group.accounts.find((item) => item.id === accountId);
              return account
                ? officialAccountReadiness(group.id, account, runtimeSnapshot)
                : { state: 'unknown', missingFields: [], messages: ['unknown'] };
            }}
            onFilterChange={setReadinessFilter}
            onSelect={handleSelectGroup}
            onClearAgentFocus={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('agent');
              setSearchParams(next, { replace: true });
            }}
            onAddChannel={() => setCatalogOpen(true)}
          />
          <ChannelDetailPanel
            group={selectedGroup}
            allGroupCount={groups.length}
            catalog={catalog}
            runtimeSnapshot={runtimeSnapshot}
            capability={selectedGroup ? capabilityByChannel[selectedGroup.id] : undefined}
            agents={agents}
            saving={saving}
            runtimeLoading={runtimeLoading}
            pluginInstalling={pluginInstalling}
            accountActionBusy={accountActionBusy}
            channelLogsBusy={channelLogsBusy}
            channelLogPayload={selectedGroup ? channelLogPayloads[selectedGroup.id] : undefined}
            hasChannelLogPayload={Boolean(selectedGroup && Object.prototype.hasOwnProperty.call(channelLogPayloads, selectedGroup.id))}
            getReadiness={(account) => (
              selectedGroup
                ? officialAccountReadiness(selectedGroup.id, account, runtimeSnapshot)
                : { state: 'unknown', missingFields: [], messages: ['unknown'] }
            )}
            onInstallPlugin={(channelId) => { void handleInstallManagedPlugin(channelId); }}
            onAddAccount={(group) => setEditingAccount({ mode: 'new', group })}
            onToggle={handleToggle}
            onProbe={(channelId) => { void loadOfficialState(true, channelId); }}
            onToggleLogs={(channelId) => { void handleChannelLogs(channelId); }}
            onCopyRedacted={(group) => { void handleCopyRedacted(group); }}
            onRemoveChannel={handleRemove}
            onBind={handleBind}
            onLink={handleLinkAccount}
            onEditAccount={(group, account) => setEditingAccount({ mode: 'edit', group, account })}
            onRuntimeAction={(method, group, account) => { void handleAccountRuntimeAction(method, group, account); }}
            onDeleteAccount={(group, account) => { void handleDeleteAccount(group, account); }}
          />
        </div>
      )}

      {editingAccount && (
        <ChannelAccountDialog
          key={`${editingAccount.mode}:${editingAccount.group.id}:${editingAccount.account?.id ?? 'new'}`}
          state={editingAccount}
          agents={agents}
          saving={saving}
          onClose={() => setEditingAccount(null)}
          onSave={(accountId, accountConfig) => { void handleSaveAccount(accountId, accountConfig); }}
          onDelete={(account) => { void handleDeleteAccount(editingAccount.group, account); }}
        />
      )}
      <ChannelCatalogDialog
        open={catalogOpen}
        items={catalogItems}
        disabled={!config || saving}
        installingChannelId={pluginInstalling}
        onClose={() => setCatalogOpen(false)}
        onSelect={handleCatalogEntry}
        onInstall={(channelId) => { void handleInstallManagedPlugin(channelId); }}
      />
      {qrTarget && (
        <ChannelQrLoginDialog
          client={openClawChannelQrLoginClient}
          channelId={qrTarget.channelId}
          channelLabel={qrTarget.channelLabel}
          accountId={qrTarget.accountId}
          onClose={() => setQrTarget(null)}
          onConnected={() => {
            void loadOfficialState(true, qrTarget.channelId);
          }}
        />
      )}
      {wizardTarget && (
        <ChannelSetupWizardDialog
          key={wizardTarget.channelId}
          channelId={wizardTarget.channelId}
          channelLabel={wizardTarget.channelLabel}
          onClose={() => setWizardTarget(null)}
          onComplete={(accounts) => { void handleWizardComplete(accounts); }}
          onTerminalFallback={() => {
            const target = wizardTarget;
            setWizardTarget(null);
            openChannelTerminal(buildChannelSetupCommand(target.channelId));
          }}
        />
      )}
    </PageTransition>
  );
}

export default ChannelsCenterPage;
