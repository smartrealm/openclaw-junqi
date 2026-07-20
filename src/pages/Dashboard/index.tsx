// ═══════════════════════════════════════════════════════════
// Dashboard — Mission Control (Cost-First Design)
// Sections: Top Bar → Hero Cards → Chart + Agents → Actions
// ═══════════════════════════════════════════════════════════

import { lazy, Suspense, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import {
  RefreshCw, BarChart3,
  Wifi, WifiOff, Bot, Shield, Activity, Zap, ChevronRight,
  TrendingUp, TrendingDown, Minus, MessageSquarePlus,
  ChartNoAxesCombined, Blocks, Gauge, Clock3, FolderKanban, TerminalSquare,
} from 'lucide-react';
import { GlassCard } from '@/components/shared/GlassCard';
import { SceneTransition } from '@/components/shared/SceneTransition';
import { DashboardIcon } from '@/components/shared/DashboardIcon';
import { Sparkline } from '@/components/shared/Sparkline';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore, refreshAll, ensureGroupFresh } from '@/stores/gatewayDataStore';
import { sessionActivityTime, sortSessionsByActivity } from '@/components/Layout/sidebarUtils';
import clsx from 'clsx';
import { themeColorVar } from '@/utils/theme-colors';
import { getSessionDisplayLabel } from '@/utils/sessionLabel';
import { formatTokens } from '@/utils/format';
import { isIsolatedExecutionSessionKey } from '@/utils/sessionPresentation';
import { getAgentDisplayName } from '@/utils/agentDisplayName';
import { useSceneRecovery } from '@/motion/sceneRecovery';
import { gateway } from '@/services/gateway';
import { useSettingsStore } from '@/stores/settingsStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { isFeatureEnabled } from '@/config/edition';
import {
  budgetProgress,
  costChangePercent,
  localDateKey,
  percentageOf,
  previousLocalDateKey,
} from './dashboardMetrics';
import {
  buildDailyCostChartData,
  formatActivityTime,
  formatActivityTimeTitle,
  shortModelName,
} from './dashboardData';

import {
  ContextRing, QuickAction, SessionItem, FeedItem, AgentItem,
  fmtCost, fmtCostShort, timeAgo, fmtUptime,
} from './components';

const CostChart = lazy(() => import('./CostChart').then((m) => ({ default: m.CostChart })));

// ── Agent emoji + display name helpers ───────────────────────

import {
  SoccerBall, Cube, MagnifyingGlass, Lightbulb,
  Monitor, Robot,
} from '@phosphor-icons/react';

const AGENT_ICONS: Record<string, React.ReactNode> = {
  main:       <Monitor size={14} weight="regular" />,
  hilali:     <SoccerBall size={14} weight="regular" />,
  pipeline:   <Cube size={14} weight="regular" />,
  researcher: <MagnifyingGlass size={14} weight="regular" />,
  consultant: <Lightbulb size={14} weight="regular" />,
  coder:      <Monitor size={14} weight="regular" />,
};

const getAgentEmoji = (id: string) =>
  AGENT_ICONS[id.toLowerCase()] ?? <Robot size={14} weight="regular" />;

const getAgentName = (id: string) => {
  // Note: keep display names i18n-driven (fallback to id)
  const key = id.toLowerCase();
  const names: Record<string, string> = {
    main: 'agents.mainAgent',
    hilali: 'dashboard.agent.hilali',
    pipeline: 'dashboard.agent.pipeline',
    researcher: 'dashboard.agent.researcher',
    consultant: 'dashboard.agent.consultant',
    coder: 'dashboard.agent.coder',
  };
  return names[key] ?? id;
};

