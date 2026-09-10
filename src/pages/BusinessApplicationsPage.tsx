import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import clsx from 'clsx';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Building2,
  Filter,
  PanelLeftClose,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { PageTransition } from '@/components/shared/PageTransition';
import { IconButton } from '@/components/shared/button/Button';
import { showConfirm } from '@/components/shared/AlertDialog';
import { PaneResizeHandle } from '@/components/BusinessApplications/PaneResizeHandle';
import { DingTalkToolTable } from '@/components/BusinessApplications/DingTalkToolTable';
import { DingTalkToolDetail } from '@/components/BusinessApplications/DingTalkToolDetail';
import { DingTalkRuntimeIdentity } from '@/components/BusinessApplications/DingTalkRuntimeIdentity';
import {
  DingTalkReadinessPanel,
  type DingTalkDwsOperationPresentation,
  type DingTalkPluginInstallProgress,
} from '@/components/BusinessApplications/DingTalkReadinessPanel';
import { DingTalkPluginInstallDialog } from '@/components/BusinessApplications/DingTalkPluginInstallDialog';
import { DingTalkEventSettingsPanel } from '@/components/BusinessApplications/DingTalkEventSettingsPanel';
import { BusinessActivityList } from '@/components/BusinessApplications/BusinessActivityList';
import {
  loadDingTalkEventConfiguration,
  normalizeDingTalkEventConfiguration,
  applyDingTalkEventConfiguration,
  DingTalkEventConfigurationAppliedError,
  type DingTalkEventConfiguration,
} from '@/business-applications/dingtalkEventConfiguration';
import {
  DINGTALK_RUNTIME_STATUS_TOOL,
  DINGTALK_TOOL_SCHEMA_TOOL,
  collectDingTalkTools,
  DingTalkToolContractError,
  hasAvailableDingTalkRuntimeTool,
  isDingTalkProfileAuthenticated,
  parseDingTalkBusinessEvidence,
  parseDingTalkToolSchemaOutput,
  parseProfileReference,
  parseToolArguments,
  resolveDingTalkCatalogAvailability,
  type DingTalkDomain,
  type DingTalkEffectiveTool,
  type DingTalkToolSchemaProjection,
} from '@/business-applications/dingtalkTools';
import { dingtalkPluginInstallBlocker } from '@/business-applications/dingtalkPluginInstall';
import { resolveDwsExecutionProfile } from '@/business-applications/dwsProfileSelection';
import {
  diagnoseDwsAuthorizationFailure,
  type DwsAuthorizationFailureDiagnosis,
} from '@/business-applications/dwsAuthorizationFailure';
import {
  authorizeDingTalkAgent,
  configureDingTalkDwsPath,
} from '@/business-applications/dingtalkAgentAuthorization';
import { collectDingTalkAuthorizationTargets } from '@/business-applications/dingtalkAuthorizationTarget';
import {
  cacheDwsOperationFinished,
  cacheDwsOperationOutput,
  formatDwsOperationOutput,
  releaseDwsOperationCache,
  rememberFinalizedDwsOperation,
  type DwsOperationEventCache,
} from '@/business-applications/dwsOperationEventCache';
import {
  claimDwsOperationStart,
  isDwsOperationActive,
  releaseDwsOperationStart,
} from '@/business-applications/dwsOperationLifecycle';
import { selectCurrentDingTalkRuntimeIdentitySnapshot } from '@/business-applications/dingtalkRuntimeIdentityCoordinator';
import { DingTalkToolSchemaRequestCoordinator } from '@/business-applications/dingtalkToolRequestCoordinator';
import {
  assertDingTalkEventSnapshotContext,
  createDingTalkEventSnapshotReadContext,
  digestDingTalkEventConfiguration,
  DingTalkEventSnapshotContextError,
  DingTalkEventSnapshotRequestCoordinator,
  selectDingTalkEventConfigurationForConnection,
} from '@/business-applications/dingtalkEventSnapshotCoordinator';
import { useBusinessActivityStore } from '@/business-applications/activityStore';
import { resolveDingTalkInvocationOutcome } from '@/business-applications/dingtalkInvocationOutcome';
import { parseBusinessApplicationsView } from '@/business-applications/businessApplicationsView';
import {
  invokeOpenClawTool,
  refreshAll,
  refreshToolsEffective,
  useGatewayDataStore,
} from '@/stores/gatewayDataStore';
import { useChatStore } from '@/stores/chatStore';
import {
  publishDingTalkRuntimeIdentityResult,
  refreshDingTalkRuntimeIdentitySnapshot,
  useDingTalkRuntimeIdentitySnapshot,
} from '@/stores/dingTalkRuntimeIdentityStore';
import {
  cancelDwsOperation,
  getDingTalkPluginStatus,
  installBundledDingTalkPlugin,
  startDwsOperation,
  type DwsOperationFinished,
  type DwsOperationKind,
  type DwsOperationOutput,
  type DingTalkPluginStatus,
} from '@/api/tauri-commands';
import {
  getCurrentRuntimeIdentity,
  subscribeRuntimeIdentity,
} from '@/services/gateway/runtimeIdentity';
import {
  gateway,
  getLatestDingTalkEventInvalidation,
  openClawDingTalkEventClient,
  openClawRuntimeConfigClient,
  subscribeDingTalkEventInvalidations,
} from '@/services/gateway';
import type { OpenClawDingTalkEventSnapshot } from '@/services/gateway/OpenClawDingTalkEventClient';
import { gatewayLifecycle } from '@/runtime/gatewayLifecycle';
import { subscribeTauriEvent } from '@/utils/tauriEvents';

type DomainFilter = 'all' | DingTalkDomain;
type EffectFilter = 'all' | 'read' | 'write';

const DOMAIN_FILTERS: readonly DomainFilter[] = [
  'all',
  'contact',
  'approval',
  'attendance',
  'calendar',
  'todo',
  'minutes',
  'doc',
  'wiki',
  'report',
  'mail',
  'chat',
  'aitable',
  'contract',
  'recruit',
  'goal',
  'runtime',
];

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'UNEXPECTED_FAILURE';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createAttemptId(): string | null {
  if (typeof globalThis.crypto?.randomUUID !== 'function') return null;
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return null;
  }
}

function useRuntimeIdentitySnapshot() {
  return useSyncExternalStore(
    (onStoreChange) => subscribeRuntimeIdentity(() => onStoreChange()),
    getCurrentRuntimeIdentity,
    () => null,
  );
}

