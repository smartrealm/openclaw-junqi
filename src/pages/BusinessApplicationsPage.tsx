import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import clsx from 'clsx';
import { useLocation } from 'react-router-dom';
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
import { BusinessActivityList } from '@/components/BusinessApplications/BusinessActivityList';
import {
  DINGTALK_RUNTIME_STATUS_TOOL,
  DINGTALK_TOOL_SCHEMA_TOOL,
  collectDingTalkTools,
  dingTalkDomainLabel,
  parseDingTalkBusinessEvidence,
  parseDingTalkToolSchemaOutput,
  parseDingTalkRuntimeOutput,
  parseProfileReference,
  parseToolArguments,
  type DingTalkDomain,
  type DingTalkEffectiveTool,
  type DingTalkToolSchemaProjection,
  type DingTalkRuntimeIdentityProjection,
} from '@/business-applications/dingtalkTools';
import { dingtalkPluginInstallBlocker } from '@/business-applications/dingtalkPluginInstall';
import { authorizeDingTalkAgent } from '@/business-applications/dingtalkAgentAuthorization';
import { waitForDingTalkGatewayReconnect } from '@/business-applications/dingtalkGatewayReconnect';
import { useBusinessActivityStore } from '@/business-applications/activityStore';
import { parseBusinessApplicationsView } from '@/business-applications/businessApplicationsView';
import {
  ensureToolsEffectiveFresh,
  invokeOpenClawTool,
  refreshAll,
  useGatewayDataStore,
} from '@/stores/gatewayDataStore';
import { useChatStore } from '@/stores/chatStore';
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
import { restartSelectedGatewayRuntime } from '@/services/gateway/gatewayProcessObservation';
import { gateway } from '@/services/gateway';
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
  'runtime',
];

function domainFilterLabel(domain: DomainFilter): string {
  return domain === 'all' ? '全部' : dingTalkDomainLabel(domain);
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'UNEXPECTED_FAILURE';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createAttemptId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('当前环境无法生成业务操作幂等标识');
  }
  return globalThis.crypto.randomUUID();
}

function readDingTalkGatewayReconnectSnapshot() {
  const currentIdentity = getCurrentRuntimeIdentity();
  return {
    connected: gateway.getStatus().connected,
    connectionId: gateway.captureConnectionId(),
    identityConnectionId: currentIdentity?.connectionId ?? null,
    identityVerified: currentIdentity?.verified === true,
  };
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
  if (collapsed) {
    return (
      <aside className="flex min-h-0 flex-col items-center border-r border-aegis-border bg-aegis-surface/55 py-2">
        <IconButton aria-label="展开筛选" title="展开筛选" onClick={() => onCollapsedChange(false)}>
          <Filter size={14} />
        </IconButton>
        <span className="mt-2 font-mono text-[9px] tabular-nums text-aegis-text-dim">{filteredCount}</span>
        <span className="mt-3 text-[10px] tracking-[0.18em] text-aegis-text-dim" style={{ writingMode: 'vertical-rl' }}>筛选</span>
      </aside>
    );
  }
  const filtersActive = search.trim() !== '' || domain !== 'all' || effect !== 'all';
  return (
    <aside className="relative min-h-0 overflow-y-auto border-r border-aegis-border bg-aegis-surface/55 p-3">
      <PaneResizeHandle side="left" value={width} min={208} max={340} label="调整筛选栏宽度" onChange={onWidthChange} />
      <div className="flex h-7 items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-aegis-text-secondary"><SlidersHorizontal size={13} />工具范围</span>
        <IconButton aria-label="收起筛选" title="收起筛选" onClick={() => onCollapsedChange(true)}><PanelLeftClose size={14} /></IconButton>
      </div>
      <label className="mt-3 block text-[10px] font-medium text-aegis-text-dim" htmlFor="dingtalk-tool-search">搜索工具</label>
      <div className="relative mt-1">
        <Search size={12} className="pointer-events-none absolute left-2 top-2 text-aegis-text-dim" />
        <input
          id="dingtalk-tool-search"
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="名称或描述"
          className="h-7 w-full rounded-md border border-aegis-border bg-aegis-bg pl-7 pr-2 text-[10.5px] text-aegis-text outline-none placeholder:text-aegis-text-dim focus:border-aegis-primary/60 focus:ring-1 focus:ring-aegis-primary/25"
        />
      </div>
      <fieldset className="mt-4">
        <legend className="text-[10px] font-medium text-aegis-text-dim">业务域</legend>
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
        <legend className="text-[10px] font-medium text-aegis-text-dim">操作效果</legend>
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
              <span>{item === 'all' ? '全部' : item === 'read' ? '读取' : '写入'}</span>
              <span className="font-mono tabular-nums opacity-70">{effectCounts[item]}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 border-t border-aegis-border pt-3">
        <div className="flex items-center justify-between gap-2 text-[9.5px] text-aegis-text-dim">
          <span>当前结果</span>
          <span className="font-mono tabular-nums">{filteredCount} / {domainCounts.all}</span>
        </div>
        <p className="mt-1 text-[9.5px] leading-4 text-aegis-text-dim">仅筛选当前 Session 的真实 <code className="font-mono text-aegis-text-secondary">tools.effective</code> 投影。</p>
        {filtersActive && (
          <button
            type="button"
            onClick={onReset}
            className="mt-2 text-[10px] text-aegis-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
          >
            清除筛选
          </button>
        )}
      </div>
    </aside>
  );
}