// ════════════════════════════════════════════════════════════
// DashboardPage — Main component
// ════════════════════════════════════════════════════════════
export function DashboardPage() {
  const { t }      = useTranslation();
  const navigate   = useNavigate();
  const { connected, availableModels, modelsLoading, sessions: chatSessions } = useChatStore();
  const budgetLimit = useSettingsStore((s) => s.budgetLimit);
  const hasProviders = availableModels.length > 0;

  // ── Data from central store ─────────────────────────────────
  const sessions  = useGatewayDataStore((s) => s.sessions);
  const costData  = useGatewayDataStore((s) => s.costSummary);
  const usageData = useGatewayDataStore((s) => s.sessionsUsage);
  const costLoading = useGatewayDataStore((s) => s.loading.cost);
  const costError   = useGatewayDataStore((s) => s.errors.cost);
  const usageLoading = useGatewayDataStore((s) => s.loading.usage);
  const usageError   = useGatewayDataStore((s) => s.errors.usage);
  const agents       = useGatewayDataStore((s) => s.agents);

  const [quickActionLoading, setQuickActionLoading] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const sceneRecovery = useSceneRecovery(connected, () => {
    void refreshAll();
  });

  const connectedSince = useRef<number | null>(null);

  useEffect(() => {
    if (!connected) return;
    void ensureGroupFresh('cost');
    void ensureGroupFresh('usage');
    void ensureGroupFresh('agents');
  }, [connected]);

  // Track connection uptime
  useEffect(() => {
    if (connected && !connectedSince.current)  connectedSince.current = Date.now();
    if (!connected)                             connectedSince.current = null;
  }, [connected]);

  // Agent status derived from all sessions, not only main.
  const agentStatus: 'idle' | 'working' | 'offline' = useMemo(() => {
    if (!connected) return 'offline';
    return sessions.some((s: any) => Boolean(s.running)) ? 'working' : 'idle';
  }, [connected, sessions]);

  // ── Manual Refresh ──────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshAll();
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  // ── Quick Actions ────────────────────────────────────────────
  // Keep only actions that have a real local workflow. Prompt-only shortcuts
  // looked functional but depended on the LLM to decide what to do.
  const handleQuickAction = async (action: 'compact' | 'status') => {
    if (action === 'status') {
      navigate('/perf');
      return;
    }
    if (!connected || quickActionLoading) return;
    setQuickActionLoading(action);
    const sessionKey = useChatStore.getState().activeSessionKey || 'agent:main:main';
    try {
      await gateway.compactSession(sessionKey);
      useNotificationStore.getState().addToast(
        'task_complete',
        t('dashboard.compactQueuedTitle', 'Compaction requested'),
        t('dashboard.compactQueuedBody', 'OpenClaw is compacting the current session context.'),
      );
    } catch (error) {
      useNotificationStore.getState().addToast(
        'error',
        t('dashboard.compactFailedTitle', 'Compaction failed'),
        String(error),
      );
    } finally {
      setQuickActionLoading(null);
    }
  };

  // ── Derived values ───────────────────────────────────────────

  const now = new Date();
  const today = localDateKey(now);
  const yesterday = previousLocalDateKey(now);

  const allDaily: any[] = useMemo(() => costData?.daily || [], [costData]);

  // Today's cost + change vs yesterday
  const todayCost = useMemo(
    () => allDaily.find((d: any) => d.date === today)?.totalCost || 0,
    [allDaily, today]
  );
  const yesterdayCost = useMemo(
    () => allDaily.find((d: any) => d.date === yesterday)?.totalCost || 0,
    [allDaily, yesterday]
  );
  const changePercent = costChangePercent(todayCost, yesterdayCost);

  const rollingCost = costData?.totals?.totalCost
    ?? allDaily.reduce((sum: number, d: any) => sum + (d.totalCost || 0), 0);
  const budgetPct = budgetProgress(rollingCost, budgetLimit);

  // Sparklines: last 7 and last 30 days (oldest → newest)
  const spark7 = useMemo(() => {
    const sorted = [...allDaily].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.slice(-7).map((d: any) => d.totalCost);
  }, [allDaily]);

  const spark30 = useMemo(() => {
    const sorted = [...allDaily].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.slice(-30).map((d: any) => d.totalCost);
  }, [allDaily]);

  // Tokens today (from daily cost data)
  const todayEntry   = useMemo(() => allDaily.find((d: any) => d.date === today), [allDaily, today]);
  const tokensIn     = todayEntry?.input  || 0;
  const tokensOut    = todayEntry?.output || 0;
  const tokensToday  = tokensIn + tokensOut;

  // Context usage from main session
  const mainSession  = sessions.find((s: any) => s.key === 'agent:main:main');
  const mainModel    = hasProviders ? (mainSession?.model || '—') : '—';
  const shortModel   = mainModel.split('/').pop() || mainModel;
  const ctxUsed      = mainSession?.totalTokens   || 0;
  const ctxMax       = mainSession?.contextTokens || 200_000;
  const usagePct     = percentageOf(ctxUsed, ctxMax);

  const chatSessionByKey = useMemo(
    () => new Map(chatSessions.map((session) => [session.key, session])),
    [chatSessions],
  );
  const recentSessions = useMemo(() => {
    const byKey = new Map<string, any>();
    for (const s of sessions) {
      if (!s?.key || isIsolatedExecutionSessionKey(String(s.key))) continue;
      byKey.set(s.key, s);
    }
    for (const s of chatSessions) {
      if (!s?.key || isIsolatedExecutionSessionKey(String(s.key))) continue;
      byKey.set(s.key, { ...(byKey.get(s.key) ?? {}), ...s });
    }
    return sortSessionsByActivity(Array.from(byKey.values()).filter((s: any) => {
      if (s.archived) return false;
      if (s.running || s.hasPendingCompletion || s.lastMessage || s.lastTimestamp || s.lastActive) return true;
      if ((s.totalTokens || 0) > 0) return true;
      if (s.key === 'agent:main:main') return true;
      return Boolean(s.label && s.label !== 'Main Session');
    })).slice(0, 5);
  }, [sessions, chatSessions]);

  // OpenClaw returns continuous date buckets. Zero cost is still valid data
  // (for example when pricing is unavailable), so it must retain the X axis.
  const chartData = useMemo(() => buildDailyCostChartData(allDaily), [allDaily]);
  const hasChartData = chartData.length > 0;

  const agentIdFromKey = useCallback((key?: string) => {
    const parts = String(key || '').split(':');
    return parts[0] === 'agent' && parts[1] ? parts[1] : 'main';
  }, []);

  const modelForAgent = useCallback((agentId: string, usageRow?: any) => {
    const direct = usageRow?.model || usageRow?.totals?.model;
    if (direct) return shortModelName(direct);
    const sessionModel = sessions.find((s: any) => agentIdFromKey(s.key) === agentId && s.model)?.model;
    if (sessionModel) return shortModelName(sessionModel);
    const agentModel = agents.find((a: any) => a.id === agentId)?.model;
    if (agentModel) return shortModelName(agentModel);
    return '—';
  }, [sessions, agents, agentIdFromKey]);

  // Agent list: merge usage aggregates + currently active/running sessions.
  // Usage-only was wrong because an active agent with zero/unknown cost disappeared.
  const agentList = useMemo(() => {
    const byAgent = new Map<string, any>();
    const usageRows: any[] = usageData?.aggregates?.byAgent || [];
    for (const row of usageRows) {
      const id = row.agentId || row.agent || row.id || 'main';
      byAgent.set(id, { ...row, agentId: id, activeSessions: 0, running: false });
    }
    for (const s of sessions) {
      const id = agentIdFromKey(s.key);
      const prev = byAgent.get(id) || { agentId: id, totals: { totalCost: 0 }, activeSessions: 0, running: false };
      const isActive = Boolean(s.running) || (s.totalTokens || 0) > 0 || Boolean(s.lastActive);
      if (!isActive) continue;
      byAgent.set(id, {
        ...prev,
        agentId: id,
        activeSessions: (prev.activeSessions || 0) + 1,
        running: Boolean(prev.running || s.running),
        lastActive: s.lastActive || prev.lastActive,
        model: prev.model || s.model,
        totals: {
          ...(prev.totals || {}),
          totalCost: prev.totals?.totalCost || 0,
          totalTokens: (prev.totals?.totalTokens || 0) + (s.totalTokens || 0),
        },
      });
    }
    return Array.from(byAgent.values())
      .filter((a: any) => (a.activeSessions || 0) > 0 || (a.totals?.totalCost || 0) > 0)
      .sort((a: any, b: any) => Number(b.running) - Number(a.running) || (b.totals?.totalCost || 0) - (a.totals?.totalCost || 0));
  }, [usageData, sessions, agentIdFromKey]);

  const activeAgentTokenTotal = useMemo(
    () => agentList.reduce((sum: number, a: any) => sum + (a.totals?.totalTokens || 0), 0),
    [agentList],
  );
  const activeAgentModelCount = useMemo(
    () => new Set(agentList.map((a: any) => modelForAgent(a.agentId || a.agent || a.id || 'unknown', a)).filter(Boolean).filter((m) => m !== '—')).size,
    [agentList, modelForAgent],
  );
  const maxAgentTokens = useMemo(
    () => Math.max(...agentList.map((a: any) => a.totals?.totalTokens || 0), 1),
    [agentList]
  );

  // Uptime
  const uptime = connectedSince.current ? Date.now() - connectedSince.current : 0;

  const agentDisplayNameFor = useCallback((agentId: string) => {
    const fallback = t(getAgentName(agentId), { defaultValue: agentId });
    return getAgentDisplayName(
      agents.find((agent: any) => agent.id === agentId),
      fallback,
    );
  }, [agents, t]);

  const agentNameFor = useCallback(
    (key: string) => agentDisplayNameFor(agentIdFromKey(key)),
    [agentDisplayNameFor, agentIdFromKey],
  );

  // Activity feed items
  const feedItems = useMemo(() => {
    return recentSessions
      .map((s: any) => {
        const key = s.key || 'unknown';
        const isMain = key === 'agent:main:main';
        const merged = { ...s, ...(chatSessionByKey.get(key) ?? {}) };
        const timestamp = sessionActivityTime(merged);
        const sessionModel = merged.model || s.model;
        const fullModel = typeof sessionModel === 'string' && sessionModel.trim()
          ? sessionModel.trim()
          : agents.find((agent: any) => agent.id === agentIdFromKey(key))?.model;
        const label = getSessionDisplayLabel(merged, {
          mainSessionLabel: t('dashboard.mainSession', 'Main Session'),
          genericSessionLabel: t('dashboard.session', 'Session'),
        });
        return {
          color: isMain ? themeColorVar('primary') : themeColorVar('accent'),
          glowColor: isMain ? themeColorVar('primary', 0.38) : themeColorVar('accent', 0.38),
          text: label,
          time: formatActivityTime(timestamp),
          timeTitle: formatActivityTimeTitle(timestamp),
          sessionKey: key,
          agentName: agentNameFor(key),
          model: shortModelName(fullModel),
          modelTitle: typeof fullModel === 'string' ? fullModel : undefined,
          tokens: formatTokens(merged.totalTokens || 0),
          running: Boolean(merged.running || merged.hasActiveRun),
          timestamp,
        };
      })
      .filter((item) => item.timestamp > 0 || item.running)
      .slice(0, 5);
  }, [recentSessions, chatSessionByKey, agents, agentIdFromKey, agentNameFor, t]);

  // ── Render ───────────────────────────────────────────────────
  return (
    <SceneTransition
      className="min-h-full p-3 sm:p-5 space-y-4 max-w-[1280px] mx-auto"
      recoveryRevision={sceneRecovery.revision}
      recoveryReason={sceneRecovery.reason}
    >

      {/* ════ SECTION 1: TOP BAR ════ */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl bg-gradient-to-br from-aegis-primary/15 to-aegis-primary/5 border border-aegis-primary/20 flex items-center justify-center"
            style={{ boxShadow: `0 0 18px ${themeColorVar('primary', 0.16)}` }}
          >
            <Shield size={20} className="text-aegis-primary" />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2.5">
              <h1 className="text-[20px] font-bold text-aegis-text tracking-normal">
                {t('dashboard.title')}
              </h1>
              {/* Status badge — inline with title so the idle/working state reads naturally */}
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={`${connected}-${agentStatus}`}
                  initial={{ opacity: 0, y: -3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 3 }}
                  transition={{ duration: 0.18 }}
                  className={clsx(
                    'flex min-w-[68px] items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border',
                    connected
                      ? agentStatus === 'working'
                        ? 'bg-aegis-success/[0.08] border-aegis-success/30 text-aegis-success'
                        : 'bg-aegis-text-dim/[0.06] border-aegis-text-dim/20 text-aegis-text-dim'
                      : 'bg-aegis-danger/[0.08] border-aegis-danger/30 text-aegis-danger',
                  )}
                >
                  <span className={clsx(
                    'relative flex items-center justify-center w-3.5 h-3.5 rounded-full border',
                    connected
                      ? agentStatus === 'working'
                        ? 'border-aegis-success/30 bg-aegis-success/[0.06]'
                        : 'border-aegis-text-dim/25 bg-aegis-text-dim/[0.04]'
                      : 'border-aegis-danger/30 bg-aegis-danger/[0.06]',
                  )}>
                    <span className={clsx(
                      'w-1.5 h-1.5 rounded-full',
                      connected
                        ? agentStatus === 'working'
                          ? 'bg-aegis-success animate-pulse-soft'
                          : 'bg-aegis-text-dim'
                        : 'bg-aegis-danger animate-pulse-soft',
                    )} />
                  </span>
                  {connected
                    ? (agentStatus === 'working' ? t('dashboard.working') : t('dashboard.idle'))
                    : t('dashboard.offline')}
                </motion.div>
              </AnimatePresence>
            </div>
            <p className="text-[12px] text-aegis-text-dim">{t('dashboard.commandCenter')}</p>
          </div>
        </div>

        {/* Status + meta info */}
        <div className="flex items-center gap-3">
          {/* Uptime + model (desktop only) — hide model when no providers configured */}
          <div className="hidden lg:flex items-center gap-3 text-[11px] font-mono tabular-nums text-aegis-text-muted">
            <span>{t('dashboard.uptime')}: <span className="text-aegis-text">{fmtUptime(uptime)}</span></span>
            {hasProviders && (
              <>
                <span className="opacity-30">·</span>
                <span>{shortModel !== '—' ? shortModel : t('dashboard.model')}</span>
              </>
            )}
          </div>

          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label={t('dashboard.refresh', 'Refresh')}
            className="p-1.5 rounded-lg hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors"
            title={t('dashboard.refresh', 'Refresh')}
          >
            <RefreshCw
              size={15}
              className={clsx(
                'text-aegis-text-muted hover:text-aegis-text transition-colors',
                refreshing && 'animate-spin text-aegis-primary'
              )}
            />
          </button>

          {/* Connectivity icon */}
          {connected
            ? <Wifi size={15} className="text-aegis-success" />
            : <WifiOff size={15} className="text-aegis-danger" />
          }
        </div>
      </div>

      {/* ════ SETUP BANNER: shown when no AI provider is configured ════ */}
      {connected && !hasProviders && !modelsLoading && (
        <div
          className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-aegis-warning/30 bg-aegis-warning/[0.06] animate-slide-down"
        >
          <div className="flex items-center gap-2.5 text-[13px] text-aegis-warning">
            <Zap size={15} className="shrink-0" />
            <span>{t('dashboard.setupProviderBanner', 'No AI provider configured. Set up a provider to start chatting.')}</span>
          </div>
          <button
            onClick={() => navigate('/config')}
            className="shrink-0 px-3 py-1 rounded-lg text-[12px] font-semibold border border-aegis-warning/40 text-aegis-warning hover:bg-aegis-warning/[0.1] transition-colors"
          >
            {t('dashboard.setupProviderAction', 'Go to Config →')}
          </button>
        </div>
      )}

      {/* ════ SECTION 2: HERO CARDS (4 columns) ════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">

        {/* 💰 Today's Cost */}
        <GlassCard hover={false} delay={0.05} className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[12px] text-aegis-text-muted font-medium">
            <DashboardIcon kind="cost" size={13} />
            {t('dashboard.todayCost')}
          </div>
          <div className="text-[26px] font-bold tabular-nums text-aegis-text leading-none tracking-normal">
            {fmtCostShort(todayCost)}
          </div>
          <div className={clsx(
            'flex items-center gap-1 text-[12px] font-semibold',
            changePercent === null
              ? 'text-aegis-text-dim'
              : changePercent <= 0 ? 'text-aegis-success' : 'text-aegis-danger'
          )}>
            {changePercent === null
              ? <Minus size={13} />
              : changePercent <= 0
                ? <TrendingDown size={13} />
                : <TrendingUp size={13} />}
            {changePercent === null
              ? t('dashboard.noYesterdayBaseline', 'No comparison data')
              : `${Math.abs(changePercent).toFixed(0)}% ${t('dashboard.vsYesterday')}`}
          </div>
          {spark7.length > 0 && (
            <Sparkline data={spark7} color={themeColorVar('primary')} width={120} height={30} />
          )}
        </GlassCard>

        {/* 📅 This Month */}
        <GlassCard hover={false} delay={0.08} className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[12px] text-aegis-text-muted font-medium">
            <DashboardIcon kind="month" size={13} />
            {t('dashboard.rolling30Cost', 'Last 30 days')}
          </div>
          <div className="text-[26px] font-bold tabular-nums text-aegis-text leading-none tracking-normal">
            {fmtCostShort(rollingCost)}
          </div>
          <div className="text-[12px] text-aegis-text-dim">
            {budgetPct === null
              ? t('dashboard.noBudgetLimit', 'No budget limit')
              : t('dashboard.budgetUsage', {
                  used: fmtCostShort(rollingCost),
                  limit: fmtCostShort(budgetLimit),
                  percent: Math.round(budgetPct),
                })}
          </div>
          {budgetPct !== null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-[rgb(var(--aegis-overlay)/0.06)]" aria-hidden="true">
              <div
                className={clsx('h-full rounded-full transition-[width] duration-500', budgetPct >= 100 ? 'bg-aegis-danger' : 'bg-aegis-primary')}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
          )}
          {spark30.length > 0 && (
            <Sparkline data={spark30} color={themeColorVar('accent')} width={120} height={30} />
          )}
        </GlassCard>

        {/* ⚡ Tokens Today */}
        <GlassCard hover={false} delay={0.11} className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[12px] text-aegis-text-muted font-medium">
            <DashboardIcon kind="tokens" size={13} />
            {t('dashboard.tokensToday')}
          </div>
          <div className="text-[26px] font-bold tabular-nums text-aegis-text leading-none tracking-normal">
            {formatTokens(tokensToday)}
          </div>
          <div className="text-[11px] text-aegis-text-muted font-mono tabular-nums space-y-0.5">
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-aegis-accent" />
              {t('dashboard.tokensIn')}:  {formatTokens(tokensIn)}
            </div>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-aegis-primary" />
              {t('dashboard.tokensOut')}: {formatTokens(tokensOut)}
            </div>
          </div>
        </GlassCard>

        {/* 🧠 Context */}
        <GlassCard hover={false} delay={0.14} className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[12px] text-aegis-text-muted font-medium">
            <DashboardIcon kind="context" size={13} />
            {t('dashboard.contextCard')}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <ContextRing percentage={usagePct} />
            <div className="min-w-0 text-[11px] text-aegis-text-muted font-mono tabular-nums space-y-1">
              <div>{t('dashboard.used', { n: formatTokens(ctxUsed) })}</div>
              <div className="text-aegis-text-dim">{t('dashboard.max', { n: formatTokens(ctxMax) })}</div>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* ════ SECTION 3: MIDDLE ROW (Chart + Agents) ════ */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-3 shrink-0">

        {/* Daily Cost Chart */}
        <GlassCard hover={false} delay={0.16} noPad className="h-full">
          <div className="flex h-full min-h-[250px] flex-col p-5">
            <div className="mb-4 flex shrink-0 items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp size={15} className="text-aegis-primary" />
                <span className="text-[14px] font-semibold text-aegis-text">{t('dashboard.dailyCostChart')}</span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[11px] text-aegis-text-muted font-medium">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-aegis-accent" />{t('dashboard.inputCostLabel')}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-aegis-primary" />{t('dashboard.outputCostLabel')}</span>
                {hasChartData && chartData.some((d: any) => d.cache > 0) && (
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-aegis-success" />{t('dashboard.cacheCostLabel', 'Cache')}</span>
                )}
              </div>
            </div>
            <div className="relative min-h-[160px] flex-1">
              {hasChartData ? (
                <Suspense fallback={<div className="h-full" />}>
                  <CostChart data={chartData} />
                </Suspense>
              ) : !connected ? (
                <div className="absolute inset-0 flex items-center justify-center text-[13px] text-aegis-text-dim">
                  {t('dashboard.notConnected')}
                </div>
              ) : costError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[13px] text-aegis-text-dim">
                  <span>{t('dashboard.costError')}</span>
                  <button
                    onClick={handleRefresh}
                    className="text-aegis-primary hover:underline text-[12px]"
                  >
                    {t('dashboard.costRetry')}
                  </button>
                </div>
              ) : (costLoading && !costData) ? (
                <div className="absolute inset-0 flex items-center justify-center text-[13px] text-aegis-text-dim">
                  {t('common.loading')}
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[13px] text-aegis-text-dim">
                  <BarChart3 size={18} className="text-aegis-text-muted" />
                  <span>{t('dashboard.costEmpty', 'No usage recorded yet')}</span>
                </div>
              )}
            </div>
          </div>
        </GlassCard>

        {/* Active Agents */}
        <GlassCard hover={false} delay={0.18} className="flex flex-col min-h-[160px]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <Bot size={15} className="text-aegis-accent" />
              <span className="text-[14px] font-semibold text-aegis-text">{t('dashboard.activeAgents')}</span>
              {agentList.length > 0 && (
                <span className="text-[11px] font-mono tabular-nums text-aegis-text-dim truncate">
                  {t('dashboard.agentSummary', {
                    tokens: formatTokens(activeAgentTokenTotal),
                    models: activeAgentModelCount || 0,
                    defaultValue: '{{tokens}} tokens · {{models}} models',
                  })}
                </span>
              )}
            </div>
            <button
              onClick={() => navigate('/agents')}
              className="flex items-center gap-0.5 text-[11px] text-aegis-primary hover:underline"
            >
              {t('dashboard.viewAll')}
              <ChevronRight size={12} />
            </button>
          </div>

          <div className="space-y-0">
            {agentList.length > 0 ? (
              agentList.slice(0, 5).map((a: any) => {
                const id      = a.agentId || a.agent || a.id || 'unknown';
                const tokenCount = a.totals?.totalTokens || 0;
                const model = modelForAgent(id, a);
                return (
                  <AgentItem
                    key={id}
                    emoji={getAgentEmoji(id)}
                    name={agentDisplayNameFor(id)}
                    model={model}
                    tokens={formatTokens(tokenCount)}
                    tokenCount={tokenCount}
                    maxTokens={maxAgentTokens}
                    sessions={a.activeSessions || 0}
                    running={Boolean(a.running)}
                  />
                );
              })
            ) : !connected ? (
              <div className="flex-1 flex items-center justify-center text-[12px] text-aegis-text-dim">
                {t('dashboard.notConnected')}
              </div>
            ) : usageError ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[12px] text-aegis-text-dim">
                <div>{t('dashboard.agentError')}</div>
                <button
                  onClick={handleRefresh}
                  className="text-aegis-primary hover:underline"
                >
                  {t('dashboard.costRetry')}
                </button>
              </div>
            ) : (usageLoading && !usageData) ? (
              <div className="flex-1 flex items-center justify-center text-[12px] text-aegis-text-dim">
                {t('common.loading')}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[12px] text-aegis-text-dim">
                {t('dashboard.noAgentData')}
              </div>
            )}
          </div>
        </GlassCard>
      </div>

      {/* ════ SECTION 4: BOTTOM ROW (3 columns) ════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        {/* ── Quick Actions ── */}
        <GlassCard hover={false} delay={0.20}>
          <div className="flex items-center gap-2 mb-3">
            <Zap size={15} className="text-aegis-accent" />
            <span className="text-[14px] font-semibold text-aegis-text">{t('dashboard.quickActions')}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {isFeatureEnabled('chat') && (
              <QuickAction icon={MessageSquarePlus} label={t('chat.newSession', 'New session')}
                glowColor={themeColorVar('primary', 0.08)} bgColor={themeColorVar('primary', 0.1)} iconColor={themeColorVar('primary')}
                onClick={() => navigate('/chat?agent=main&new=1')} />
            )}
            {isFeatureEnabled('agents') && (
              <QuickAction icon={Bot} label={t('nav.agents', 'Agents')}
                glowColor={themeColorVar('accent', 0.08)} bgColor={themeColorVar('accent', 0.1)} iconColor={themeColorVar('accent')}
                onClick={() => navigate('/agents')} />
            )}
            {isFeatureEnabled('analytics') && (
              <QuickAction icon={ChartNoAxesCombined} label={t('nav.usage', 'Usage')}
                glowColor={themeColorVar('success', 0.08)} bgColor={themeColorVar('success', 0.1)} iconColor={themeColorVar('success')}
                onClick={() => navigate('/analytics')} />
            )}
            {isFeatureEnabled('skills') && (
              <QuickAction icon={Blocks} label={t('nav.skills', 'Skills')}
                glowColor={themeColorVar('accent', 0.08)} bgColor={themeColorVar('accent', 0.1)} iconColor={themeColorVar('accent')}
                onClick={() => navigate('/skills')} />
            )}
            <QuickAction icon={Activity} label={t('nav.activity', '活动中心')}
              glowColor={themeColorVar('primary', 0.08)} bgColor={themeColorVar('primary', 0.1)} iconColor={themeColorVar('primary')}
              onClick={() => navigate('/activity')} />
            {isFeatureEnabled('agentRun') && (
              <QuickAction icon={FolderKanban} label={t('nav.aiWorkspace', 'AI 工作台')}
                glowColor={themeColorVar('accent', 0.08)} bgColor={themeColorVar('accent', 0.1)} iconColor={themeColorVar('accent')}
                onClick={() => navigate('/ai-workspace')} />
            )}
            {isFeatureEnabled('terminal') && (
              <QuickAction icon={TerminalSquare} label={t('nav.terminal', '终端')}
                glowColor={themeColorVar('success', 0.08)} bgColor={themeColorVar('success', 0.1)} iconColor={themeColorVar('success')}
                onClick={() => navigate('/terminal')} />
            )}
            {isFeatureEnabled('cron') && (
              <QuickAction icon={Clock3} label={t('nav.cron', '定时任务')}
                glowColor={themeColorVar('warning', 0.08)} bgColor={themeColorVar('warning', 0.1)} iconColor={themeColorVar('warning')}
                onClick={() => navigate('/cron')} />
            )}
            <QuickAction icon={RefreshCw} label={t('dashboard.compact')}
              glowColor={themeColorVar('warning', 0.08)} bgColor={themeColorVar('warning', 0.1)} iconColor={themeColorVar('warning')}
              onClick={() => void handleQuickAction('compact')} loading={quickActionLoading === 'compact'} disabled={!connected} />
            <QuickAction icon={Gauge} label={t('dashboard.systemStatus')}
              glowColor={themeColorVar('accent', 0.08)} bgColor={themeColorVar('accent', 0.1)} iconColor={themeColorVar('accent')}
              onClick={() => void handleQuickAction('status')} loading={false} />
          </div>
        </GlassCard>

        {/* ── Sessions ── */}
        <GlassCard hover={false} delay={0.22}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Bot size={15} className="text-aegis-accent" />
              <span className="text-[14px] font-semibold text-aegis-text">{t('dashboard.sessions')}</span>
            </div>
            <button
              onClick={() => navigate('/chat')}
              className="flex items-center gap-0.5 text-[11px] text-aegis-primary hover:underline"
            >
              {t('dashboard.viewAll')}
              <ChevronRight size={12} />
            </button>
          </div>

          <div className="space-y-1">
            {recentSessions.map((s: any) => {
              const key   = s.key || 'unknown';
              const merged = { ...s, ...(chatSessionByKey.get(key) ?? {}) };
              const isMain = key === 'agent:main:main';
              const label = getSessionDisplayLabel(merged, {
                mainSessionLabel: t('dashboard.mainSession', 'Main Session'),
                genericSessionLabel: t('dashboard.session', 'Session'),
              });
              const sModel = shortModelName(merged.model || s.model);
              const lastActiveIso = sessionActivityTime(merged)
                ? new Date(sessionActivityTime(merged)).toISOString()
                : undefined;
              return (
                <SessionItem
                  key={key}
                  isMain={isMain}
                  name={label}
                  model={sModel}
                  detail={isMain ? t('dashboard.compactCount', { n: s.compactions || s.compactionCount || 0 }) : timeAgo(lastActiveIso)}
                  tokens={formatTokens(s.totalTokens || 0)}
                  avatarBg={isMain ? themeColorVar('primary', 0.12) : themeColorVar('accent', 0.1)}
                  avatarColor={isMain ? themeColorVar('primary') : themeColorVar('accent')}
                  icon={isMain ? Shield : Bot}
                  pinned={Boolean(merged.pinned)}
                  onPinToggle={() => useChatStore.getState().togglePinSession(key)}
                  onClick={() => { useChatStore.getState().openTab(key); navigate('/chat'); }}
                />
              );
            })}
            {recentSessions.length === 0 && (
              <div className="py-3 text-center text-[12px] text-aegis-text-dim">
                {connected ? t('dashboard.noActiveSessions') : t('dashboard.notConnected')}
              </div>
            )}
          </div>
        </GlassCard>

        {/* ── Activity Feed ── */}
        <GlassCard hover={false} delay={0.24}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity size={15} className="text-aegis-primary" />
              <span className="text-[14px] font-semibold text-aegis-text">{t('dashboard.activity')}</span>
            </div>
            <div className="flex items-center gap-2">
              {connected && (
                <span className="text-[10px] font-bold text-aegis-success bg-aegis-success-surface px-2 py-0.5 rounded-md tracking-normal animate-pulse-soft">
                  {t('dashboard.live', 'LIVE')}
                </span>
              )}
              <button type="button" onClick={() => navigate('/activity')} className="flex items-center gap-0.5 text-[11px] text-aegis-primary hover:underline">
                {t('dashboard.viewAll')}<ChevronRight size={12} />
              </button>
            </div>
          </div>

          <div className="max-h-[220px] overflow-y-auto scrollbar-hidden">
            {feedItems.length > 0 ? (
              feedItems.map((item, i) => (
                <FeedItem
                  key={item.sessionKey}
                  color={item.color}
                  glowColor={item.glowColor}
                  text={item.text}
                  time={item.time}
                  timeTitle={item.timeTitle}
                  isLast={i === feedItems.length - 1}
                  agentName={item.agentName}
                  model={item.model}
                  modelTitle={item.modelTitle}
                  tokens={item.tokens}
                  running={item.running}
                  onClick={item.sessionKey
                    ? () => { useChatStore.getState().openTab(item.sessionKey); navigate('/chat'); }
                    : undefined}
                />
              ))
            ) : (
              <div className="py-3 text-center text-[12px] text-aegis-text-dim">
                {connected ? t('dashboard.noActiveSessions') : t('dashboard.notConnected')}
              </div>
            )}
          </div>
        </GlassCard>
      </div>

    </SceneTransition>
  );
}
