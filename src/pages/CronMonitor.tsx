// ═══════════════════════════════════════════════════════════
// 定时任务维护页面
// 顶部负责检索与操作，左侧展示任务，右侧展示详情与运行记录
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { buildCronAgentOptions, resolveCronAgentAvailability } from './cronAgentSelection';
import { Play, RotateCcw, Check, X, Plus, Search, Clock, CalendarClock, Trash2 } from 'lucide-react';
import { gateway, type OpenClawCronRunEntry, type OpenClawCronStatus } from '@/services/gateway';
import { OpenClawCronStatusUnsupportedError } from '@/services/gateway/OpenClawCronStatusClient';
import type { OpenClawCronJobDetails } from '@/services/gateway/cronRuns';
import {
  cronRunInFlight,
  cronRunLoading,
  formatCronCountdown,
  formatCronDuration,
  formatCronSchedule,
  formatCronTimeAgo,
  getCronDeliveryStatus as getDeliveryStatus,
  getCronLastRun as getLastRun,
  getCronNextRun as getNextRun,
  getCronStatus as getStatus,
  getCronTemplates,
} from './cronPresentation';
import {
  buildCronAgentTurnAddParams,
  cronAgentUpdatePatch,
  isCronAgentSelectionConfirmed,
} from '@/services/gateway/cronContract';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore, refreshGroup, ensureGroupFresh } from '@/stores/gatewayDataStore';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { dataColor, themeHex, themeAlpha } from '@/utils/theme-colors';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ═══════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════

type CronJob = OpenClawCronJobDetails;

type RunEntry = OpenClawCronRunEntry;

// 当前 OpenClaw CLI 最多等待十分钟，并每两秒读取一次 cron.runs。
// 这些仅是 JunQi 呈现层等待限制，不属于 Gateway 协议字段。
const OPENCLAW_CRON_RUN_WAIT_TIMEOUT_MS = 600_000;
const OPENCLAW_CRON_RUN_POLL_INTERVAL_MS = 2_000;

// ═══════════════════════════════════════════════════════════
// 常量与辅助逻辑
// ═══════════════════════════════════════════════════════════

/** 主题感知的任务颜色，在渲染时读取。 */
const getJobColor = (idx: number): string => dataColor(idx);
const DEFAULT_AGENT_SELECT_VALUE = 'default';
const agentSelectValue = (agentId: string | undefined): string =>
  agentId ? `agent:${agentId}` : DEFAULT_AGENT_SELECT_VALUE;
const agentIdFromSelectValue = (value: string): string =>
  value === DEFAULT_AGENT_SELECT_VALUE ? '' : value.slice('agent:'.length);

// ═══════════════════════════════════════════════════════════
// 时钟视图：24 小时调度可视化
// ═══════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════
// 页面主体
// ═══════════════════════════════════════════════════════════