function FilterPane({
  width,
  collapsed,
  search,
  domain,
  effect,
  domainCounts,
  effectCounts,
  filteredCount,
  onWidthChange,
  onCollapsedChange,
  onSearchChange,
  onDomainChange,
  onEffectChange,
  onReset,
}: {
  width: number;
  collapsed: boolean;
  search: string;
  domain: DomainFilter;
  effect: EffectFilter;
  domainCounts: Readonly<Record<DomainFilter, number>>;
  effectCounts: Readonly<Record<EffectFilter, number>>;
  filteredCount: number;
  onWidthChange: (value: number) => void;
  onCollapsedChange: (value: boolean) => void;
  onSearchChange: (value: string) => void;
  onDomainChange: (value: DomainFilter) => void;
  onEffectChange: (value: EffectFilter) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const domainFilterLabel = (value: DomainFilter) => t(`businessApplications.workbench.domain.${value}`);
  const effectFilterLabel = (value: EffectFilter) => (
    value === 'all'
      ? t('businessApplications.workbench.domain.all')
      : t(`businessApplications.workbench.effect.${value}`)
  );
  if (collapsed) {
    return (
      <aside className="flex min-h-0 flex-col items-center border-r border-aegis-border bg-aegis-surface/55 py-2">
        <IconButton aria-label={t('businessApplications.workbench.filter.expand')} title={t('businessApplications.workbench.filter.expand')} onClick={() => onCollapsedChange(false)}>
          <Filter size={14} />
        </IconButton>
        <span className="mt-2 font-mono text-[9px] tabular-nums text-aegis-text-dim">{filteredCount}</span>
        <span className="mt-3 text-[10px] tracking-[0.18em] text-aegis-text-dim" style={{ writingMode: 'vertical-rl' }}>{t('businessApplications.workbench.filter.title')}</span>
      </aside>
    );
  }
  const filtersActive = search.trim() !== '' || domain !== 'all' || effect !== 'all';
  return (
    <aside className="relative min-h-0 overflow-y-auto border-r border-aegis-border bg-aegis-surface/55 p-3">
      <PaneResizeHandle side="left" value={width} min={208} max={340} label={t('businessApplications.workbench.filter.resize')} onChange={onWidthChange} />
      <div className="flex h-7 items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-aegis-text-secondary"><SlidersHorizontal size={13} />{t('businessApplications.workbench.filter.title')}</span>
        <IconButton aria-label={t('businessApplications.workbench.filter.collapse')} title={t('businessApplications.workbench.filter.collapse')} onClick={() => onCollapsedChange(true)}><PanelLeftClose size={14} /></IconButton>
      </div>
      <label className="mt-3 block text-[10px] font-medium text-aegis-text-dim" htmlFor="dingtalk-tool-search">{t('businessApplications.workbench.filter.searchLabel')}</label>
      <div className="relative mt-1">
        <Search size={12} className="pointer-events-none absolute left-2 top-2 text-aegis-text-dim" />
        <input
          id="dingtalk-tool-search"
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('businessApplications.workbench.filter.searchPlaceholder')}
          className="h-7 w-full rounded-md border border-aegis-border bg-aegis-bg pl-7 pr-2 text-[10.5px] text-aegis-text outline-none placeholder:text-aegis-text-dim focus:border-aegis-primary/60 focus:ring-1 focus:ring-aegis-primary/25"
        />
      </div>
      <fieldset className="mt-4">
        <legend className="text-[10px] font-medium text-aegis-text-dim">{t('businessApplications.workbench.filter.domain')}</legend>
        <div className="mt-1 grid grid-cols-2 gap-1">
          {DOMAIN_FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={domain === item}
              onClick={() => onDomainChange(item)}
              className={clsx(
                'flex h-7 items-center justify-between gap-2 rounded-md border px-2 text-left text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60',
                domain === item
                  ? 'border-aegis-primary/35 bg-aegis-primary/10 text-aegis-primary'
                  : 'border-transparent text-aegis-text-dim hover:border-aegis-border hover:bg-aegis-hover/45',
              )}
            >
              <span className="truncate">{domainFilterLabel(item)}</span>
              <span className="shrink-0 font-mono tabular-nums opacity-75">{domainCounts[item]}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-4">
        <legend className="text-[10px] font-medium text-aegis-text-dim">{t('businessApplications.workbench.filter.effect')}</legend>
        <div className="mt-1 grid grid-cols-3 gap-1 rounded-md border border-aegis-border bg-aegis-bg/55 p-0.5">
          {(['all', 'read', 'write'] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={effect === item}
              onClick={() => onEffectChange(item)}
              className={clsx(
                'flex h-7 min-w-0 items-center justify-center gap-1 rounded px-1 text-[9.5px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60',
                effect === item ? 'bg-aegis-surface text-aegis-text shadow-sm' : 'text-aegis-text-dim hover:bg-aegis-hover/45',
              )}
            >
              <span>{effectFilterLabel(item)}</span>
              <span className="font-mono tabular-nums opacity-70">{effectCounts[item]}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 border-t border-aegis-border pt-3">
        <div className="flex items-center justify-between gap-2 text-[9.5px] text-aegis-text-dim">
          <span>{t('businessApplications.workbench.filter.currentResults')}</span>
          <span className="font-mono tabular-nums">{filteredCount} / {domainCounts.all}</span>
        </div>
        <p className="mt-1 text-[9.5px] leading-4 text-aegis-text-dim">{t('businessApplications.workbench.filter.boundCatalogBoundary')}</p>
        {filtersActive && (
          <button
            type="button"
            onClick={onReset}
            className="mt-2 text-[10px] text-aegis-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
          >
            {t('businessApplications.workbench.filter.clear')}
          </button>
        )}
      </div>
    </aside>
  );
}

export function BusinessApplicationsPage() {
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  return <BusinessApplicationsWorkspace key={activeSessionKey} activeSessionKey={activeSessionKey} />;
}

function BusinessApplicationsWorkspace({ activeSessionKey }: { activeSessionKey: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const identity = useRuntimeIdentitySnapshot();
  const latestDingTalkEventInvalidation = useSyncExternalStore(
    subscribeDingTalkEventInvalidations,
    getLatestDingTalkEventInvalidation,
    () => null,
  );
  const sessions = useGatewayDataStore((state) => state.sessions);
  const agents = useGatewayDataStore((state) => state.agents);
  const effective = useGatewayDataStore((state) => state.toolsEffective[activeSessionKey]);
  const effectiveToolsRevision = useGatewayDataStore((state) => (
    state.toolsEffectiveUpdatedAt[activeSessionKey] ?? 0
  ));
  const toolsLoading = useGatewayDataStore((state) => (
    state.toolsEffectiveLoading && state.toolsEffectiveLoadingSessionKey === activeSessionKey
  ));
  const toolsError = useGatewayDataStore((state) => state.toolsEffectiveError);
  const sessionExists = sessions.some((session) => session.key === activeSessionKey);
  const activeSession = sessions.find((session) => session.key === activeSessionKey) ?? null;
  const runtimeIdentityContextKey = identity?.connectionId && activeSessionKey
    ? `${identity.connectionId}\u0000${activeSessionKey}`
    : null;
  const activeAgentId = effective?.agentId ?? activeSession?.agentId ?? null;
  const authorizationAgentOptions = useMemo(
    () => collectDingTalkAuthorizationTargets(activeAgentId, agents),
    [activeAgentId, agents],
  );
  const allTools = useMemo(() => collectDingTalkTools(effective?.groups), [effective]);
  const rawEffectiveTools = useMemo(
    () => effective?.groups.flatMap((group) => group.tools) ?? [],
    [effective],
  );
  const schemaToolAvailable = rawEffectiveTools.some((tool) => tool.id === DINGTALK_TOOL_SCHEMA_TOOL && !tool.deniedBySession);
  const runtimeToolAvailable = hasAvailableDingTalkRuntimeTool(effective?.groups);

  const view = parseBusinessApplicationsView(location.search);
  const [leftWidth, setLeftWidth] = useState(228);
  const [rightWidth, setRightWidth] = useState(382);
  const [leftCollapsed, setLeftCollapsed] = useState(true);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const [domain, setDomain] = useState<DomainFilter>('all');
  const [effect, setEffect] = useState<EffectFilter>('all');
  const [profile, setProfile] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [argumentsJson, setArgumentsJson] = useState('{}');
  const [schema, setSchema] = useState<DingTalkToolSchemaProjection | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [invoking, setInvoking] = useState(false);
  const [invocationOutput, setInvocationOutput] = useState<unknown>(undefined);
  const [invocationError, setInvocationError] = useState<string | null>(null);
  const [pluginStatus, setPluginStatus] = useState<DingTalkPluginStatus | null>(null);
  const [pluginStatusLoading, setPluginStatusLoading] = useState(true);
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [authorizationNotice, setAuthorizationNotice] = useState<string | null>(null);
  const [authorizationTargetAgentId, setAuthorizationTargetAgentId] = useState<string | null>(null);
  const [pluginOperation, setPluginOperation] = useState<'installing' | 'authorizing' | 'restarting' | null>(null);
  const [dingtalkRefreshPending, setDingTalkRefreshPending] = useState(false);
  const [pluginInstallationProgress, setPluginInstallationProgress] = useState<DingTalkPluginInstallProgress>({ phase: 'idle', message: null });
  const [pluginInstallDialogOpen, setPluginInstallDialogOpen] = useState(false);
  const [dwsOperation, setDwsOperation] = useState<DingTalkDwsOperationPresentation | null>(null);
  const [dwsOutput, setDwsOutput] = useState<string[]>([]);
  const [dwsAuthorizationFailure, setDwsAuthorizationFailure] = useState<DwsAuthorizationFailureDiagnosis | null>(null);
  const [eventConfiguration, setEventConfiguration] = useState<DingTalkEventConfiguration | null>(null);
  const [savedEventConfiguration, setSavedEventConfiguration] = useState<DingTalkEventConfiguration | null>(null);
  const [eventConfigurationConnectionId, setEventConfigurationConnectionId] = useState<string | null>(null);
  const [eventConfigurationLoading, setEventConfigurationLoading] = useState(false);
  const [eventConfigurationSaving, setEventConfigurationSaving] = useState(false);
  const [eventConfigurationError, setEventConfigurationError] = useState<string | null>(null);
  const [eventConfigurationNotice, setEventConfigurationNotice] = useState<string | null>(null);
  const [eventSnapshot, setEventSnapshot] = useState<OpenClawDingTalkEventSnapshot | null>(null);
  const [eventSnapshotLoading, setEventSnapshotLoading] = useState(false);
  const [eventSnapshotError, setEventSnapshotError] = useState<string | null>(null);
  const eventConfigurationRequest = useRef(0);
  const eventSnapshotRequests = useRef(new DingTalkEventSnapshotRequestCoordinator());
  const eventSnapshotContextRef = useRef<ReturnType<typeof createDingTalkEventSnapshotReadContext>>(null);
  const dwsEventCache = useRef<DwsOperationEventCache>({ output: {}, events: {}, finished: {} });
  const dwsFinalizedOperationIds = useRef(new Set<string>());
  const dwsStartGuard = useRef(false);
  const dwsCancellationRequested = useRef(false);
  const dwsDismissAfterCancellation = useRef(false);
  const schemaRequests = useRef(new DingTalkToolSchemaRequestCoordinator());
  const previousExecutionProfile = useRef<string | null>(null);
  const [dwsCompletionRevision, setDwsCompletionRevision] = useState(0);
  const dingtalkRefreshInFlight = useRef(false);
  const runtimeIdentitySnapshot = useDingTalkRuntimeIdentitySnapshot();

  const matchingRuntimeIdentitySnapshot = runtimeIdentityContextKey
    && runtimeIdentitySnapshot?.contextKey === runtimeIdentityContextKey
    && runtimeIdentitySnapshot.toolsRevision === effectiveToolsRevision
    ? runtimeIdentitySnapshot
    : null;
  const currentRuntimeIdentitySnapshot = selectCurrentDingTalkRuntimeIdentitySnapshot(
    runtimeIdentitySnapshot,
    runtimeIdentityContextKey,
    effectiveToolsRevision,
  );
  const runtimeIdentity = currentRuntimeIdentitySnapshot?.runtime ?? null;
  const runtimeIdentityError = currentRuntimeIdentitySnapshot?.error ?? null;
  const agentRuntimeVerified = runtimeIdentity !== null && runtimeIdentityError === null;
  const runtimeIdentitySettled = matchingRuntimeIdentitySnapshot?.phase === 'settled';
  const runtimeIdentityLoading = matchingRuntimeIdentitySnapshot?.phase === 'loading';

  const beginAttempt = useBusinessActivityStore((state) => state.begin);
  const settleAttempt = useBusinessActivityStore((state) => state.settle);

  const executionProfile = resolveDwsExecutionProfile(
    runtimeIdentity?.profiles ?? [],
    runtimeIdentity?.currentProfile ?? null,
    profile,
  );
  const profileAuthenticated = isDingTalkProfileAuthenticated(runtimeIdentity, executionProfile);
  const pluginVisibleInSession = allTools.length > 0;
  const catalogAvailability = resolveDingTalkCatalogAvailability({
    sessionExists,
    toolsLoading: toolsLoading || (effective === undefined && !toolsError),
    pluginVisibleInSession,
    runtimeToolAvailable,
    runtimeIdentitySettled,
    runtimeIdentityError,
    profileAuthenticated,
  });
  const catalogLoading = catalogAvailability === 'loading-tools'
    || catalogAvailability === 'loading-identity';
  const dwsOperationActive = isDwsOperationActive(dwsOperation?.phase);
  const authenticatedCatalogTools = useMemo(
    () => profileAuthenticated ? allTools : [],
    [allTools, profileAuthenticated],
  );
  const selectedTool = authenticatedCatalogTools.find((tool) => tool.entry.id === selectedId) ?? null;
  const filteredTools = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return authenticatedCatalogTools.filter((tool) => {
      if (domain !== 'all' && tool.domain !== domain) return false;
      if (effect !== 'all' && tool.effect !== effect) return false;
      if (!query) return true;
      return `${tool.entry.label}\n${tool.entry.description}\n${tool.entry.id}`.toLocaleLowerCase().includes(query);
    });
  }, [authenticatedCatalogTools, domain, effect, search]);
  const domainCounts = useMemo(() => {
    const counts: Record<DomainFilter, number> = {
      all: authenticatedCatalogTools.length,
      contact: 0,
      approval: 0,
      attendance: 0,
      calendar: 0,
      todo: 0,
      minutes: 0,
      doc: 0,
      wiki: 0,
      report: 0,
      mail: 0,
      chat: 0,
      aitable: 0,
      contract: 0,
      recruit: 0,
      goal: 0,
      runtime: 0,
      unknown: 0,
    };
    for (const tool of authenticatedCatalogTools) counts[tool.domain] += 1;
    return counts;
  }, [authenticatedCatalogTools]);
  const effectCounts = useMemo(() => ({
    all: authenticatedCatalogTools.length,
    read: authenticatedCatalogTools.filter((tool) => tool.effect === 'read').length,
    write: authenticatedCatalogTools.filter((tool) => tool.effect === 'write').length,
  }), [authenticatedCatalogTools]);
  const clearFilters = useCallback(() => {
    setSearch('');
    setDomain('all');
    setEffect('all');
  }, []);

  const refreshTools = useCallback(async () => {
    const currentSessionExists = useGatewayDataStore.getState().sessions
      .some((session) => session.key === activeSessionKey);
    if (!currentSessionExists || !activeSessionKey) return;
    await refreshToolsEffective(activeSessionKey, activeSession?.agentId);
  }, [activeSession?.agentId, activeSessionKey]);

  const refreshRuntimeIdentity = useCallback(async () => {
    if (!identity?.connectionId || !activeSessionKey) return false;
    return refreshDingTalkRuntimeIdentitySnapshot(
      identity.connectionId,
      activeSessionKey,
      true,
    );
  }, [activeSessionKey, identity?.connectionId]);

  const refreshPluginStatus = useCallback(async () => {
    const currentIdentity = getCurrentRuntimeIdentity();
    if (!currentIdentity?.verified || !currentIdentity.desktopMutationAllowed) {
      setPluginStatus(null);
      setPluginError(null);
      setPluginStatusLoading(false);
      return;
    }
    setPluginStatusLoading(true);
    try {
      const status = await getDingTalkPluginStatus(currentIdentity.targetFingerprint, currentIdentity.connectionId);
      setPluginStatus(status);
      setPluginError(null);
    } catch (error) {
      setPluginStatus(null);
      setPluginError(errorMessage(error));
    } finally {
      setPluginStatusLoading(false);
    }
  }, [identity]);

  const refreshDingTalkState = useCallback(async () => {
    await refreshTools();
    await Promise.all([
      refreshPluginStatus(),
      refreshRuntimeIdentity(),
    ]);
  }, [refreshPluginStatus, refreshRuntimeIdentity, refreshTools]);

  const requestDingTalkRefresh = useCallback(() => {
    if (
      !sessionExists
      || dingtalkRefreshInFlight.current
      || toolsLoading
      || runtimeIdentityLoading
      || pluginStatusLoading
      || pluginOperation !== null
      || dwsOperationActive
    ) return;
    dingtalkRefreshInFlight.current = true;
    setDingTalkRefreshPending(true);
    setPluginError(null);
    void refreshDingTalkState()
      .catch((error) => setPluginError(errorMessage(error)))
      .finally(() => {
        dingtalkRefreshInFlight.current = false;
        setDingTalkRefreshPending(false);
      });
  }, [dwsOperationActive, pluginOperation, pluginStatusLoading, refreshDingTalkState, runtimeIdentityLoading, sessionExists, toolsLoading]);

  const restartAndRefreshDingTalkGateway = useCallback(async () => {
    const result = await gatewayLifecycle.restart('business-applications-dingtalk');
    if (!result.success) throw new Error(result.error ?? t('gateway.progress.connectionFailed'));
    await refreshAll();
    await refreshDingTalkState();
  }, [refreshDingTalkState, t]);

  const currentEventConnectionId = identity?.verified ? identity.connectionId : null;
  const eventConfigurationForCurrentConnection = selectDingTalkEventConfigurationForConnection(
    eventConfiguration,
    eventConfigurationConnectionId,
    currentEventConnectionId,
  );
  const savedEventConfigurationForCurrentConnection = selectDingTalkEventConfigurationForConnection(
    savedEventConfiguration,
    eventConfigurationConnectionId,
    currentEventConnectionId,
  );
  const currentDingTalkEventInvalidation = identity?.verified
    && savedEventConfigurationForCurrentConnection?.enabled
    && latestDingTalkEventInvalidation?.connectionId === identity.connectionId
    ? latestDingTalkEventInvalidation
    : null;
  const eventSnapshotReadContext = useMemo(() => (
    view === 'runtime'
      && identity?.verified
      && savedEventConfigurationForCurrentConnection?.enabled
      ? createDingTalkEventSnapshotReadContext({
          connectionId: identity.connectionId,
          configuration: savedEventConfigurationForCurrentConnection,
          minimumRevision: currentDingTalkEventInvalidation?.revision ?? null,
          runtimeGeneration: currentDingTalkEventInvalidation?.runtimeGeneration ?? null,
          invalidationConfigurationDigest:
            currentDingTalkEventInvalidation?.configurationDigest ?? null,
        })
      : null
  ), [
    currentDingTalkEventInvalidation?.revision,
    currentDingTalkEventInvalidation?.runtimeGeneration,
    currentDingTalkEventInvalidation?.configurationDigest,
    identity?.connectionId,
    identity?.verified,
    savedEventConfigurationForCurrentConnection,
    view,
  ]);
  eventSnapshotContextRef.current = eventSnapshotReadContext;

  const reloadEventConfiguration = useCallback(async () => {
    const connectionId = identity?.verified ? identity.connectionId : null;
    const requestId = ++eventConfigurationRequest.current;
    eventSnapshotRequests.current.invalidate();
    eventSnapshotContextRef.current = null;
    setEventConfigurationNotice(null);
    setEventConfigurationConnectionId(null);
    setEventConfiguration(null);
    setSavedEventConfiguration(null);
    if (!connectionId) {
      setEventConfigurationError(null);
      setEventConfigurationLoading(false);
      return;
    }
    setEventConfigurationLoading(true);
    try {
      const loaded = await loadDingTalkEventConfiguration(openClawRuntimeConfigClient);
      if (
        requestId !== eventConfigurationRequest.current
        || getCurrentRuntimeIdentity()?.connectionId !== connectionId
      ) return;
      setEventConfiguration(loaded);
      setSavedEventConfiguration(loaded);
      setEventConfigurationConnectionId(connectionId);
      setEventConfigurationError(null);
    } catch (error) {
      if (
        requestId !== eventConfigurationRequest.current
        || getCurrentRuntimeIdentity()?.connectionId !== connectionId
      ) return;
      setEventConfiguration(null);
      setSavedEventConfiguration(null);
      setEventConfigurationError(errorMessage(error));
    } finally {
      if (requestId === eventConfigurationRequest.current) setEventConfigurationLoading(false);
    }
  }, [identity?.connectionId, identity?.verified]);

  const reloadEventSnapshot = useCallback(async () => {
    const context = eventSnapshotReadContext;
    if (!context) {
      eventSnapshotRequests.current.invalidate();
      setEventSnapshot(null);
      setEventSnapshotError(null);
      setEventSnapshotLoading(false);
      return;
    }
    const request = eventSnapshotRequests.current.begin(context);
    setEventSnapshotLoading(true);
    setEventSnapshotError(null);
    try {
      const configurationDigest = await digestDingTalkEventConfiguration(
        context.configurationCanonical,
      );
      if (
        configurationDigest !== context.invalidationConfigurationDigest
        && context.runtimeGeneration !== null
      ) {
        throw new DingTalkEventSnapshotContextError();
      }
      if (!eventSnapshotRequests.current.accepts(request, eventSnapshotContextRef.current)) return;
      const snapshot = await openClawDingTalkEventClient.get(context.afterSequence, 20);
      assertDingTalkEventSnapshotContext(snapshot, context, configurationDigest);
      if (!eventSnapshotRequests.current.accepts(request, eventSnapshotContextRef.current)) return;
      setEventSnapshot(snapshot);
    } catch (error) {
      if (!eventSnapshotRequests.current.accepts(request, eventSnapshotContextRef.current)) return;
      setEventSnapshotError(errorMessage(error));
    } finally {
      if (eventSnapshotRequests.current.accepts(request, eventSnapshotContextRef.current)) {
        setEventSnapshotLoading(false);
      }
    }
  }, [eventSnapshotReadContext]);

  useEffect(() => {
    if (view !== 'runtime') return;
    void reloadEventConfiguration();
    return () => {
      eventConfigurationRequest.current += 1;
    };
  }, [reloadEventConfiguration, view]);

  const persistEventConfiguration = useCallback(async () => {
    if (
      !eventConfiguration
      || !identity?.verified
      || !identity.desktopMutationAllowed
      || eventConfigurationConnectionId !== identity.connectionId
    ) return;
    const connectionId = identity.connectionId;
    const targetFingerprint = identity.targetFingerprint;
    eventSnapshotRequests.current.invalidate();
    eventSnapshotContextRef.current = null;
    setEventSnapshot(null);
    setEventSnapshotError(null);
    setEventSnapshotLoading(false);
    setEventConfigurationSaving(true);
    setEventConfigurationError(null);
    setEventConfigurationNotice(null);
    try {
      const desired = normalizeDingTalkEventConfiguration(eventConfiguration);
      if (desired.enabled && !runtimeIdentity?.profiles.some((candidate) => (
        candidate.status === 'active' && candidate.profile === desired.profile
      ))) {
        throw new Error(t('businessApplications.events.activeProfileRequired'));
      }
      const result = await applyDingTalkEventConfiguration({
        client: openClawRuntimeConfigClient,
        value: desired,
        expectedConnectionId: connectionId,
        expectedTargetFingerprint: targetFingerprint,
        currentIdentity: getCurrentRuntimeIdentity,
        restart: restartAndRefreshDingTalkGateway,
      });
      setEventConfiguration(result.configuration);
      setSavedEventConfiguration(result.configuration);
      const confirmedIdentity = getCurrentRuntimeIdentity();
      setEventConfigurationConnectionId(
        confirmedIdentity?.verified ? confirmedIdentity.connectionId : null,
      );
      if (!result.changed) {
        setEventConfigurationNotice(t('businessApplications.events.unchanged'));
        return;
      }
      setEventConfigurationNotice(t('businessApplications.events.saved'));
    } catch (error) {
      if (error instanceof DingTalkEventConfigurationAppliedError) {
        setEventConfiguration(error.configuration);
        setSavedEventConfiguration(error.configuration);
        setEventConfigurationConnectionId(null);
        setEventConfigurationError(error.reason === 'runtime_changed'
          ? t('businessApplications.events.runtimeChanged')
          : t('businessApplications.events.savedRestartFailed', {
              error: errorMessage(error),
            }));
      } else {
        setEventConfigurationError(errorMessage(error));
      }
    } finally {
      setEventConfigurationSaving(false);
    }
  }, [eventConfiguration, eventConfigurationConnectionId, identity, restartAndRefreshDingTalkGateway, runtimeIdentity?.profiles, t]);

  const saveEventConfiguration = useCallback(() => {
    if (!eventConfiguration) return;
    showConfirm(
      t('businessApplications.events.saveConfirmTitle'),
      t(eventConfiguration.enabled
        ? 'businessApplications.events.saveConfirmMessage'
        : 'businessApplications.events.disableConfirmMessage'),
      () => { void persistEventConfiguration(); },
    );
  }, [eventConfiguration, persistEventConfiguration, t]);

  const finalizeDwsOperation = useCallback(async (payload: DwsOperationFinished) => {
    if (payload.cancelled || !payload.success) {
      if (payload.kind === 'authorize') {
        const diagnosis = diagnoseDwsAuthorizationFailure(
          dwsEventCache.current.events[payload.operationId] ?? [],
        );
        setDwsAuthorizationFailure(diagnosis);
        if (diagnosis?.stage === 'local-credential-save') {
          setDwsOutput((current) => [
            ...current,
            t('businessApplications.dws.credentialSaveFailure'),
          ].slice(-400));
        }
      } else if (payload.kind === 'install') {
        setDwsAuthorizationFailure(null);
      }
      const phase = payload.cancelled ? 'cancelled' : 'failed';
      setDwsOperation((current) => current?.id === payload.operationId
        ? {
            ...current,
            phase,
            message: t(payload.cancelled
              ? 'businessApplications.dws.cancelled'
              : 'businessApplications.dws.failed'),
          }
        : current);
      if (payload.cancelled && dwsDismissAfterCancellation.current) {
        dwsDismissAfterCancellation.current = false;
        setDwsOperation(null);
      }
      await refreshDingTalkState();
      return;
    }

    try {
      if (payload.kind === 'install') {
        setDwsOperation((current) => current?.id === payload.operationId
          ? { ...current, message: t('businessApplications.dws.configuring') }
          : current);
        if (payload.dwsPath) {
          await configureDingTalkDwsPath(gateway, payload.dwsPath);
        }
        await restartAndRefreshDingTalkGateway();
      } else {
        await refreshDingTalkState();
      }
      setDwsAuthorizationFailure(null);
      setDwsOperation((current) => current?.id === payload.operationId
        ? {
            ...current,
            phase: 'completed',
            message: t(payload.kind === 'install'
              ? 'businessApplications.dws.installCompleted'
              : payload.kind === 'resetAuth'
                ? 'businessApplications.dws.resetCompleted'
                : payload.kind === 'switchProfile'
                  ? 'businessApplications.dws.switchProfileCompleted'
                  : payload.kind === 'logoutProfile'
                    ? 'businessApplications.dws.logoutProfileCompleted'
                    : 'businessApplications.dws.authorizeCompleted'),
          }
        : current);
    } catch (error) {
      const detail = errorMessage(error);
      setDwsOutput((current) => [...current, detail].slice(-400));
      setDwsOperation((current) => current?.id === payload.operationId
        ? { ...current, phase: 'failed', message: t('businessApplications.dws.integrationFailed') }
        : current);
    }
  }, [refreshDingTalkState, restartAndRefreshDingTalkGateway, t]);

  useEffect(() => {
    void refreshPluginStatus();
  }, [refreshPluginStatus]);

  useEffect(() => {
    const outputUnlisten = subscribeTauriEvent<DwsOperationOutput>('dws-operation-output', (event) => {
      const payload = event.payload;
      if (dwsFinalizedOperationIds.current.has(payload.operationId)) return;
      const line = formatDwsOperationOutput(
        payload,
        t('businessApplications.dws.diagnosticPrefix'),
      );
      const cached = cacheDwsOperationOutput(dwsEventCache.current, payload, line);
      setDwsOperation((current) => {
        if (!current || current.id !== payload.operationId) return current;
        setDwsOutput(cached);
        return current;
      });
    });
    const finishedUnlisten = subscribeTauriEvent<DwsOperationFinished>('dws-operation-finished', (event) => {
      const payload = event.payload;
      if (dwsFinalizedOperationIds.current.has(payload.operationId)) return;
      cacheDwsOperationFinished(dwsEventCache.current, payload);
      if (!payload.success && payload.message) {
        const cached = cacheDwsOperationOutput(dwsEventCache.current, {
          operationId: payload.operationId,
          stream: 'status',
          line: payload.message,
        }, payload.message);
        setDwsOperation((current) => {
          if (!current || current.id !== payload.operationId) return current;
          setDwsOutput(cached);
          return current;
        });
      }
      setDwsCompletionRevision((current) => current + 1);
    });
    return () => {
      outputUnlisten();
      finishedUnlisten();
    };
  }, [finalizeDwsOperation, t]);

  useEffect(() => {
    if (!dwsOperation?.id) return;
    const finished = dwsEventCache.current.finished[dwsOperation.id];
    if (!finished || dwsFinalizedOperationIds.current.has(finished.operationId)) return;
    rememberFinalizedDwsOperation(dwsFinalizedOperationIds.current, finished.operationId);
    void finalizeDwsOperation(finished)
      .catch((error) => setPluginError(errorMessage(error)))
      .finally(() => releaseDwsOperationCache(dwsEventCache.current, finished.operationId));
  }, [dwsCompletionRevision, dwsOperation, finalizeDwsOperation]);

  useEffect(() => {
    if (selectedTool) return;
    setSelectedId(authenticatedCatalogTools[0]?.entry.id ?? null);
  }, [authenticatedCatalogTools, selectedTool]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 980) setLeftCollapsed(true);
      if (window.innerWidth < 1160) setRightCollapsed(true);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const loadSchema = useCallback(async (tool: DingTalkEffectiveTool | null = selectedTool) => {
    if (!tool || tool.entry.id === DINGTALK_RUNTIME_STATUS_TOOL) {
      schemaRequests.current.invalidate();
      setSchema(null);
      setSchemaError(null);
      setSchemaLoading(false);
      return;
    }
    if (!sessionExists || !schemaToolAvailable) {
      schemaRequests.current.invalidate();
      setSchema(null);
      setSchemaError(t('businessApplications.workbench.validation.schemaToolUnavailable'));
      setSchemaLoading(false);
      return;
    }
    const request = schemaRequests.current.begin(activeSessionKey, tool.entry.id);
    setSchemaLoading(true);
    setSchemaError(null);
    try {
      const result = await invokeOpenClawTool({
        name: DINGTALK_TOOL_SCHEMA_TOOL,
        sessionKey: activeSessionKey,
        args: { toolName: tool.entry.id },
      });
      if (!result.ok) throw new Error(result.error?.message ?? t('businessApplications.workbench.validation.schemaLoadFailed'));
      const nextSchema = parseDingTalkToolSchemaOutput(result.output);
      if (schemaRequests.current.accepts(request, activeSessionKey, tool.entry.id)) {
        setSchema(nextSchema);
      }
    } catch (error) {
      if (schemaRequests.current.accepts(request, activeSessionKey, tool.entry.id)) {
        setSchema(null);
        setSchemaError(
          error instanceof DingTalkToolContractError
            ? t('businessApplications.workbench.validation.schemaContractInvalid')
            : errorMessage(error),
        );
      }
    } finally {
      if (schemaRequests.current.accepts(request, activeSessionKey, tool.entry.id)) {
        setSchemaLoading(false);
      }
    }
  }, [activeSessionKey, schemaToolAvailable, selectedTool, sessionExists, t]);

  const selectTool = useCallback((tool: DingTalkEffectiveTool) => {
    schemaRequests.current.invalidate();
    setSelectedId(tool.entry.id);
    setArgumentsJson('{}');
    setInvocationOutput(undefined);
    setInvocationError(null);
    setSchema(null);
    setSchemaError(null);
    setSchemaLoading(false);
    if (rightCollapsed) setRightCollapsed(false);
  }, [rightCollapsed]);

  const changeProfile = useCallback((value: string) => {
    setProfile(value);
    setArgumentsJson('{}');
    setInvocationOutput(undefined);
    setInvocationError(null);
  }, []);

  useEffect(() => {
    const previous = previousExecutionProfile.current;
    previousExecutionProfile.current = executionProfile;
    if (previous === null || previous === executionProfile) return;
    setArgumentsJson('{}');
    setInvocationOutput(undefined);
    setInvocationError(null);
  }, [executionProfile]);

  useEffect(() => {
    setProfile((current) => current === executionProfile ? current : executionProfile);
  }, [executionProfile]);

  useEffect(() => {
    if (!selectedTool || selectedTool.entry.id === DINGTALK_RUNTIME_STATUS_TOOL) return;
    void loadSchema(selectedTool);
  }, [loadSchema, selectedTool]);

  const parsedArguments = useMemo(() => {
    try {
      return { value: parseToolArguments(argumentsJson), error: null };
    } catch (error) {
      return { value: null, error: errorMessage(error) };
    }
  }, [argumentsJson]);

  const missingRequiredParameters = useMemo(() => {
    if (!schema || !parsedArguments.value) return [];
    return schema.parameters
      .filter((parameter) => parameter.required)
      .map((parameter) => parameter.property ?? parameter.name)
      .filter((name) => {
        const value = parsedArguments.value?.[name];
        return value === undefined || value === null || value === '';
      });
  }, [parsedArguments.value, schema]);

  const disabledReason = useMemo(() => {
    if (!selectedTool) return t('businessApplications.workbench.validation.selectTool');
    if (!sessionExists) return t('businessApplications.workbench.validation.sessionRequired');
    if (selectedTool.entry.deniedBySession) return t('businessApplications.workbench.validation.sessionDenied');
    if (selectedTool.effect === 'unknown' || !selectedTool.entry.risk) return t('businessApplications.workbench.validation.incompleteContract');
    if (selectedTool.entry.id === DINGTALK_RUNTIME_STATUS_TOOL) return null;
    if (!parseProfileReference(executionProfile)) return t('businessApplications.workbench.validation.profileRequired');
    if (schemaLoading) return t('businessApplications.workbench.validation.schemaLoading');
    if (schemaError) return t('businessApplications.workbench.validation.schemaUnavailable');
    if (!schema) return t('businessApplications.workbench.validation.schemaRequired');
    if (parsedArguments.error || !parsedArguments.value) return t('businessApplications.workbench.detail.argumentsInvalid');
    return missingRequiredParameters.length > 0
      ? t('businessApplications.workbench.detail.missingRequiredParameters', { parameters: missingRequiredParameters.join(', ') })
      : null;
  }, [executionProfile, missingRequiredParameters, parsedArguments, schema, schemaError, schemaLoading, selectedTool, sessionExists, t]);

  const performInvocation = useCallback(async () => {
    const tool = selectedTool;
    if (!tool || disabledReason) return;
    const risk = tool.entry.risk;
    if (!risk || tool.effect === 'unknown') return;
    const runtimeTool = tool.entry.id === DINGTALK_RUNTIME_STATUS_TOOL;
    const profileRef = runtimeTool ? null : parseProfileReference(executionProfile);
    const args = runtimeTool ? {} : { profile: profileRef, arguments: parsedArguments.value };
    const attemptId = createAttemptId();
    if (!attemptId) {
      setInvocationError(t('businessApplications.workbench.validation.idempotencyUnavailable'));
      return;
    }
    beginAttempt({
      id: attemptId,
      sessionKey: activeSessionKey,
      sessionId: activeSession?.sessionId ?? null,
      agentId: effective?.agentId ?? activeSession?.agentId ?? null,
      runtimeFingerprint: identity?.verified ? identity.targetFingerprint : null,
      runtimeConnectionId: identity?.verified ? identity.connectionId : null,
      toolName: tool.entry.id,
      toolLabel: tool.entry.label,
      profileRef,
      effect: tool.effect,
      risk,
      state: 'pending',
      startedAt: Date.now(),
    });
    setInvoking(true);
    setInvocationError(null);
    setInvocationOutput(undefined);
    try {
      const result = await invokeOpenClawTool({
        name: tool.entry.id,
        sessionKey: activeSessionKey,
        args,
        ...(tool.effect === 'write' ? { confirm: true } : {}),
        idempotencyKey: attemptId,
      });
      const dwsEvidence = parseDingTalkBusinessEvidence(result);
      const evidence = {
        gatewayToolName: result.toolName,
        ...(result.source ? { gatewaySource: result.source } : {}),
        ...(dwsEvidence.dwsCanonicalPath ? { dwsCanonicalPath: dwsEvidence.dwsCanonicalPath } : {}),
        ...(dwsEvidence.schemaDigest ? { schemaDigest: dwsEvidence.schemaDigest } : {}),
        ...(dwsEvidence.recoveryEventId ? { recoveryEventId: dwsEvidence.recoveryEventId } : {}),
        ...(dwsEvidence.verificationStatus ? { verificationStatus: dwsEvidence.verificationStatus } : {}),
        ...(dwsEvidence.verifierToolName ? { verifierToolName: dwsEvidence.verifierToolName } : {}),
        ...(dwsEvidence.verifierCanonicalPath ? { verifierCanonicalPath: dwsEvidence.verifierCanonicalPath } : {}),
        ...(dwsEvidence.verifierSchemaDigest ? { verifierSchemaDigest: dwsEvidence.verifierSchemaDigest } : {}),
        ...(dwsEvidence.resourceId ? { resourceId: dwsEvidence.resourceId } : {}),
      };
      setInvocationOutput(result);
      if (runtimeTool && result.ok && identity?.connectionId) {
        publishDingTalkRuntimeIdentityResult(
          identity.connectionId,
          activeSessionKey,
          result,
        );
      }
      if (result.requiresApproval) {
        settleAttempt(attemptId, {
          state: 'approval_required',
          ...(result.approvalId ? { approvalId: result.approvalId } : {}),
          evidence,
        });
      } else {
        const outcome = resolveDingTalkInvocationOutcome({
          effect: tool.effect,
          ok: result.ok,
          requiresApproval: false,
          ...(result.error?.code ? { errorCode: result.error.code } : {}),
          evidence: dwsEvidence,
        });
        settleAttempt(attemptId, {
          state: outcome.state,
          ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
          evidence,
          finishedAt: Date.now(),
        });
        if (!result.ok) {
          setInvocationError(result.error?.message ?? t('businessApplications.workbench.validation.toolInvocationFailed'));
        } else if (outcome.state === 'unknown') {
          setInvocationError(t('businessApplications.workbench.validation.writeVerificationUnknown'));
        } else if (outcome.state === 'succeeded_unverified') {
          setInvocationError(t('businessApplications.workbench.validation.writePostconditionUnverified'));
        }
      }
    } catch (error) {
      const code = errorCode(error);
      settleAttempt(attemptId, {
        state: tool.effect === 'write' ? 'unknown' : 'failed',
        errorCode: code,
        finishedAt: Date.now(),
      });
      setInvocationError(
        tool.effect === 'write'
          ? t('businessApplications.workbench.validation.writeResultUnverified', { error: errorMessage(error) })
          : errorMessage(error),
      );
    } finally {
      setInvoking(false);
    }
  }, [activeSession, activeSessionKey, beginAttempt, disabledReason, effective?.agentId, executionProfile, identity, parsedArguments.value, selectedTool, settleAttempt, t]);

  const invokeSelected = useCallback(() => {
    if (!selectedTool) return;
    if (selectedTool.effect !== 'write') {
      void performInvocation();
      return;
    }
    showConfirm(
      t('businessApplications.workbench.validation.writeConfirmTitle', { tool: selectedTool.entry.label }),
      t('businessApplications.workbench.validation.writeConfirmDescription'),
      performInvocation,
    );
  }, [performInvocation, selectedTool, t]);

  const performPluginInstallation = useCallback(async () => {
    setPluginInstallationProgress({ phase: 'checking', message: t('businessApplications.pluginInstall.progress.checking') });
    const current = getCurrentRuntimeIdentity();
    if (!current?.verified || !current.desktopMutationAllowed) {
      const message = dingtalkPluginInstallBlocker(current);
      setPluginError(message);
      setPluginInstallationProgress({ phase: 'failed', message });
      return;
    }
    setPluginOperation('installing');
    setPluginInstallationProgress({ phase: 'installing', message: t('businessApplications.pluginInstall.progress.installing') });
    try {
      const status = await installBundledDingTalkPlugin(current.targetFingerprint, current.connectionId);
      setPluginStatus(status);
      setPluginError(null);
      setPluginInstallationProgress({ phase: 'completed', message: t('businessApplications.pluginInstall.progress.completed') });
    } catch (error) {
      const message = errorMessage(error);
      setPluginError(message);
      setPluginInstallationProgress({ phase: 'failed', message });
    } finally {
      setPluginOperation(null);
    }
  }, [t]);

  const installPlugin = useCallback(() => {
    setPluginInstallationProgress({ phase: 'idle', message: null });
    setPluginInstallDialogOpen(true);
  }, []);

  const runDwsOperation = useCallback((kind: DwsOperationKind, operationProfile?: string) => {
    if (dwsOperationActive || !claimDwsOperationStart(dwsStartGuard)) return;
    const current = getCurrentRuntimeIdentity();
    if (!current?.verified || !current.desktopMutationAllowed) {
      setPluginError(dingtalkPluginInstallBlocker(current));
      releaseDwsOperationStart(dwsStartGuard);
      return;
    }
    setPluginError(null);
    if (kind !== 'resetAuth') setDwsAuthorizationFailure(null);
    dwsCancellationRequested.current = false;
    dwsDismissAfterCancellation.current = false;
    setDwsOutput([]);
    setDwsOperation({
      id: null,
      kind,
      phase: 'starting',
      message: t('businessApplications.dws.starting'),
    });
    void startDwsOperation(current.targetFingerprint, current.connectionId, kind, operationProfile)
      .then((started) => {
        const output = dwsEventCache.current.output[started.operationId] ?? [];
        const cancellationRequested = dwsCancellationRequested.current;
        setDwsOperation({
          id: started.operationId,
          kind: started.kind,
          phase: cancellationRequested ? 'cancelling' : 'running',
          message: cancellationRequested
            ? t('businessApplications.dws.cancelling')
            : started.kind === 'install'
              ? t('businessApplications.dws.installRunning')
              : started.kind === 'resetAuth'
                ? t('businessApplications.dws.resetRunning')
                : started.kind === 'switchProfile'
                  ? t('businessApplications.dws.switchProfileRunning')
                  : started.kind === 'logoutProfile'
                    ? t('businessApplications.dws.logoutProfileRunning')
                    : t('businessApplications.dws.authorizeRunning'),
        });
        setDwsOutput(output);
        if (cancellationRequested) {
          void cancelDwsOperation(started.operationId)
            .catch((error) => {
              dwsCancellationRequested.current = false;
              dwsDismissAfterCancellation.current = false;
              setDwsOperation((operation) => (
                operation?.id === started.operationId
                  ? { ...operation, phase: 'failed', message: errorMessage(error) }
                  : operation
              ));
            });
        }
      })
      .catch((error) => {
        dwsCancellationRequested.current = false;
        dwsDismissAfterCancellation.current = false;
        const message = errorMessage(error);
        setDwsOperation({ id: null, kind, phase: 'failed', message: t('businessApplications.dws.startFailed') });
        setDwsOutput([message]);
      })
      .finally(() => releaseDwsOperationStart(dwsStartGuard));
  }, [dwsOperationActive, t]);

  const resetDwsAuth = useCallback(() => {
    showConfirm(
      t('businessApplications.dws.resetConfirmTitle'),
      t('businessApplications.dws.resetConfirmMessage'),
      () => runDwsOperation('resetAuth'),
    );
  }, [runDwsOperation, t]);

  const logoutDwsProfile = useCallback((operationProfile: string) => {
    showConfirm(
      t('businessApplications.dws.logoutConfirmTitle'),
      t('businessApplications.dws.logoutConfirmMessage', { profile: operationProfile }),
      () => runDwsOperation('logoutProfile', operationProfile),
    );
  }, [runDwsOperation, t]);

  const cancelCurrentDwsOperation = useCallback((dismissWhenCancelled = false) => {
    const operation = dwsOperation;
    if (!operation || !isDwsOperationActive(operation.phase) || operation.phase === 'cancelling') return;
    dwsCancellationRequested.current = true;
    dwsDismissAfterCancellation.current ||= dismissWhenCancelled;
    setDwsOperation((current) => current === operation
      ? { ...current, phase: 'cancelling', message: t('businessApplications.dws.cancelling') }
      : current);
    if (!operation.id) return;
    void cancelDwsOperation(operation.id)
      .catch((error) => {
        dwsCancellationRequested.current = false;
        dwsDismissAfterCancellation.current = false;
        setDwsOperation((current) => current?.id === operation.id
          ? { ...current, phase: 'failed', message: errorMessage(error) }
          : current);
      });
  }, [dwsOperation, t]);

  const restartGateway = useCallback(async () => {
    setPluginOperation('restarting');
    try {
      await restartAndRefreshDingTalkGateway();
      setPluginError(null);
      return true;
    } catch (error) {
      setPluginError(errorMessage(error));
      return false;
    } finally {
      setPluginOperation(null);
    }
  }, [restartAndRefreshDingTalkGateway]);

  const selectedAuthorizationAgentId = authorizationTargetAgentId
    && authorizationAgentOptions.some((candidate) => candidate.id === authorizationTargetAgentId)
    ? authorizationTargetAgentId
    : activeAgentId;

  useEffect(() => {
    setAuthorizationTargetAgentId(null);
    setAuthorizationNotice(null);
  }, [activeSessionKey]);

  const authorizeSelectedAgent = useCallback(async (targetAgentId: string) => {
    const normalizedTargetAgentId = targetAgentId.trim();
    if (!normalizedTargetAgentId) {
      setPluginError(t('businessApplications.readiness.agentSelectionRequired'));
      return;
    }
    setPluginOperation('authorizing');
    setPluginError(null);
    setAuthorizationNotice(null);
    try {
      await authorizeDingTalkAgent(gateway, normalizedTargetAgentId, activeSessionKey);
      await restartAndRefreshDingTalkGateway();
      if (normalizedTargetAgentId !== activeAgentId) {
        setAuthorizationNotice(t('businessApplications.readiness.nonCurrentAgentConfigured', { agentId: normalizedTargetAgentId }));
        return;
      }
      const refreshedTools = useGatewayDataStore.getState().toolsEffective[activeSessionKey];
      if (!hasAvailableDingTalkRuntimeTool(refreshedTools?.groups)) {
        throw new Error(t('businessApplications.readiness.authorizationEffectMissing'));
      }
      setPluginError(null);
    } catch (error) {
      setPluginError(errorMessage(error));
    } finally {
      setPluginOperation(null);
    }
  }, [activeAgentId, activeSessionKey, restartAndRefreshDingTalkGateway, t]);

  const localInstallAvailable = Boolean(identity?.verified && identity.desktopMutationAllowed);
  const pluginNeedsInstall = Boolean(pluginStatus && (
    !pluginStatus.installed
      || !pluginStatus.enabled
      || !pluginStatus.loaded
      || pluginStatus.version !== pluginStatus.bundledVersion
  ));
  const refreshDisabled = !sessionExists
    || dingtalkRefreshPending
    || toolsLoading
    || runtimeIdentityLoading
    || pluginStatusLoading
    || pluginOperation !== null
    || dwsOperationActive;
  const eventConfigurationDirty = Boolean(
    eventConfigurationForCurrentConnection
    && savedEventConfigurationForCurrentConnection
    && JSON.stringify(eventConfigurationForCurrentConnection) !== JSON.stringify(savedEventConfigurationForCurrentConnection),
  );
  const eventConfigurationBusy = eventConfigurationSaving
    || pluginOperation !== null
    || dwsOperationActive
    || !identity?.verified
    || !identity.desktopMutationAllowed
    || eventConfigurationConnectionId !== identity.connectionId;
  useEffect(() => {
    if (!eventSnapshotReadContext) {
      eventSnapshotRequests.current.invalidate();
      setEventSnapshot(null);
      setEventSnapshotError(null);
      setEventSnapshotLoading(false);
      return;
    }
    void reloadEventSnapshot();
  }, [eventSnapshotReadContext, reloadEventSnapshot]);
  const headerStatus = dingtalkRefreshPending
    ? t('businessApplications.readiness.refreshing')
    : catalogAvailability === 'ready'
      ? t('businessApplications.workbench.status.ready', { count: authenticatedCatalogTools.length })
      : catalogLoading
        ? t('businessApplications.workbench.status.loading')
        : catalogAvailability === 'identity-error'
          ? t('businessApplications.workbench.status.identityError')
          : catalogAvailability === 'profile-required'
            ? t('businessApplications.workbench.status.profileRequired')
            : pluginStatusLoading
              ? t('businessApplications.workbench.status.pluginChecking')
              : pluginStatus?.installed
                ? t('businessApplications.workbench.status.pluginRestartPending')
                : localInstallAvailable
                  ? t('businessApplications.workbench.status.pluginMissing')
                  : t('businessApplications.workbench.status.toolsMissing');
  const pageTitle = view === 'activity'
    ? t('businessApplications.workbench.pageTitle.activity')
    : view === 'runtime'
      ? t('businessApplications.workbench.pageTitle.runtime')
      : t('businessApplications.workbench.pageTitle.tools');
  const readinessProps = {
    sessionExists,
    runtimeToolAvailable,
    agentRuntimeVerified,
    runtime: runtimeIdentity,
    runtimeError: runtimeIdentityError,
    operationError: pluginError,
    operationNotice: authorizationNotice,
    pluginNeedsInstall,
    pluginStatusPending: localInstallAvailable && pluginStatusLoading,
    restartRequired: Boolean(pluginStatus?.restartRequired),
    agentId: activeAgentId,
    authorizationAgentOptions,
    authorizationTargetAgentId: selectedAuthorizationAgentId,
    installAvailable: localInstallAvailable,
    installationProgress: pluginInstallationProgress,
    dwsOperation,
    dwsOutput,
    dwsAuthorizationFailure,
    selectedProfile: executionProfile,
    busy: pluginOperation !== null || toolsLoading || runtimeIdentityLoading || dwsOperationActive,
    refreshing: dingtalkRefreshPending,
    operation: pluginOperation,
    sessionLabel: sessionExists ? activeSessionKey : null,
    effectiveToolCount: allTools.length,
    pluginVersion: pluginStatus?.version ?? null,
    bundledPluginVersion: pluginStatus?.bundledVersion ?? null,
    onRefresh: requestDingTalkRefresh,
    onInstallPlugin: installPlugin,
    onAuthorizeAgent: (agentId: string) => void authorizeSelectedAgent(agentId),
    onAuthorizationTargetAgentChange: setAuthorizationTargetAgentId,
    onRestartGateway: () => { void restartGateway(); },
    onInstallDws: () => runDwsOperation('install'),
    onAuthorizeDws: () => runDwsOperation('authorize'),
    onResetDwsAuth: resetDwsAuth,
    onSelectedProfileChange: setProfile,
    onSwitchDwsProfile: (operationProfile: string) => runDwsOperation('switchProfile', operationProfile),
    onLogoutDwsProfile: logoutDwsProfile,
    onCancelDws: cancelCurrentDwsOperation,
    onDismissDws: () => {
      dwsDismissAfterCancellation.current = false;
      setDwsOperation(null);
    },
  };

  return (
    <PageTransition className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-aegis-bg">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-aegis-border bg-aegis-surface/55 px-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-aegis-primary/25 bg-aegis-primary/10 text-aegis-primary"><Building2 size={15} /></span>
        <div className="min-w-0">
          <h1 className="truncate text-[12.5px] font-semibold text-aegis-text">{pageTitle}</h1>
          <p className="truncate text-[9.5px] text-aegis-text-dim">{headerStatus}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <DingTalkRuntimeIdentity runtime={runtimeIdentity} />
          <IconButton
            aria-label={t(dingtalkRefreshPending ? 'businessApplications.readiness.refreshing' : 'businessApplications.readiness.refresh')}
            title={t('businessApplications.readiness.refreshTitle')}
            loading={dingtalkRefreshPending}
            disabled={refreshDisabled}
            onClick={requestDingTalkRefresh}
          >
            <RefreshCw size={13} />
          </IconButton>
        </div>
      </header>

      {view !== 'runtime' && <DingTalkReadinessPanel {...readinessProps} hideWhenReady />}
      <DingTalkPluginInstallDialog
        open={pluginInstallDialogOpen}
        progress={pluginInstallationProgress}
        busy={pluginOperation === 'installing'}
        onOpenChange={setPluginInstallDialogOpen}
        onConfirm={() => void performPluginInstallation()}
        onRestartGateway={() => {
          void restartGateway().then((success) => {
            if (success) setPluginInstallDialogOpen(false);
          });
        }}
      />

      {view === 'runtime' ? (
        <main className="min-h-0 flex-1 overflow-auto bg-aegis-surface/20">
          <DingTalkReadinessPanel {...readinessProps} variant="workspace" />
          <DingTalkEventSettingsPanel
            configuration={eventConfigurationForCurrentConnection}
            profiles={runtimeIdentity?.profiles ?? []}
            loading={eventConfigurationLoading}
            busy={eventConfigurationBusy}
            editable={Boolean(identity?.verified && identity.desktopMutationAllowed)}
            dirty={eventConfigurationDirty}
            error={eventConfigurationError}
            notice={eventConfigurationNotice}
            latestInvalidation={currentDingTalkEventInvalidation}
            eventSnapshot={eventSnapshot}
            eventSnapshotLoading={eventSnapshotLoading}
            eventSnapshotError={eventSnapshotError}
            onChange={(configuration) => {
              setEventConfiguration(configuration);
              setEventConfigurationError(null);
              setEventConfigurationNotice(null);
            }}
            onReload={() => { void reloadEventConfiguration(); }}
            onReloadEventSnapshot={() => { void reloadEventSnapshot(); }}
            onSave={saveEventConfiguration}
          />
        </main>
      ) : view === 'activity' ? (
        <main className="flex min-h-0 flex-1 bg-aegis-surface/20"><BusinessActivityList /></main>
      ) : (
        <div
          className="grid min-h-0 flex-1"
          style={{
            gridTemplateColumns: `${leftCollapsed ? 40 : leftWidth}px minmax(0,1fr) ${rightCollapsed ? 40 : rightWidth}px`,
          }}
        >
          <FilterPane
            width={leftWidth}
            collapsed={leftCollapsed}
            search={search}
            domain={domain}
            effect={effect}
            domainCounts={domainCounts}
            effectCounts={effectCounts}
            filteredCount={filteredTools.length}
            onWidthChange={setLeftWidth}
            onCollapsedChange={setLeftCollapsed}
            onSearchChange={setSearch}
            onDomainChange={setDomain}
            onEffectChange={setEffect}
            onReset={clearFilters}
          />
          <main className="flex min-h-0 min-w-0 flex-col bg-aegis-surface/20">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-aegis-border px-3">
              <div className="flex min-w-0 items-center gap-2 text-[10.5px] text-aegis-text-dim">
                <span className="font-medium text-aegis-text-secondary">{t('businessApplications.workbench.currentProfile')}</span>
                <span className="max-w-[320px] truncate font-mono" title={executionProfile}>{profileAuthenticated ? executionProfile : t('businessApplications.workbench.profile.unverified')}</span>
              </div>
              <span className="text-[10px] tabular-nums text-aegis-text-dim">{filteredTools.length} / {authenticatedCatalogTools.length}</span>
            </div>
            {toolsError && <div className="border-b border-aegis-danger/25 bg-aegis-danger/[0.06] px-3 py-1.5 text-[10px] text-aegis-danger">{toolsError}</div>}
            <DingTalkToolTable
              tools={filteredTools}
              selectedId={selectedId}
              loading={catalogLoading}
              emptyTitle={catalogAvailability === 'no-session'
                ? t('businessApplications.workbench.catalog.noSessionTitle')
                : catalogAvailability === 'identity-error'
                  ? t('businessApplications.workbench.catalog.identityErrorTitle')
                  : catalogAvailability === 'profile-required'
                    ? t('businessApplications.workbench.catalog.profileRequiredTitle')
                    : catalogAvailability === 'no-runtime-tool'
                      ? t('businessApplications.workbench.catalog.noRuntimeToolTitle')
                      : t('businessApplications.workbench.catalog.noToolsTitle')}
              emptyMessage={catalogAvailability === 'identity-error'
                ? t('businessApplications.workbench.catalog.identityErrorDescription')
                : catalogAvailability === 'profile-required'
                  ? t('businessApplications.workbench.catalog.profileRequiredDescription')
                  : catalogAvailability === 'no-session'
                    ? t('businessApplications.workbench.catalog.noSessionDescription')
                    : t('businessApplications.workbench.catalog.noToolsDescription')}
              onSelect={selectTool}
            />
          </main>
          <DingTalkToolDetail
            tool={selectedTool}
            width={rightWidth}
            collapsed={rightCollapsed}
            profile={executionProfile}
            profiles={runtimeIdentity?.profiles ?? []}
            argumentsJson={argumentsJson}
            schema={schema}
            schemaLoading={schemaLoading}
            schemaError={schemaError}
            invocationOutput={invocationOutput}
            invocationError={invocationError}
            invoking={invoking}
            disabledReason={disabledReason}
            argumentsInvalid={Boolean(parsedArguments.error)}
            missingRequiredParameters={missingRequiredParameters}
            onWidthChange={setRightWidth}
            onCollapsedChange={setRightCollapsed}
            onProfileChange={changeProfile}
            onArgumentsChange={setArgumentsJson}
            onLoadSchema={() => void loadSchema()}
            onInvoke={invokeSelected}
          />
        </div>
      )}
    </PageTransition>
  );
}