export function BusinessApplicationsPage() {
  const location = useLocation();
  const identity = useRuntimeIdentitySnapshot();
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const sessions = useGatewayDataStore((state) => state.sessions);
  const effective = useGatewayDataStore((state) => state.toolsEffective[activeSessionKey]);
  const toolsLoading = useGatewayDataStore((state) => (
    state.toolsEffectiveLoading && state.toolsEffectiveLoadingSessionKey === activeSessionKey
  ));
  const toolsError = useGatewayDataStore((state) => state.toolsEffectiveError);
  const sessionExists = sessions.some((session) => session.key === activeSessionKey);
  const activeSession = sessions.find((session) => session.key === activeSessionKey) ?? null;
  const activeAgentId = effective?.agentId ?? activeSession?.agentId ?? null;
  const allTools = useMemo(() => collectDingTalkTools(effective?.groups), [effective]);
  const rawEffectiveTools = useMemo(
    () => effective?.groups.flatMap((group) => group.tools) ?? [],
    [effective],
  );
  const schemaToolAvailable = rawEffectiveTools.some((tool) => tool.id === DINGTALK_TOOL_SCHEMA_TOOL && !tool.deniedBySession);
  const runtimeToolAvailable = rawEffectiveTools.some((tool) => tool.id === DINGTALK_RUNTIME_STATUS_TOOL && !tool.deniedBySession);

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
  const [pluginOperation, setPluginOperation] = useState<'installing' | 'authorizing' | 'restarting' | null>(null);
  const [pluginInstallationProgress, setPluginInstallationProgress] = useState<DingTalkPluginInstallProgress>({ phase: 'idle', message: null });
  const [pluginInstallDialogOpen, setPluginInstallDialogOpen] = useState(false);
  const [dwsOperation, setDwsOperation] = useState<DingTalkDwsOperationPresentation | null>(null);
  const [dwsOutput, setDwsOutput] = useState<string[]>([]);
  const dwsOutputCache = useRef<Record<string, string[]>>({});
  const [runtimeIdentity, setRuntimeIdentity] = useState<DingTalkRuntimeIdentityProjection | null>(null);
  const [runtimeIdentityError, setRuntimeIdentityError] = useState<string | null>(null);

  const beginAttempt = useBusinessActivityStore((state) => state.begin);
  const settleAttempt = useBusinessActivityStore((state) => state.settle);

  const selectedTool = allTools.find((tool) => tool.entry.id === selectedId) ?? null;
  const filteredTools = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return allTools.filter((tool) => {
      if (domain !== 'all' && tool.domain !== domain) return false;
      if (effect !== 'all' && tool.effect !== effect) return false;
      if (!query) return true;
      return `${tool.entry.label}\n${tool.entry.description}\n${tool.entry.id}`.toLocaleLowerCase().includes(query);
    });
  }, [allTools, domain, effect, search]);
  const domainCounts = useMemo(() => {
    const counts: Record<DomainFilter, number> = {
      all: allTools.length,
      contact: 0,
      approval: 0,
      attendance: 0,
      calendar: 0,
      todo: 0,
      runtime: 0,
      unknown: 0,
    };
    for (const tool of allTools) counts[tool.domain] += 1;
    return counts;
  }, [allTools]);
  const effectCounts = useMemo(() => ({
    all: allTools.length,
    read: allTools.filter((tool) => tool.effect === 'read').length,
    write: allTools.filter((tool) => tool.effect === 'write').length,
  }), [allTools]);
  const clearFilters = useCallback(() => {
    setSearch('');
    setDomain('all');
    setEffect('all');
  }, []);

  const refreshTools = useCallback(async () => {
    const currentSessionExists = useGatewayDataStore.getState().sessions
      .some((session) => session.key === activeSessionKey);
    if (!currentSessionExists || !activeSessionKey) return;
    await ensureToolsEffectiveFresh(activeSessionKey, 0);
  }, [activeSessionKey]);

  const refreshRuntimeIdentity = useCallback(async (useFreshToolSnapshot = false) => {
    const currentStore = useGatewayDataStore.getState();
    const currentSessionExists = currentStore.sessions.some((session) => session.key === activeSessionKey);
    const freshTools = currentStore.toolsEffective[activeSessionKey]?.groups.flatMap((group) => group.tools) ?? [];
    const currentRuntimeToolAvailable = useFreshToolSnapshot
      ? freshTools.some((tool) => tool.id === DINGTALK_RUNTIME_STATUS_TOOL && !tool.deniedBySession)
      : runtimeToolAvailable;
    if (!currentSessionExists || !currentRuntimeToolAvailable) {
      setRuntimeIdentity(null);
      setRuntimeIdentityError(null);
      return;
    }
    try {
      const result = await invokeOpenClawTool({
        name: DINGTALK_RUNTIME_STATUS_TOOL,
        sessionKey: activeSessionKey,
        args: {},
      });
      if (!result.ok) throw new Error(result.error?.message ?? 'DWS 身份读取失败');
      setRuntimeIdentity(parseDingTalkRuntimeOutput(result));
      setRuntimeIdentityError(null);
    } catch (error) {
      setRuntimeIdentity(null);
      setRuntimeIdentityError(errorMessage(error));
    }
  }, [activeSessionKey, runtimeToolAvailable]);

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
      refreshRuntimeIdentity(true),
    ]);
  }, [refreshPluginStatus, refreshRuntimeIdentity, refreshTools]);

  useEffect(() => {
    void refreshTools();
  }, [refreshTools]);

  useEffect(() => {
    void refreshRuntimeIdentity();
  }, [refreshRuntimeIdentity]);

  useEffect(() => {
    void refreshPluginStatus();
  }, [refreshPluginStatus]);

  useEffect(() => {
    const outputUnlisten = subscribeTauriEvent<DwsOperationOutput>('dws-operation-output', (event) => {
      const payload = event.payload;
      const line = `${payload.stream === 'stderr' ? '[错误] ' : ''}${payload.line}`;
      const cached = [...(dwsOutputCache.current[payload.operationId] ?? []), line].slice(-400);
      dwsOutputCache.current[payload.operationId] = cached;
      setDwsOperation((current) => {
        if (!current || current.id !== payload.operationId) return current;
        setDwsOutput(cached);
        return current;
      });
    });
    const finishedUnlisten = subscribeTauriEvent<DwsOperationFinished>('dws-operation-finished', (event) => {
      const payload = event.payload;
      setDwsOperation((current) => {
        if (!current || current.id !== payload.operationId) return current;
        const phase = payload.cancelled ? 'cancelled' : payload.success ? 'completed' : 'failed';
        return { ...current, phase, message: payload.message };
      });
      void refreshDingTalkState();
    });
    return () => {
      outputUnlisten();
      finishedUnlisten();
    };
  }, [refreshDingTalkState]);

  useEffect(() => {
    if (selectedTool) return;
    setSelectedId(allTools[0]?.entry.id ?? null);
  }, [allTools, selectedTool]);

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
      setSchema(null);
      setSchemaError(null);
      return;
    }
    if (!sessionExists || !schemaToolAvailable) {
      setSchema(null);
      setSchemaError('当前 Session 未报告钉钉参数 schema 工具。');
      return;
    }
    setSchemaLoading(true);
    setSchemaError(null);
    try {
      const result = await invokeOpenClawTool({
        name: DINGTALK_TOOL_SCHEMA_TOOL,
        sessionKey: activeSessionKey,
        args: { toolName: tool.entry.id },
      });
      if (!result.ok) throw new Error(result.error?.message ?? '参数 schema 读取失败');
      setSchema(parseDingTalkToolSchemaOutput(result.output));
    } catch (error) {
      setSchema(null);
      setSchemaError(errorMessage(error));
    } finally {
      setSchemaLoading(false);
    }
  }, [activeSessionKey, schemaToolAvailable, selectedTool, sessionExists]);

  const selectTool = useCallback((tool: DingTalkEffectiveTool) => {
    setSelectedId(tool.entry.id);
    setArgumentsJson('{}');
    setInvocationOutput(undefined);
    setInvocationError(null);
    setSchema(null);
    setSchemaError(null);
    if (rightCollapsed) setRightCollapsed(false);
  }, [rightCollapsed]);

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

  const disabledReason = useMemo(() => {
    if (!selectedTool) return '请先选择工具。';
    if (!sessionExists) return '需要一个真实 OpenClaw Session。';
    if (selectedTool.entry.deniedBySession) return '当前 Session 已拒绝此工具。';
    if (selectedTool.effect === 'unknown' || !selectedTool.entry.risk) return 'OpenClaw 未提供完整效果或风险契约。';
    if (selectedTool.entry.id === DINGTALK_RUNTIME_STATUS_TOOL) return null;
    if (!parseProfileReference(profile)) return '租户身份必须使用 corpId:userId 格式。';
    if (schemaLoading) return '正在核验当前 DWS 参数契约。';
    if (schemaError) return '当前 DWS 参数契约不可用。';
    if (!schema) return '执行前必须先读取当前 DWS 参数契约。';
    if (parsedArguments.error || !parsedArguments.value) return parsedArguments.error;
    const missing = schema.parameters
      .filter((parameter) => parameter.required)
      .map((parameter) => parameter.property ?? parameter.name)
      .filter((name) => {
        const value = parsedArguments.value?.[name];
        return value === undefined || value === null || value === '';
      });
    return missing.length > 0 ? `缺少必填参数：${missing.join('、')}` : null;
  }, [parsedArguments, profile, schema, schemaError, schemaLoading, selectedTool, sessionExists]);

  const performInvocation = useCallback(async () => {
    const tool = selectedTool;
    if (!tool || disabledReason) return;
    const risk = tool.entry.risk;
    if (!risk || tool.effect === 'unknown') return;
    const runtimeTool = tool.entry.id === DINGTALK_RUNTIME_STATUS_TOOL;
    const profileRef = runtimeTool ? null : parseProfileReference(profile);
    const args = runtimeTool ? {} : { profile: profileRef, arguments: parsedArguments.value };
    const attemptId = createAttemptId();
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
      };
      setInvocationOutput(result);
      if (runtimeTool && result.ok) {
        setRuntimeIdentity(parseDingTalkRuntimeOutput(result));
        setRuntimeIdentityError(null);
      }
      if (result.requiresApproval) {
        settleAttempt(attemptId, {
          state: 'approval_required',
          ...(result.approvalId ? { approvalId: result.approvalId } : {}),
          evidence,
        });
      } else if (result.ok) {
        settleAttempt(attemptId, { state: 'succeeded', evidence, finishedAt: Date.now() });
      } else {
        settleAttempt(attemptId, {
          state: 'failed',
          errorCode: result.error?.code ?? 'OPENCLAW_TOOL_FAILED',
          evidence,
          finishedAt: Date.now(),
        });
        setInvocationError(result.error?.message ?? 'OpenClaw 报告工具执行失败。');
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
          ? `写操作结果待核验：${errorMessage(error)}`
          : errorMessage(error),
      );
    } finally {
      setInvoking(false);
    }
  }, [activeSession, activeSessionKey, beginAttempt, disabledReason, effective?.agentId, identity, parsedArguments.value, profile, selectedTool, settleAttempt]);

  const invokeSelected = useCallback(() => {
    if (!selectedTool) return;
    if (selectedTool.effect !== 'write') {
      void performInvocation();
      return;
    }
    showConfirm(
      `确认${selectedTool.entry.label}`,
      '此操作会写入钉钉。确认后仍需通过 OpenClaw 插件审批；断线或超时时不会自动重试。',
      performInvocation,
    );
  }, [performInvocation, selectedTool]);

  const performPluginInstallation = useCallback(async () => {
    setPluginInstallationProgress({ phase: 'checking', message: '正在核对当前 Gateway 安装权限' });
    const current = getCurrentRuntimeIdentity();
    if (!current?.verified || !current.desktopMutationAllowed) {
      const message = dingtalkPluginInstallBlocker(current);
      setPluginError(message);
      setPluginInstallationProgress({ phase: 'failed', message });
      return;
    }
    setPluginOperation('installing');
    setPluginInstallationProgress({ phase: 'installing', message: '正在校验内置插件并等待 Gateway 安装、启用' });
    try {
      const status = await installBundledDingTalkPlugin(current.targetFingerprint, current.connectionId);
      setPluginStatus(status);
      setPluginError(null);
      setPluginInstallationProgress({ phase: 'completed', message: '插件已安装并启用。下一步：重启 Gateway' });
    } catch (error) {
      const message = errorMessage(error);
      setPluginError(message);
      setPluginInstallationProgress({ phase: 'failed', message });
    } finally {
      setPluginOperation(null);
    }
  }, []);

  const installPlugin = useCallback(() => {
    setPluginInstallationProgress({ phase: 'idle', message: null });
    setPluginInstallDialogOpen(true);
  }, []);

  const runDwsOperation = useCallback((kind: DwsOperationKind) => {
    const current = getCurrentRuntimeIdentity();
    if (!current?.verified || !current.desktopMutationAllowed) {
      setPluginError(dingtalkPluginInstallBlocker(current));
      return;
    }
    setPluginError(null);
    setDwsOutput([]);
    void startDwsOperation(current.targetFingerprint, current.connectionId, kind)
      .then((started) => {
        const output = dwsOutputCache.current[started.operationId] ?? [];
        setDwsOperation({
          id: started.operationId,
          kind: started.kind,
          phase: 'running',
          message: started.kind === 'install'
            ? '正在执行 DWS 官方 npm 安装命令。'
            : '本机运行时会自动打开浏览器扫码；Docker 或无界面运行时请按设备码提示完成授权。',
        });
        setDwsOutput(output);
      })
      .catch((error) => {
        const message = errorMessage(error);
        setDwsOperation({ id: 'dws-start-failed', kind, phase: 'failed', message });
        setDwsOutput([message]);
      });
  }, []);

  const cancelCurrentDwsOperation = useCallback(() => {
    const current = getCurrentRuntimeIdentity();
    if (!current?.verified || !dwsOperation || dwsOperation.phase !== 'running') return;
    void cancelDwsOperation(current.targetFingerprint, current.connectionId, dwsOperation.id)
      .catch((error) => setDwsOperation((operation) => (
        operation ? { ...operation, phase: 'failed', message: errorMessage(error) } : operation
      )));
  }, [dwsOperation]);

  const restartGateway = useCallback(async () => {
    setPluginOperation('restarting');
    try {
      const previousConnectionId = gateway.captureConnectionId();
      const result = await restartSelectedGatewayRuntime();
      if (!result.success) throw new Error(result.error ?? 'Gateway 重启失败');
      await waitForDingTalkGatewayReconnect({
        previousConnectionId,
        read: readDingTalkGatewayReconnectSnapshot,
      });
      await refreshAll();
      await refreshDingTalkState();
      setPluginError(null);
      return true;
    } catch (error) {
      setPluginError(errorMessage(error));
      return false;
    } finally {
      setPluginOperation(null);
    }
  }, [refreshDingTalkState]);

  const authorizeCurrentAgent = useCallback(async () => {
    if (!activeAgentId) {
      setPluginError('当前 Session 没有可核验的 Agent ID。');
      return;
    }
    setPluginOperation('authorizing');
    setPluginError(null);
    try {
      await authorizeDingTalkAgent(gateway, activeAgentId);
      const previousConnectionId = gateway.captureConnectionId();
      const result = await restartSelectedGatewayRuntime();
      if (!result.success) throw new Error(result.error ?? 'Gateway 重启失败');
      await waitForDingTalkGatewayReconnect({
        previousConnectionId,
        read: readDingTalkGatewayReconnectSnapshot,
      });
      await refreshAll();
      await refreshDingTalkState();
      setPluginError(null);
    } catch (error) {
      setPluginError(errorMessage(error));
    } finally {
      setPluginOperation(null);
    }
  }, [activeAgentId, refreshDingTalkState]);

  const localInstallAvailable = Boolean(identity?.verified && identity.desktopMutationAllowed);
  const pluginVisibleInSession = allTools.length > 0;
  const pluginNeedsInstall = Boolean(pluginStatus && (
    !pluginStatus.installed
      || !pluginStatus.enabled
      || !pluginStatus.loaded
      || pluginStatus.version !== pluginStatus.bundledVersion
  ));
  const headerStatus = pluginVisibleInSession
    ? `${allTools.length} 个当前有效工具`
    : toolsLoading || pluginStatusLoading ? '正在核对当前 Session 与插件状态' : pluginStatus?.installed
      ? '插件已安装，等待 Gateway 刷新'
      : localInstallAvailable ? '插件尚未安装' : '当前 Session 未提供钉钉工具';
  const pageTitle = view === 'activity'
    ? '钉钉操作审计'
    : view === 'runtime' ? '钉钉接入与授权' : '钉钉业务工作台';
  const readinessProps = {
    sessionExists,
    runtimeToolAvailable,
    runtime: runtimeIdentity,
    runtimeError: runtimeIdentityError,
    pluginNeedsInstall,
    pluginStatusPending: localInstallAvailable && pluginStatusLoading,
    restartRequired: Boolean(pluginStatus?.restartRequired),
    agentId: activeAgentId,
    installAvailable: localInstallAvailable,
    installationProgress: pluginInstallationProgress,
    dwsOperation,
    dwsOutput,
    busy: pluginOperation !== null || toolsLoading || dwsOperation?.phase === 'running',
    operation: pluginOperation,
    sessionLabel: sessionExists ? activeSessionKey : null,
    effectiveToolCount: allTools.length,
    pluginVersion: pluginStatus?.version ?? null,
    bundledPluginVersion: pluginStatus?.bundledVersion ?? null,
    onRefresh: () => { void refreshDingTalkState(); },
    onInstallPlugin: installPlugin,
    onAuthorizeAgent: () => void authorizeCurrentAgent(),
    onRestartGateway: () => { void restartGateway(); },
    onInstallDws: () => runDwsOperation('install'),
    onAuthorizeDws: () => runDwsOperation('authorize'),
    onCancelDws: cancelCurrentDwsOperation,
    onDismissDws: () => setDwsOperation(null),
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
          {runtimeIdentityError && <span className="max-w-[180px] truncate text-[9.5px] text-aegis-warning" title={runtimeIdentityError}>DWS 身份待验证</span>}
          {pluginError && <span className="max-w-[280px] truncate text-[9.5px] text-aegis-danger" title={pluginError}>{pluginError}</span>}
          <IconButton aria-label="刷新钉钉工具和身份" title="刷新钉钉工具和身份" disabled={!sessionExists || toolsLoading} onClick={() => { void refreshTools(); void refreshRuntimeIdentity(); }}>
            <RefreshCw size={13} className={toolsLoading ? 'animate-spin' : ''} />
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
                <span className="font-medium text-aegis-text-secondary">当前 Session</span>
                <span className="max-w-[320px] truncate font-mono" title={activeSessionKey}>{sessionExists ? activeSessionKey : '未选择有效 Session'}</span>
              </div>
              <span className="text-[10px] tabular-nums text-aegis-text-dim">{filteredTools.length} / {allTools.length}</span>
            </div>
            {toolsError && <div className="border-b border-aegis-danger/25 bg-aegis-danger/[0.06] px-3 py-1.5 text-[10px] text-aegis-danger">{toolsError}</div>}
            <DingTalkToolTable
              tools={filteredTools}
              selectedId={selectedId}
              loading={toolsLoading}
              emptyMessage={sessionExists ? '请先按上方状态条完成当前阻塞步骤，再重新检测有效工具。' : '请先创建或选择一个 OpenClaw Session。'}
              onSelect={selectTool}
            />
          </main>
          <DingTalkToolDetail
            tool={selectedTool}
            width={rightWidth}
            collapsed={rightCollapsed}
            profile={profile}
            argumentsJson={argumentsJson}
            schema={schema}
            schemaLoading={schemaLoading}
            schemaError={schemaError}
            invocationOutput={invocationOutput}
            invocationError={invocationError}
            invoking={invoking}
            disabledReason={disabledReason}
            onWidthChange={setRightWidth}
            onCollapsedChange={setRightCollapsed}
            onProfileChange={setProfile}
            onArgumentsChange={setArgumentsJson}
            onLoadSchema={() => void loadSchema()}
            onInvoke={invokeSelected}
          />
        </div>
      )}
    </PageTransition>
  );
}