export function CronMonitorPage() {
  const { t, i18n } = useTranslation();
  const { connected } = useChatStore();
  const present = useCallback(
    (key: string, options?: Record<string, unknown>) => t(key, options),
    [t],
  );
  const formatSchedule = useCallback(
    (schedule: OpenClawCronJobDetails['schedule']) => formatCronSchedule(schedule, i18n.language, present),
    [i18n.language, present],
  );
  const formatTimeAgo = useCallback(
    (value: string | number | null | undefined) => formatCronTimeAgo(value, i18n.language, present),
    [i18n.language, present],
  );
  const formatCountdown = useCallback(
    (value: string | number | null | undefined) => formatCronCountdown(value, i18n.language, present),
    [i18n.language, present],
  );
  const formatDuration = useCallback(
    (milliseconds: number | undefined) => formatCronDuration(milliseconds, i18n.language, present),
    [i18n.language, present],
  );
  // ── 状态：任务来自中心数据源 ──
  const storeJobs = useGatewayDataStore((s) => s.cronJobs);
  const cronStatus = useGatewayDataStore((s) => s.cronStatus);
  const cronStatusError = useGatewayDataStore((s) => s.cronStatusError);
  const agents = useGatewayDataStore((s) => s.agents);
  const jobs = storeJobs;
  const loading = useGatewayDataStore((s) => s.loading.cron);
  const agentsLoading = useGatewayDataStore((s) => s.loading.agents);
  const agentsError = useGatewayDataStore((s) => s.errors.agents);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<Record<string, 'queued' | 'waiting' | 'pending' | 'ok' | 'error' | 'skipped'>>({});
  const [templateResult, setTemplateResult] = useState<Record<string, 'ok' | 'error'>>({});
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJobDetails, setSelectedJobDetails] = useState<OpenClawCronJobDetails | null>(null);
  const [selectedJobDetailLoading, setSelectedJobDetailLoading] = useState(false);
  const [selectedJobDetailError, setSelectedJobDetailError] = useState<string | null>(null);
  const [recentRuns, setRecentRuns] = useState<RunEntry[]>([]);
  const [selectedJobRuns, setSelectedJobRuns] = useState<RunEntry[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<OpenClawCronStatus | null>(null);
  const [schedulerStatusLoading, setSchedulerStatusLoading] = useState(false);
  const [schedulerStatusError, setSchedulerStatusError] = useState<'unsupported' | 'failed' | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'error'>('all');
  const [showAllLogs, setShowAllLogs] = useState(false);
  // 快捷创建入口通过 /cron?new=1 打开表单，消费参数后不再重复触发。
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createJob, setCreateJob] = useState({ name: '', cronExpr: '0 9 * * *', message: '', agentId: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [agentUpdateError, setAgentUpdateError] = useState<string | null>(null);
  const [cronMutationError, setCronMutationError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const schedulerStatusRequest = useRef(0);
  const requestedJobId = searchParams.get('job')?.trim() || null;
  useEffect(() => {
    if (!connected) return;
    void Promise.all([
      ensureGroupFresh('agents'),
      ensureGroupFresh('cron'),
    ]);
  }, [connected]);

  const refreshSchedulerStatus = useCallback(async () => {
    const requestId = ++schedulerStatusRequest.current;
    if (!connected) {
      setSchedulerStatus(null);
      setSchedulerStatusError(null);
      setSchedulerStatusLoading(false);
      return;
    }
    setSchedulerStatusLoading(true);
    setSchedulerStatusError(null);
    try {
      const status = await gateway.getCronStatus();
      if (requestId !== schedulerStatusRequest.current) return;
      setSchedulerStatus(status);
    } catch (error) {
      if (requestId !== schedulerStatusRequest.current) return;
      setSchedulerStatusError(error instanceof OpenClawCronStatusUnsupportedError ? 'unsupported' : 'failed');
    } finally {
      if (requestId === schedulerStatusRequest.current) setSchedulerStatusLoading(false);
    }
  }, [connected]);

  useEffect(() => {
    void refreshSchedulerStatus();
  }, [refreshSchedulerStatus]);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowCreateForm(true);
      setCreateError(null);
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // 使用稳定的任务引用，避免每 30 秒轮询时重建回调。
  const jobsRef = useRef<CronJob[]>([]);
  jobsRef.current = jobs;

  // 为选中任务的请求增加过期保护，避免旧响应覆盖新选择。
  const selectedFetchId = useRef(0);
  const selectedJobDetailFetchId = useRef(0);

  // 定时刷新倒计时和相对时间显示。
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick(t => (t + 1) % 10000), 15000);
    return () => clearInterval(iv);
  }, []);

  // 缓存主题颜色，避免渲染期间重复读取计算。
  const [tc] = useState(() => ({
    primary: themeHex('primary'),
    accent: themeHex('accent'),
    danger: themeHex('danger'),
    warning: themeHex('warning'),
    success: themeHex('success'),
    dangerA70: themeAlpha('danger', 0.7),
    dangerA40: themeAlpha('danger', 0.4),
    dangerA25: themeAlpha('danger', 0.25),
    primaryA50: themeAlpha('primary', 0.5),
  }));

  // ── 派生数据 ──
  const colorMap = useMemo(() => {
    const m: Record<string, string> = {};
    jobs.forEach((j, i) => { m[j.id] = getJobColor(i); });
    return m;
  }, [jobs]);

  const activeCount = useMemo(() => jobs.filter((job) => getStatus(job) === 'active').length, [jobs]);
  const selectedJob = useMemo(() => {
    const listedJob = jobs.find(j => j.id === selectedJobId) || null;
    if (!listedJob || selectedJobDetails?.id !== listedJob.id) return listedJob;
    return {
      ...listedJob,
      ...selectedJobDetails,
      state: { ...listedJob.state, ...selectedJobDetails.state },
    };
  }, [jobs, selectedJobId, selectedJobDetails]);
  const agentName = useCallback((agentId: string | undefined) => {
    if (!agentId) return t('cron.defaultAgent');
    return agents.find((agent) => agent.id === agentId)?.name || agentId;
  }, [agents, t]);
  const selectedAgentValue = pendingAgentId ?? selectedJob?.agentId ?? '';
  const agentAvailability = resolveCronAgentAvailability(agentsLoading, agentsError, agents);
  const agentSelectionDisabled = agentAvailability === 'loading' || agentAvailability === 'error';
  const selectedAgentOptions = useMemo(
    () => buildCronAgentOptions(agents, selectedAgentValue),
    [agents, selectedAgentValue],
  );
  const createAgentOptions = useMemo(
    () => buildCronAgentOptions(agents, createJob.agentId),
    [agents, createJob.agentId],
  );
  const retryAgents = useCallback(() => {
    if (!connected) return;
    void refreshGroup('agents');
  }, [connected]);

  useEffect(() => {
    setPendingAgentId(null);
    setAgentUpdateError(null);
  }, [selectedJobId, selectedJob?.agentId]);

  useEffect(() => {
    if (!selectedJobId || !connected) {
      setSelectedJobDetails(null);
      setSelectedJobDetailError(null);
      setSelectedJobDetailLoading(false);
      return;
    }
    const fetchId = ++selectedJobDetailFetchId.current;
    setSelectedJobDetailLoading(true);
    setSelectedJobDetailError(null);
    void gateway.getCronJob(selectedJobId)
      .then((details) => {
        if (fetchId !== selectedJobDetailFetchId.current) return;
        setSelectedJobDetails(details);
      })
      .catch((error: unknown) => {
        if (fetchId !== selectedJobDetailFetchId.current) return;
        setSelectedJobDetails(null);
        setSelectedJobDetailError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (fetchId === selectedJobDetailFetchId.current) setSelectedJobDetailLoading(false);
      });
  }, [selectedJobId, connected]);

  // 先显示错误任务，再按下次运行时间显示活动任务，最后显示暂停任务，并应用搜索筛选。
  const sortedJobs = useMemo(() => {
    let filtered = jobs;
    if (statusFilter !== 'all') {
      filtered = filtered.filter(j => getStatus(j) === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(j => (j.name || j.id).toLowerCase().includes(q));
    }
    return [...filtered].sort((a, b) => {
      const sa = getStatus(a), sb = getStatus(b);
      if (sa === 'error' && sb !== 'error') return -1;
      if (sb === 'error' && sa !== 'error') return 1;
      if (sa === 'paused' && sb !== 'paused') return 1;
      if (sb === 'paused' && sa !== 'paused') return -1;
      const an = new Date(getNextRun(a) || '9999').getTime();
      const bn = new Date(getNextRun(b) || '9999').getTime();
      return an - bn;
    });
  }, [jobs, searchQuery, statusFilter]);

  // 任务来自中心状态，并由状态层定期轮询。

  // ── 运行记录缓存：仅在首次挂载或手动刷新时重新加载 ──
  const runsCache = useRef<Record<string, RunEntry[]>>({});
  const runsCacheLoaded = useRef(false);

  // ── 分批加载最近运行记录，避免同时请求过多 ──
  // 使用稳定的任务引用，避免轮询导致回调重建。
  const loadAllRuns = useCallback(async () => {
    const currentJobs = jobsRef.current;
    if (!connected || currentJobs.length === 0) return;
    setLoadingRuns(true);
    setRunsError(null);
    try {
      const all: RunEntry[] = [];
      const jobList = currentJobs.slice(0, 12);
      const BATCH_SIZE = 3;

      for (let i = 0; i < jobList.length; i += BATCH_SIZE) {
        const batch = jobList.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (job) => {
          try {
            const result = await gateway.listCronRuns(job.id);
            const entries = result.entries.slice(-5).map((e) => ({
              ...e, jobId: job.id, jobName: job.name || job.id,
            }));
            runsCache.current[job.id] = entries;
            all.push(...entries);
          } catch (error) { setRunsError(error instanceof Error ? error.message : String(error)); }
        }));
      }

      all.sort((a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime());
      setRecentRuns(all.slice(0, 30));
      runsCacheLoaded.current = true;
    } catch (error) { setRunsError(error instanceof Error ? error.message : String(error)); }
    finally { setLoadingRuns(false); }
  }, [connected]);

  // ── 加载单个任务的运行记录并合并到缓存 ──
  // 使用稳定的任务引用，避免轮询时重建回调。
  const loadSingleJobRuns = useCallback(async (jobId: string) => {
    if (!connected) return;
    setRunsError(null);
    try {
      const job = jobsRef.current.find(j => j.id === jobId);
      const result = await gateway.listCronRuns(jobId);
      const entries = result.entries.slice(-5).map((e) => ({
        ...e, jobId, jobName: job?.name || jobId,
      }));
      runsCache.current[jobId] = entries;

      // 从缓存重新生成最近运行记录。
      const all: RunEntry[] = [];
      Object.values(runsCache.current).forEach(arr => all.push(...arr));
      all.sort((a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime());
      setRecentRuns(all.slice(0, 30));
    } catch (error) { setRunsError(error instanceof Error ? error.message : String(error)); }
  }, [connected]);

  // 仅在首次挂载时加载。
  useEffect(() => {
    if (jobs.length > 0 && !runsCacheLoaded.current) loadAllRuns();
  }, [jobs.length, loadAllRuns]);

  // ── 加载选中任务的运行记录（先使用缓存，再请求最新数据） ──
  // 过期请求保护，避免快速切换任务时出现竞态。
  useEffect(() => {
    if (!selectedJobId || !connected) { setSelectedJobRuns([]); return; }

    const fetchId = ++selectedFetchId.current;

    // 如果有缓存，先立即展示。
    const cached = runsCache.current[selectedJobId];
    if (cached?.length) {
      setSelectedJobRuns([...cached].slice(-14).reverse());
    }

    // 再在后台请求最新数据。
    (async () => {
      try {
        const result = await gateway.listCronRuns(selectedJobId);
        if (fetchId !== selectedFetchId.current) return; // 请求已过期，丢弃结果。
        const job = jobsRef.current.find(j => j.id === selectedJobId);
        const entries = result.entries.slice(-14).reverse().map((e) => ({
          ...e, jobId: selectedJobId, jobName: job?.name || selectedJobId,
        }));
        setSelectedJobRuns(entries);
        setRunsError(null);
      } catch (error) {
        if (fetchId !== selectedFetchId.current) return; // 请求已过期，丢弃结果。
        setRunsError(error instanceof Error ? error.message : String(error));
        if (!cached?.length) setSelectedJobRuns([]);
      }
    })();
  }, [selectedJobId, connected]);

  // ── 操作 ──
  const toggleJob = async (jobId: string, enabled: boolean) => {
    setActionLoading(jobId);
    setCronMutationError(null);
    try {
      await gateway.updateCronJob(
        jobId,
        { enabled },
        jobsRef.current.find((job) => job.id === jobId)?.configRevision,
      );
      if (!await refreshGroup('cron')) throw new Error(t('cron.updateReadbackFailed'));
    } catch (error) {
      setCronMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionLoading(null);
    }
  };

  const runPollEpoch = useRef(0);
  useEffect(() => () => { runPollEpoch.current += 1; }, []);

  const runJob = async (jobId: string) => {
    const epoch = runPollEpoch.current + 1;
    runPollEpoch.current = epoch;
    setActionLoading(`run-${jobId}`);
    setRunResult(p => { const n = { ...p }; delete n[jobId]; return n; });
    setRunsError(null);
    try {
      const acknowledgement = await gateway.enqueueCronRun(jobId);
      const runId = acknowledgement.runId;
      if (!acknowledgement.ok || !acknowledgement.enqueued || !runId) {
        throw new Error(acknowledgement.reason || t('cron.runNotQueued'));
      }
      setRunResult(p => ({ ...p, [jobId]: 'queued' }));
      await refreshGroup('cron');
      const startedAt = Date.now();
      for (;;) {
        const terminal = await gateway.findTerminalCronRun(jobId, runId);
        if (epoch !== runPollEpoch.current) return;
        if (terminal) {
          setRunResult(p => ({ ...p, [jobId]: terminal.status ?? 'error' }));
          await loadSingleJobRuns(jobId);
          return;
        }
        if (Date.now() - startedAt >= OPENCLAW_CRON_RUN_WAIT_TIMEOUT_MS) {
          setRunResult(p => ({ ...p, [jobId]: 'pending' }));
          setRunsError(t('cron.runPendingVerification', 'OpenClaw has not recorded a terminal result; run remains pending verification.'));
          return;
        }
        setRunResult(p => ({ ...p, [jobId]: 'waiting' }));
        await new Promise<void>((resolve) => window.setTimeout(resolve, OPENCLAW_CRON_RUN_POLL_INTERVAL_MS));
        if (epoch !== runPollEpoch.current) return;
      }
    } catch (error) {
      if (epoch === runPollEpoch.current) {
        setRunResult(p => ({ ...p, [jobId]: 'error' }));
        setRunsError(error instanceof Error ? error.message : String(error));
      }
    }
    finally {
      if (epoch === runPollEpoch.current) setActionLoading(null);
    }
  };

  const cronTemplates = useMemo(
    () => getCronTemplates(present, Intl.DateTimeFormat().resolvedOptions().timeZone),
    [present],
  );

  const addTemplate = async (tpl: ReturnType<typeof getCronTemplates>[0]) => {
    setActionLoading(`tpl-${tpl.id}`);
    try {
      await gateway.addCronAgentTurn(buildCronAgentTurnAddParams({
        ...tpl.job,
        agentId: createJob.agentId,
      }));
      const refreshed = await refreshGroup('cron');
      if (!refreshed) throw new Error(t('cron.createReadbackFailed'));
      setTemplateResult(p => ({ ...p, [tpl.id]: 'ok' }));
    } catch { setTemplateResult(p => ({ ...p, [tpl.id]: 'error' })); }
    finally {
      setActionLoading(null);
      setTimeout(() => setTemplateResult(p => { const n = { ...p }; delete n[tpl.id]; return n; }), 2500);
    }
  };

  const updateJobAgent = async (jobId: string, agentId: string) => {
    setPendingAgentId(agentId);
    setActionLoading(`agent-${jobId}`);
    setAgentUpdateError(null);
    try {
      await gateway.updateCronJob(
        jobId,
        cronAgentUpdatePatch(agentId),
        jobsRef.current.find((job) => job.id === jobId)?.configRevision,
      );
      const refreshed = await refreshGroup('cron');
      const confirmed = refreshed
        && isCronAgentSelectionConfirmed(
          useGatewayDataStore.getState().cronJobs,
          jobId,
          agentId,
        );
      if (!confirmed) throw new Error(t('cron.agentReadbackFailed'));
      setPendingAgentId(null);
    } catch (error) {
      setPendingAgentId(null);
      setAgentUpdateError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionLoading(null);
    }
  };

  const deleteJob = async () => {
    const target = deleteTarget;
    if (!target) return;
    setActionLoading(`delete-${target.id}`);
    setCronMutationError(null);
    try {
      await gateway.removeCronJob(target.id);
      setDeleteTarget(null);
      if (!await refreshGroup('cron')) {
        setCronMutationError(t('cron.deleteReadbackFailed'));
        return;
      }
      if (useGatewayDataStore.getState().cronJobs.some((job) => job.id === target.id)) {
        setCronMutationError(t('cron.deleteReadbackFailed'));
        return;
      }
      if (selectedJobId === target.id) setSelectedJobId(null);
    } catch (error) {
      setCronMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionLoading(null);
    }
  };

  useEffect(() => {
    if (jobs.length === 0) return;
    const requestedJob = requestedJobId
      ? jobs.find((job) => job.id === requestedJobId)
      : null;
    if (requestedJob) {
      if (selectedJobId !== requestedJob.id) setSelectedJobId(requestedJob.id);
      return;
    }
    if (!selectedJobId || !jobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(jobs[0].id);
    }
  }, [jobs, requestedJobId, selectedJobId]);

  const selectJob = useCallback((jobId: string) => {
    setSelectedJobId(jobId);
    const next = new URLSearchParams(searchParams);
    next.set('job', jobId);
    next.delete('session');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // ═══ 渲染 ═══
  // 选中任务时显示该任务的运行记录，否则显示最近运行记录。
  const activityRuns = selectedJobId ? selectedJobRuns : recentRuns;
  return (
    <div className="flex flex-col flex-1 min-h-0" style={{ minHeight: 'calc(100vh - 80px)' }}>

      <div className="shrink-0 flex flex-wrap items-center gap-3 px-5 py-3 border-b border-[rgb(var(--aegis-overlay)/0.08)]">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarClock size={18} className="text-aegis-text-muted shrink-0" />
          <div className="min-w-0">
            <div className="text-[16px] font-bold text-aegis-text">{t('cron.title', 'Scheduled tasks')}</div>
            <div className="text-[11px] text-aegis-text-dim">{t('cron.jobsCount', { count: jobs.length })} · {activeCount} {t('cronDetail.active', 'active')}</div>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-aegis-text-dim" aria-live="polite">
          <span className={clsx(
            'size-1.5 shrink-0 rounded-full',
            loading ? 'bg-aegis-text-dim animate-pulse' : cronStatus?.enabled === true ? 'bg-aegis-success' : cronStatus?.enabled === false ? 'bg-aegis-warning' : 'bg-aegis-danger',
          )} />
          <span className="truncate">
            {loading
              ? t('cron.schedulerLoading', '正在读取调度器状态')
              : cronStatusError || !cronStatus
                ? t('cron.schedulerUnavailable', '调度器状态不可用')
                : cronStatus.enabled
                  ? t('cron.schedulerEnabled', '调度器运行中')
                  : t('cron.schedulerDisabled', '调度器已停用')}
          </span>
          {cronStatus?.nextWakeAtMs !== null && cronStatus?.nextWakeAtMs !== undefined && (
            <span className="shrink-0">· {t('cron.nextWakeIn', '下次唤醒 {{time}}', { time: formatCountdown(cronStatus.nextWakeAtMs) })}</span>
          )}
        </div>
        <div className="flex-1" />
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-aegis-text-muted pointer-events-none" />
          <input
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('cron.searchPlaceholder', 'Search jobs...')}
            className="w-full ps-8 pe-3 h-8 rounded-md text-xs
              bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text placeholder:text-aegis-text-muted
              outline-none focus:border-aegis-accent/30 focus:bg-aegis-accent/[0.03] transition-all"
          />
        </div>
        <button onClick={() => { void refreshGroup('cron'); void loadAllRuns(); void refreshSchedulerStatus(); }}
          className="flex items-center gap-1.5 px-3 h-8 rounded-md border border-[rgb(var(--aegis-overlay)/0.08)]
            text-[11px] font-semibold text-aegis-text-muted hover:text-aegis-text-secondary transition-colors">
          <RotateCcw size={12} className={loading ? 'animate-spin' : ''} /> {t('common.refresh', 'Refresh')}
        </button>
        <button onClick={() => setShowTemplates(true)}
          className="flex items-center gap-1.5 px-3 h-8 rounded-md bg-aegis-primary text-white
            text-[11px] font-semibold hover:opacity-90 transition-opacity">
          <Plus size={12} /> {t('cron.newJob', 'New Job')}
        </button>
        <div className="flex items-center gap-1.5 text-[10px] text-aegis-text-dim min-w-0" aria-live="polite">
          {schedulerStatusLoading ? (
            <><LoadingIndicator size={10} /> <span>{t('cron.schedulerStatusLoading')}</span></>
          ) : schedulerStatusError ? (
            <span className="text-aegis-danger">{t(schedulerStatusError === 'unsupported' ? 'cron.schedulerStatusUnsupported' : 'cron.schedulerStatusFailed')}</span>
          ) : schedulerStatus ? (
            <>
              <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', schedulerStatus.enabled ? 'bg-aegis-success' : 'bg-aegis-text-dim')} />
              <span>{t(schedulerStatus.enabled ? 'cron.schedulerEnabled' : 'cron.schedulerDisabled')}</span>
              <span>{t('cron.schedulerJobs', { count: schedulerStatus.jobs })}</span>
              {schedulerStatus.enabled && schedulerStatus.nextWakeAtMs !== null && (
                <span>{t('cron.nextWake')}: {formatCountdown(schedulerStatus.nextWakeAtMs)}</span>
              )}
            </>
          ) : null}
        </div>
        {cronMutationError && (
          <div className="basis-full text-[10px] text-aegis-danger" role="alert">
            {t('cron.updateFailed')}: {cronMutationError}
          </div>
        )}
      </div>

      {/* Master-detail maintenance layout */}
      <div className="flex-1 grid overflow-hidden mc-grid-main">

        {/* ═══ COL 1: Gantt-style Job List ═══ */}
        <div className="border-e border-[rgb(var(--aegis-overlay)/0.06)] flex flex-col overflow-hidden">
          <div className="shrink-0 px-4 py-3 border-b border-[rgb(var(--aegis-overlay)/0.06)] bg-aegis-bg-frosted backdrop-blur-sm sticky top-0 z-10">
            <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold text-aegis-text-secondary">
              {t('cron.scheduledJobs', 'Scheduled Jobs')}
            </h3>
            <span className="text-[10px] text-aegis-text-dim">{sortedJobs.length} / {jobs.length}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(['all', 'active', 'paused', 'error'] as const).map((filter) => (
                <button key={filter} onClick={() => setStatusFilter(filter)} className={clsx(
                  'h-6 px-2 rounded text-[10px] font-semibold transition-colors',
                  statusFilter === filter ? 'bg-aegis-primary/10 text-aegis-primary' : 'text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.04)] hover:text-aegis-text',
                )}>
                  {filter === 'all' ? t('cron.filterAll', 'All') : t(`cronDetail.${filter}`, filter)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <LoadingIndicator size={20} className="text-aegis-text-dim" />
              </div>
            ) : sortedJobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Clock size={24} className="mb-3 text-aegis-text-dim" />
                <p className="text-xs font-semibold text-aegis-text-dim">{t('cron.noJobs')}</p>
                <p className="text-[10px] text-aegis-text-dim mt-1">{t('cron.noJobsHint')}</p>
              </div>
            ) : (
              sortedJobs.map((job) => {
                const color = colorMap[job.id] || dataColor(9);
                const status = getStatus(job);
                const isError = status === 'error';
                const isPaused = status === 'paused';
                const isSelected = selectedJobId === job.id;
                // 已移除没有消费者的进度变量。

                return (
                  // 只保留布局动画，轮询时不重新触发进入动画。
                  <motion.div key={job.id}
                    layout transition={{ layout: { duration: 0.15 } }}
                    onClick={() => selectJob(job.id)}
                    className={clsx(
                      'flex items-stretch gap-0 mb-1 rounded-md overflow-hidden cursor-pointer transition-colors border',
                      isSelected ? 'border-aegis-accent/20 bg-aegis-accent/[0.03]' : 'border-[rgb(var(--aegis-overlay)/0.06)] bg-[rgb(var(--aegis-overlay)/0.02)] hover:bg-[rgb(var(--aegis-overlay)/0.03)]',
                      isError && 'border-aegis-danger/15',
                      isPaused && 'opacity-35',
                    )}>
                    {/* Color bar */}
                    <div className="w-[3px] shrink-0" style={{
                      background: isPaused ? 'rgb(var(--aegis-overlay) / 0.06)' : color,
                      ...(isError ? { animation: 'mc-err-pulse 1.5s ease-in-out infinite' } : {}),
                    }} />

                    {/* Info */}
                    <div className="flex-1 min-w-0 py-3 ps-3.5 pe-2">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[13px]"><Clock size={14} strokeWidth={1.75} /></span>
                        <span className={clsx('text-[13px] font-bold truncate',
                          isError && 'text-aegis-danger/80',
                          isSelected && !isError && 'text-aegis-accent',
                          isPaused && 'text-aegis-text-muted',
                        )}>
                          {job.name || job.id.substring(0, 8)}
                        </span>
                      </div>
                      <div className="text-[10px] text-aegis-text-muted flex items-center gap-2 flex-wrap">
                        {formatSchedule(job.schedule)}
                        <span>{agentName(job.agentId)}</span>
                        {isError && (
                          <span className="text-[9px] font-bold text-aegis-danger/50 bg-aegis-danger/[0.08] px-1.5 py-0.5 rounded">
                            {job.state?.lastError?.substring(0, 20) || 'error'}
                          </span>
                        )}
                        {status === 'active' && (
                          <span className="text-[9px] font-bold text-aegis-primary/50 bg-aegis-primary/[0.08] px-1.5 py-0.5 rounded">
                            {formatTimeAgo(getLastRun(job))}
                          </span>
                        )}
                        {isPaused && <span className="text-aegis-warning/50">{t('cronDetail.paused').toLowerCase()}</span>}
                        {job.schedule.kind === 'cron' && job.schedule.staggerMs !== undefined && (
                          <span className="text-[9px] font-bold text-aegis-warning/50 bg-aegis-warning/[0.08] px-1.5 py-0.5 rounded shrink-0">
                            {t('cron.stagger')}: {formatDuration(job.schedule.staggerMs)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Time Left */}
                    <div className="w-[100px] shrink-0 flex flex-col items-end justify-center pe-3 py-2">
                      <span className="text-[8px] text-aegis-text-dim font-medium mb-0.5">{t('cron.timeLeft', 'Time Left')}</span>
                      <span className="text-sm font-bold font-mono" style={{
                        color: isError ? tc.danger : isPaused ? 'rgb(var(--aegis-overlay) / 0.1)' : color,
                      }}>
                        {isError ? t('cronDetail.error', 'Error') : isPaused ? '—' : formatCountdown(getNextRun(job))}
                      </span>
                    </div>

                        {/* 操作 */}
                    <div className="flex items-center gap-1.5 pe-3 shrink-0">
                      {/* Toggle */}
                      <button onClick={(e) => { e.stopPropagation(); toggleJob(job.id, !job.enabled); }}
                        disabled={actionLoading === job.id}
                        className={clsx(
                          'w-8 h-[18px] rounded-full relative border transition-all shrink-0',
                          job.enabled ? 'bg-aegis-primary/25 border-aegis-primary/40' : 'bg-[rgb(var(--aegis-overlay)/0.05)] border-[rgb(var(--aegis-overlay)/0.1)]',
                        )}>
                        <div className={clsx(
                          'absolute top-[2px] w-3 h-3 rounded-full transition-all',
                          job.enabled ? 'start-[16px] bg-aegis-primary' : 'start-[2px] bg-[rgb(var(--aegis-overlay)/0.2)]',
                        )} style={job.enabled ? { boxShadow: `0 0 6px ${tc.primaryA50}` } : undefined} />
                      </button>
                      {/* Run */}
                      <button onClick={(e) => { e.stopPropagation(); runJob(job.id); }}
                        disabled={!!actionLoading || cronRunInFlight(runResult[job.id])}
                        title={runResult[job.id] === 'queued' ? t('cron.runQueued')
                          : runResult[job.id] === 'waiting' ? t('cron.runWaiting')
                            : runResult[job.id] === 'pending' ? t('cron.runPendingVerification')
                            : t('cron.runNow')}
                        aria-label={runResult[job.id] === 'queued' ? t('cron.runQueued')
                          : runResult[job.id] === 'waiting' ? t('cron.runWaiting')
                            : runResult[job.id] === 'pending' ? t('cron.runPendingVerification')
                            : t('cron.runNow')}
                        className={clsx(
                          'w-7 h-7 rounded-lg flex items-center justify-center border transition-all text-[11px] shrink-0',
                          runResult[job.id] === 'ok' ? 'bg-aegis-primary/10 border-aegis-primary/30 text-aegis-primary'
                          : runResult[job.id] === 'error' || runResult[job.id] === 'skipped' ? 'bg-aegis-danger/10 border-aegis-danger/30 text-aegis-danger'
                          : runResult[job.id] === 'pending' ? 'bg-aegis-warning/10 border-aegis-warning/30 text-aegis-warning'
                          : isError ? 'border-aegis-danger/20 text-aegis-danger/50 hover:text-aegis-danger hover:border-aegis-danger/40'
                          : 'border-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-dim hover:text-aegis-accent hover:border-aegis-accent/30 hover:bg-aegis-accent/[0.04]',
                        )}>
                        {actionLoading === `run-${job.id}` || cronRunLoading(runResult[job.id]) ? <LoadingIndicator size={11} />
                          : runResult[job.id] === 'ok' ? <Check size={11} />
                          : runResult[job.id] === 'error' || runResult[job.id] === 'skipped' ? <X size={11} />
                          : runResult[job.id] === 'pending' ? <Clock size={11} />
                          : isError ? <RotateCcw size={11} />
                          : <Play size={11} fill="currentColor" />}
                      </button>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>

        {/* Detail + Activity Log */}
        <div className="flex flex-col overflow-hidden">

          {/* Selected Job Detail */}
          <AnimatePresence mode="wait">
            {selectedJob ? (
              <motion.div key={selectedJob.id}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="shrink-0 p-4 border-b border-[rgb(var(--aegis-overlay)/0.06)] bg-[rgb(var(--aegis-overlay)/0.005)]">
                {/* Header */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-md flex items-center justify-center border shrink-0"
                    style={{ background: `${colorMap[selectedJob.id]}10`, borderColor: `${colorMap[selectedJob.id]}25` }}>
                    <Clock size={14} strokeWidth={1.75} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-bold truncate">{selectedJob.name || selectedJob.id}</div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <span className="text-[11px] text-aegis-text-muted">{formatSchedule(selectedJob.schedule)}</span>
                      <span className="text-[11px] text-aegis-text-muted">
                        {t('cron.agent')}: {agentName(selectedJob.agentId)}
                      </span>
                      {selectedJob.schedule.kind === 'cron' && selectedJob.schedule.staggerMs !== undefined && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded
                          bg-aegis-accent/10 border border-aegis-accent/20 text-aegis-accent/70 shrink-0">
                          {t('cron.stagger')}: {formatDuration(selectedJob.schedule.staggerMs)}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget({ id: selectedJob.id, name: selectedJob.name || selectedJob.id })}
                    disabled={actionLoading !== null}
                    title={t('cron.deleteJob')}
                    aria-label={t('cron.deleteJob')}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-aegis-danger/25 text-aegis-danger transition-colors hover:bg-aegis-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-danger/40 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {(selectedJobDetailLoading || selectedJobDetailError) && (
                  <div className="mb-2 text-[9px] text-aegis-text-dim" aria-live="polite">
                    {selectedJobDetailLoading
                      ? t('cron.jobDetailLoading', '正在读取 OpenClaw 任务详情')
                      : t('cron.jobDetailUnavailable', '任务详情暂不可用，当前显示列表快照')}
                  </div>
                )}
                {/* Status badge */}
                <div className={clsx(
                  'inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold border mb-3',
                  getStatus(selectedJob) === 'active' ? 'bg-aegis-primary/[0.08] border-aegis-primary/15 text-aegis-primary'
                  : getStatus(selectedJob) === 'error' ? 'bg-aegis-danger/[0.08] border-aegis-danger/15 text-aegis-danger'
                  : 'bg-[rgb(var(--aegis-overlay)/0.03)] border-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-muted',
                )}>
                  <span className="w-[6px] h-[6px] rounded-full" style={{
                    background: getStatus(selectedJob) === 'active' ? tc.primary : getStatus(selectedJob) === 'error' ? tc.danger : 'rgb(var(--aegis-overlay) / 0.2)',
                  }} />
                  {getStatus(selectedJob) === 'active' ? t('cronDetail.active') : getStatus(selectedJob) === 'error' ? t('cronDetail.error') : t('cronDetail.paused')}
                  {selectedJob.sessionTarget === 'isolated' && ` · ${t('cronDetail.isolated')}`}
                </div>
                {/* Delivery status badge (Gateway 2026.2.22+) */}
                {getDeliveryStatus(selectedJob) && (
                  <div className={clsx(
                    'inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold border mb-3',
                    getDeliveryStatus(selectedJob) === 'delivered' ? 'bg-aegis-success/[0.08] border-aegis-success/15 text-aegis-success ms-2'
                    : getDeliveryStatus(selectedJob) === 'failed' ? 'bg-aegis-danger/[0.08] border-aegis-danger/15 text-aegis-danger ms-2'
                    : 'bg-[rgb(var(--aegis-overlay)/0.03)] border-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-muted ms-2',
                  )}>
                    <span className="w-[6px] h-[6px] rounded-full" style={{
                      background: getDeliveryStatus(selectedJob) === 'delivered' ? tc.success : getDeliveryStatus(selectedJob) === 'failed' ? tc.danger : 'rgb(var(--aegis-overlay) / 0.2)',
                    }} />
                    {getDeliveryStatus(selectedJob) === 'delivered' ? t('cron.delivered') : getDeliveryStatus(selectedJob) === 'failed' ? t('cron.deliveryFailed') : t('cron.deliveryUnknown')}
                  </div>
                )}

                <div className="mb-3 flex items-center gap-2 text-[10px] text-aegis-text-dim">
                  <label htmlFor="cron-job-agent" className="shrink-0">{t('cron.agent')}</label>
                  <Select
                    value={agentSelectValue(selectedAgentValue)}
                    onValueChange={(value) => { void updateJobAgent(selectedJob.id, agentIdFromSelectValue(value)); }}
                    disabled={agentSelectionDisabled || actionLoading === `agent-${selectedJob.id}`}
                  >
                    <SelectTrigger
                      id="cron-job-agent"
                      aria-label={t('cron.agent')}
                      className="h-8 min-w-0 flex-1 border-aegis-border bg-aegis-surface-solid px-2 text-[11px] text-aegis-text focus:ring-aegis-primary/40"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-aegis-border bg-aegis-card-solid text-aegis-text">
                      <SelectItem value={DEFAULT_AGENT_SELECT_VALUE} className="text-[11px]">{t('cron.defaultAgent')}</SelectItem>
                      {selectedAgentOptions.map((agent) => (
                        <SelectItem key={agent.id} value={agentSelectValue(agent.id)} className="text-[11px]">
                          {agent.unavailable ? t('cron.unavailableAgent', { id: agent.label }) : agent.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {agentAvailability === 'loading' && (
                  <div className="mb-3 flex items-center gap-2 text-[10px] text-aegis-text-dim" role="status">
                    <LoadingIndicator size={10} /> {t('cron.agentsLoading')}
                  </div>
                )}
                {agentAvailability === 'empty' && (
                  <div className="mb-3 text-[10px] text-aegis-text-dim">{t('cron.noAgents')}</div>
                )}
                {agentAvailability === 'error' && (
                  <div className="mb-3 flex items-start justify-between gap-2 rounded-md border border-aegis-danger/20 bg-aegis-danger/[0.08] px-2.5 py-2 text-[10px] text-aegis-danger" role="alert">
                    <span>{t('cron.agentsLoadFailed')}: {agentsError}</span>
                    <button type="button" onClick={retryAgents} className="shrink-0 rounded px-1.5 py-0.5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40">
                      {t('common.retry')}
                    </button>
                  </div>
                )}
                {agentUpdateError && (
                  <div className="mb-3 rounded-md border border-aegis-danger/20 bg-aegis-danger/[0.08] px-2.5 py-2 text-[10px] text-aegis-danger" role="alert">
                    {t('cron.agentUpdateFailed')}: {agentUpdateError}
                  </div>
                )}

                {/* Compact operational summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 border-y border-[rgb(var(--aegis-overlay)/0.06)] mb-3">
                  {[
                    { v: selectedJobRuns.length || '—', l: t('cron.totalRuns', 'Total Runs'), c: tc.primary },
                    { v: formatCountdown(getNextRun(selectedJob)), l: t('cron.timeLeft', 'Time Left'), c: tc.accent },
                    { v: formatDuration(selectedJob.state?.lastDurationMs), l: t('cron.lastDur', 'Last Dur.'), c: tc.warning },
                    { v: selectedJobRuns.length > 0 ? `${Math.round(selectedJobRuns.filter(r => r.status === 'ok').length / selectedJobRuns.length * 100)}%` : '—', l: t('cron.successRate', 'Success Rate'), c: tc.success },
                  ].map(s => (
                    <div key={s.l} className="py-2 px-2 first:ps-0">
                      <div className="text-[13px] font-semibold leading-none text-aegis-text">{s.v}</div>
                      <div className="text-[9px] text-aegis-text-dim mt-1">{s.l}</div>
                    </div>
                  ))}
                </div>

                {/* Sparkline: last 14 runs */}
                {selectedJobRuns.length > 0 && (
                  <>
                    <div className="text-[10px] text-aegis-text-dim font-semibold mb-1.5">
                      {t('cron.lastNRuns', 'Last {{n}} Runs').replace('{{n}}', String(selectedJobRuns.length))}
                    </div>
                    <div className="flex items-end gap-[3px] h-8 mb-3">
                      {selectedJobRuns.map((run, i) => {
                        const isOk = run.status === 'ok';
                        const maxDur = Math.max(...selectedJobRuns.map(r => r.durationMs || 1000));
                        const h = Math.max(4, ((run.durationMs || 500) / maxDur) * 100);
                        return (
                          <div key={i} className="flex-1 rounded-sm transition-all hover:opacity-80" style={{
                            height: `${h}%`,
                            background: isOk ? (colorMap[selectedJob.id] || tc.primary) : tc.danger,
                            animation: `mc-bar-grow 0.4s ease-out ${i * 0.03}s backwards`,
                          }} title={`${formatDuration(run.durationMs)} ${isOk ? t('cron.completed', 'Completed') : t('cron.failed', 'Failed')}`} />
                        );
                      })}
                    </div>
                  </>
                )}

                {/* 操作 */}
                <div className="flex gap-1.5">
                  <button onClick={() => runJob(selectedJob.id)}
                    disabled={!!actionLoading || cronRunInFlight(runResult[selectedJob.id])}
                    className="flex-1 py-2 rounded-md text-center text-[11px] font-semibold
                      bg-aegis-primary/[0.08] border border-aegis-primary/20 text-aegis-primary
                      hover:bg-aegis-primary/15 transition-colors disabled:opacity-40">
                    {actionLoading === `run-${selectedJob.id}` || cronRunLoading(runResult[selectedJob.id])
                      ? <span className="flex items-center justify-center gap-1.5"><LoadingIndicator size={12} />
                        {runResult[selectedJob.id] === 'queued' ? t('cron.runQueued')
                          : runResult[selectedJob.id] === 'pending' ? t('cron.runPendingVerification')
                            : t('cron.runWaiting')}</span>
                      : runResult[selectedJob.id] === 'ok' ? t('cronDetail.done')
                        : runResult[selectedJob.id] === 'skipped' ? t('cron.runSkipped')
                          : runResult[selectedJob.id] === 'pending' ? t('cron.runPendingVerification')
                            : runResult[selectedJob.id] === 'error' ? t('cron.failed') : t('cronDetail.runNow')}
                  </button>
                  <button onClick={() => toggleJob(selectedJob.id, !selectedJob.enabled)}
                    disabled={!!actionLoading}
                    className="flex-1 py-2 rounded-md text-center text-[11px] font-semibold
                      bg-[rgb(var(--aegis-overlay)/0.02)] border border-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-muted
                      hover:text-aegis-text-secondary transition-colors disabled:opacity-40">
                    {selectedJob.enabled ? t('cronDetail.pause') : t('cronDetail.enable')}
                  </button>
                </div>
              </motion.div>
            ) : (
              <div className="shrink-0 p-5 border-b border-[rgb(var(--aegis-overlay)/0.06)] text-center">
                <CalendarClock size={22} className="mx-auto mb-2 text-aegis-text-dim" />
                <div className="text-[11px] text-aegis-text-dim">{t('cron.selectJob', 'Select a job')}</div>
              </div>
            )}
          </AnimatePresence>

          {/* 活动记录默认收起到 5 条，展开后允许滚动查看。 */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-[rgb(var(--aegis-overlay)/0.06)]
              bg-aegis-bg-frosted backdrop-blur-sm">
              <h4 className="text-[11px] font-semibold text-aegis-text-muted truncate">
                {selectedJob
                  ? `${selectedJob.name || selectedJob.id} — ${t('cronDetail.activityLog')}`
                  : t('cronDetail.activityLog')}
              </h4>
              {activityRuns.length > 0 && (
                <span className="text-[9px] font-mono text-aegis-text-dim bg-[rgb(var(--aegis-overlay)/0.04)] px-1.5 py-0.5 rounded">
                  {activityRuns.length}
                </span>
              )}
            </div>
            <div className={clsx('px-2 py-1', showAllLogs ? 'flex-1 overflow-y-auto' : 'overflow-hidden')}>
              {runsError ? (
                <div className="text-[10px] text-aegis-danger py-4 px-3" role="alert">{runsError}</div>
              ) : loadingRuns ? (
                <div className="flex items-center gap-2 py-4 px-3 text-[10px] text-aegis-text-dim">
                  <LoadingIndicator size={12} /> {t('common.loading')}
                </div>
              ) : activityRuns.length === 0 ? (
                <div className="text-[10px] text-aegis-text-dim py-4 px-3">{t('cron.noRunsYet', 'No runs yet')}</div>
              ) : (
                <>
                  {/* 运行记录轮询时保持稳定布局，避免重复触发进入动画。 */}
                  {/* 使用运行记录身份和索引组成稳定键。 */}
                  {(showAllLogs ? activityRuns : activityRuns.slice(0, 5)).map((run, i) => {
                    const color = colorMap[run.jobId || ''] || dataColor(9);
                    const isOk = run.status === 'ok';
                    const isFailure = run.status === 'error';
                    const isSkipped = run.status === 'skipped';
                    const runColor = isOk ? color : isFailure ? tc.danger : isSkipped ? tc.warning : 'rgb(var(--aegis-overlay) / 0.3)';
                    return (
                      <div key={`${run.jobId}-${run.ts}-${run.durationMs}-${i}`}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-lg mb-0.5
                          hover:bg-[rgb(var(--aegis-overlay)/0.02)] transition-colors">
                        <div className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: runColor }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-semibold truncate"
                            style={!isOk ? { color: runColor } : undefined}>
                            {run.jobName || t('cron.job', 'Job')}
                          </div>
                          <div className="text-[9px] text-aegis-text-dim truncate"
                            style={!isOk ? { color: runColor } : undefined}>
                            {run.summary || run.error || (isOk ? t('cron.completed', 'Completed') : isSkipped ? t('cronDetail.skipped', 'Skipped') : t('cron.failed', 'Failed'))}
                          </div>
                        </div>
                        <div className="text-[8px] font-mono text-aegis-text-dim px-1.5 py-0.5 rounded
                          bg-[rgb(var(--aegis-overlay)/0.02)] shrink-0"
                          style={!isOk ? { color: runColor } : undefined}>
                          {formatDuration(run.durationMs)}
                        </div>
                        <div className="text-[9px] text-aegis-text-dim font-mono shrink-0 w-9 text-end">
                          {run.ts ? formatTimeAgo(run.ts) : '—'}
                        </div>
                      </div>
                    );
                  })}
                  {/* 展开或收起运行记录。 */}
                  {activityRuns.length > 5 && (
                    <button onClick={() => setShowAllLogs(!showAllLogs)}
                      className="w-full py-2 mt-1 rounded-lg text-[10px] font-semibold
                        text-aegis-accent/50 hover:text-aegis-accent hover:bg-aegis-accent/[0.04] transition-colors">
                      {showAllLogs ? t('cronDetail.showLess') : t('cronDetail.showMore', { n: activityRuns.length - 5 })}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ 模板对话框 ═══ */}
      <Dialog open={showTemplates} onOpenChange={(open) => setShowTemplates(open)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-2rem))] max-w-none gap-0 overflow-y-auto border-aegis-border bg-aegis-card-solid p-0 text-aegis-text shadow-2xl sm:rounded-2xl">
          <DialogHeader className="border-b border-aegis-border px-5 py-4 pe-12 text-start">
            <DialogTitle className="text-base font-extrabold text-aegis-text">{t('cron.templatesTitle', 'Quick Templates')}</DialogTitle>
            <DialogDescription className="text-[11px] text-aegis-text-dim">{t('cron.templatesSubtitle', 'Add a pre-configured job with one click')}</DialogDescription>
          </DialogHeader>
          <div className="p-5">
            <div className="mb-3 flex items-center gap-2 text-[10px] text-aegis-text-dim">
              <label htmlFor="cron-template-agent" className="shrink-0">{t('cron.agent')}</label>
              <Select
                value={agentSelectValue(createJob.agentId)}
                onValueChange={(value) => setCreateJob((state) => ({ ...state, agentId: agentIdFromSelectValue(value) }))}
                disabled={agentSelectionDisabled}
              >
                <SelectTrigger id="cron-template-agent" className="h-8 min-w-0 flex-1 border-aegis-border bg-aegis-surface-solid px-2 text-[11px] text-aegis-text focus:ring-aegis-primary/40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-aegis-border bg-aegis-card-solid text-aegis-text">
                  <SelectItem value={DEFAULT_AGENT_SELECT_VALUE} className="text-[11px]">{t('cron.defaultAgent')}</SelectItem>
                  {createAgentOptions.map((agent) => (
                    <SelectItem key={agent.id} value={agentSelectValue(agent.id)} className="text-[11px]">
                      {agent.unavailable ? t('cron.unavailableAgent', { id: agent.label }) : agent.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {agentAvailability === 'loading' && <div className="mb-4 flex items-center gap-2 text-[10px] text-aegis-text-dim" role="status"><LoadingIndicator size={10} /> {t('cron.agentsLoading')}</div>}
            {agentAvailability === 'empty' && <div className="mb-4 text-[10px] text-aegis-text-dim">{t('cron.noAgents')}</div>}
            {agentAvailability === 'error' && (
              <div className="mb-4 flex items-start justify-between gap-2 rounded-md border border-aegis-danger/20 bg-aegis-danger/[0.08] px-2.5 py-2 text-[10px] text-aegis-danger" role="alert">
                <span>{t('cron.agentsLoadFailed')}: {agentsError}</span>
                <button type="button" onClick={retryAgents} className="shrink-0 rounded px-1.5 py-0.5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40">{t('common.retry')}</button>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {cronTemplates.map(tpl => {
                const isAdded = templateResult[tpl.id] === 'ok';
                const isFailed = templateResult[tpl.id] === 'error';
                const isLoading = actionLoading === `tpl-${tpl.id}`;
                return (
                  <div key={tpl.id} className="p-4 rounded-xl bg-[rgb(var(--aegis-overlay)/0.02)] border border-[rgb(var(--aegis-overlay)/0.06)] hover:border-[rgb(var(--aegis-overlay)/0.12)] transition-colors">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-base border shrink-0" style={{ background: `${dataColor(tpl.colorIdx)}10`, borderColor: `${dataColor(tpl.colorIdx)}25` }}>{tpl.icon}</div>
                      <div className="text-sm font-bold">{tpl.name}</div>
                    </div>
                    <div className="text-[10px] text-aegis-text-muted leading-relaxed mb-3">{tpl.desc}</div>
                    <button onClick={() => addTemplate(tpl)} disabled={isLoading || isAdded} className={clsx(
                      'w-full py-2 rounded-lg text-[11px] font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40 disabled:opacity-60',
                      isAdded ? 'bg-aegis-primary/10 border-aegis-primary/30 text-aegis-primary'
                      : isFailed ? 'bg-aegis-danger/10 border-aegis-danger/30 text-aegis-danger'
                      : 'bg-[rgb(var(--aegis-overlay)/0.03)] border-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-muted hover:text-aegis-accent hover:border-aegis-accent/30',
                    )}>
                      {isLoading ? t('common.loading') : isAdded ? t('cronDetail.added') : isFailed ? t('cronDetail.addError') : t('cronDetail.add')}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter className="border-t border-aegis-border px-5 py-3">
            <DialogClose className="w-full rounded-lg border border-aegis-border px-3 py-2 text-[11px] text-aegis-text-muted transition-colors hover:bg-aegis-hover/40 hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40 sm:w-auto">
              {t('common.close', 'Close')}
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Create Task Dialog (split-button quick-create entry) ── */}
      <Dialog
        open={showCreateForm}
        onOpenChange={(open) => {
          if (!open && creating) return;
          setShowCreateForm(open);
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event) => { if (creating) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (creating) event.preventDefault(); }}
          className="max-h-[calc(100dvh-2rem)] w-[min(448px,calc(100vw-2rem))] max-w-none gap-0 overflow-y-auto border-aegis-border bg-aegis-card-solid p-0 text-aegis-text shadow-2xl sm:rounded-2xl"
        >
          <DialogHeader className="border-b border-aegis-border px-5 py-4 pe-12 text-start">
            <DialogTitle className="text-sm font-bold text-aegis-text">{t('cron.createNewJob', '新建定时任务')}</DialogTitle>
            <DialogDescription className="sr-only">{t('cron.createDescription')}</DialogDescription>
          </DialogHeader>
          <div className="p-5 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-aegis-text-dim">{t('cron.field.name', '任务名称')}</span>
              <input autoFocus value={createJob.name} onChange={e => setCreateJob((state) => ({ ...state, name: e.target.value }))} placeholder={t('cron.placeholder.name', '例如：每日早报')} className="px-3 py-2 rounded-lg text-[12.5px] bg-[rgb(var(--aegis-overlay)/0.04)] border border-aegis-border text-aegis-text placeholder:text-aegis-text-muted focus:border-aegis-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40" />
            </label>
            <div className="flex flex-col gap-1">
              <label htmlFor="cron-create-agent" className="text-[10.5px] font-semibold uppercase tracking-wider text-aegis-text-dim">{t('cron.agent')}</label>
              <Select value={agentSelectValue(createJob.agentId)} onValueChange={(value) => setCreateJob((state) => ({ ...state, agentId: agentIdFromSelectValue(value) }))} disabled={agentSelectionDisabled}>
                <SelectTrigger id="cron-create-agent" className="h-[38px] rounded-lg border-aegis-border bg-[rgb(var(--aegis-overlay)/0.04)] px-3 text-[12.5px] text-aegis-text focus:ring-aegis-primary/40"><SelectValue /></SelectTrigger>
                <SelectContent className="border-aegis-border bg-aegis-card-solid text-aegis-text">
                  <SelectItem value={DEFAULT_AGENT_SELECT_VALUE} className="text-[12px]">{t('cron.defaultAgent')}</SelectItem>
                  {createAgentOptions.map((agent) => (
                    <SelectItem key={agent.id} value={agentSelectValue(agent.id)} className="text-[12px]">{agent.unavailable ? t('cron.unavailableAgent', { id: agent.label }) : agent.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {agentAvailability === 'loading' && <span className="flex items-center gap-2 text-[10px] text-aegis-text-dim" role="status"><LoadingIndicator size={10} /> {t('cron.agentsLoading')}</span>}
              {agentAvailability === 'empty' && <span className="text-[10px] text-aegis-text-dim">{t('cron.noAgents')}</span>}
              {agentAvailability === 'ready' && <span className="text-[10px] text-aegis-text-dim">{t('cron.agentHint')}</span>}
              {agentAvailability === 'error' && (
                <div className="flex items-start justify-between gap-2 rounded-md border border-aegis-danger/20 bg-aegis-danger/[0.08] px-2.5 py-2 text-[10px] text-aegis-danger" role="alert">
                  <span>{t('cron.agentsLoadFailed')}: {agentsError}</span>
                  <button type="button" onClick={retryAgents} className="shrink-0 rounded px-1.5 py-0.5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40">{t('common.retry')}</button>
                </div>
              )}
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-aegis-text-dim">{t('cron.field.expr', 'Cron 表达式')}</span>
              <input value={createJob.cronExpr} onChange={e => setCreateJob((state) => ({ ...state, cronExpr: e.target.value }))} placeholder="0 9 * * *" className="px-3 py-2 rounded-lg text-[12.5px] font-mono bg-[rgb(var(--aegis-overlay)/0.04)] border border-aegis-border text-aegis-text placeholder:text-aegis-text-muted focus:border-aegis-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-aegis-text-dim">{t('cron.field.message', '执行消息')}</span>
              <textarea value={createJob.message} onChange={e => setCreateJob((state) => ({ ...state, message: e.target.value }))} placeholder={t('cron.placeholder.message', '任务触发时发给 agent 的指令')} rows={3} className="px-3 py-2 rounded-lg text-[12.5px] bg-[rgb(var(--aegis-overlay)/0.04)] border border-aegis-border text-aegis-text placeholder:text-aegis-text-muted focus:border-aegis-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40 resize-none" />
            </label>
            {createError && <div className="text-[11px] text-aegis-danger bg-aegis-danger/10 border border-aegis-danger/20 rounded-lg px-3 py-2" role="alert">{createError}</div>}
          </div>
          <DialogFooter className="border-t border-aegis-border bg-[rgb(var(--aegis-overlay)/0.02)] px-5 py-3">
            <DialogClose disabled={creating} className="px-3 py-1.5 rounded-lg text-[11.5px] text-aegis-text-muted transition-colors hover:bg-aegis-hover/40 hover:text-aegis-text border border-aegis-border active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40 disabled:opacity-50">{t('common.cancel', '取消')}</DialogClose>
            <button
              onClick={async () => {
                if (!createJob.name.trim() || !createJob.message.trim()) {
                  setCreateError(t('cron.error.required', '名称和消息不能为空'));
                  return;
                }
                setCreating(true);
                setCreateError(null);
                try {
                  await gateway.addCronAgentTurn(buildCronAgentTurnAddParams({
                    name: createJob.name,
                    agentId: createJob.agentId,
                    schedule: { kind: 'cron', expr: createJob.cronExpr.trim(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
                    message: createJob.message,
                    enabled: true,
                  }));
                  const refreshed = await refreshGroup('cron');
                  if (!refreshed) throw new Error(t('cron.createReadbackFailed'));
                  setShowCreateForm(false);
                  setCreateJob({ name: '', cronExpr: '0 9 * * *', message: '', agentId: '' });
                } catch (error) {
                  setCreateError(error instanceof Error ? error.message : String(error));
                } finally {
                  setCreating(false);
                }
              }}
              disabled={creating}
              className="inline-flex min-w-[72px] items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-semibold bg-aegis-accent text-aegis-btn-primary-text transition-[filter,transform] hover:brightness-110 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/45 disabled:opacity-50"
            >
              {creating ? <LoadingIndicator size={11} className="inline" /> : null}
              {t('common.create', '创建')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && deleteTarget && actionLoading !== `delete-${deleteTarget.id}`) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event) => {
            if (deleteTarget && actionLoading === `delete-${deleteTarget.id}`) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (deleteTarget && actionLoading === `delete-${deleteTarget.id}`) event.preventDefault();
          }}
          className="w-[min(420px,calc(100vw-2rem))] max-w-none gap-0 border-aegis-border bg-aegis-card-solid p-0 text-aegis-text shadow-2xl sm:rounded-lg"
        >
          <DialogHeader className="border-b border-aegis-border px-5 py-4 pe-12 text-start">
            <DialogTitle className="text-sm font-bold text-aegis-text">{t('cron.deleteJob')}</DialogTitle>
            <DialogDescription className="text-[11px] text-aegis-text-dim">
              {t('cron.deleteJobDescription', { name: deleteTarget?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-t border-aegis-border bg-[rgb(var(--aegis-overlay)/0.02)] px-5 py-3">
            <DialogClose
              disabled={deleteTarget !== null && actionLoading === `delete-${deleteTarget.id}`}
              className="px-3 py-1.5 text-[11.5px] text-aegis-text-muted transition-colors hover:bg-aegis-hover/40 hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40 disabled:opacity-50"
            >
              {t('common.cancel')}
            </DialogClose>
            <button
              type="button"
              onClick={() => { void deleteJob(); }}
              disabled={deleteTarget === null || actionLoading === `delete-${deleteTarget?.id}`}
              className="inline-flex min-w-[72px] items-center justify-center gap-1.5 rounded-md bg-aegis-danger px-3 py-1.5 text-[11.5px] font-semibold text-aegis-btn-primary-text transition-[filter,transform] hover:brightness-110 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-danger/45 disabled:opacity-50"
            >
              {deleteTarget && actionLoading === `delete-${deleteTarget.id}` ? <LoadingIndicator size={11} /> : <Trash2 size={11} />}
              {t('cron.deleteJob')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 动画关键帧统一放在 index.css，避免每次渲染重复创建样式。 */}
    </div>
  );
}
