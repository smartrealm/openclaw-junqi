import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Bot,
  CheckCircle2,
  Clock3,
  Coins,
  Cpu,
  FolderKanban,
  MemoryStick,
  Puzzle,
  RefreshCw,
  ShieldAlert,
  TerminalSquare,
  Timer,
  Wrench,
} from 'lucide-react';
import clsx from 'clsx';
import { SceneTransition } from '@/components/shared/SceneTransition';
import { StatusBadge, type LifecycleState } from '@/components/shared/StatusBadge';
import { useChatStore, type Session } from '@/stores/chatStore';
import { ensureGroupFresh, refreshAll, useGatewayDataStore, type SessionInfo } from '@/stores/gatewayDataStore';
import { useAgentWorkspaceStore, type AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';
import { useSkillsStore } from '@/stores/skillsStore';
import { agentTaskNeedsAttention } from '@/pages/AgentWorkspace/taskListModel';
import { sessionActivityTime } from '@/components/Layout/sidebarUtils';
import { getAgentDisplayName } from '@/utils/agentDisplayName';
import { getSessionDisplayLabel } from '@/utils/sessionLabel';
import { projectSessionActivity, type SessionActivity } from '@/utils/sessionPresentation';
import { formatTokens } from '@/utils/format';
import { shortModelName, formatActivityTimeTitle } from '@/pages/Dashboard/dashboardData';
import { activitySessionMetrics, mergeActivitySessions, type ActivitySessionRecord } from '@/utils/activitySessions';

type ActivityFilter = 'all' | 'running' | 'attention' | 'done' | 'failed';

interface ActivityEntry {
  id: string;
  title: string;
  kind: 'session' | 'workspace';
  agent: string;
  model?: string;
  runtime?: string;
  project?: string;
  status: string;
  statusLabel: string;
  lifecycle: LifecycleState;
  timestamp: number;
  durationMs?: number;
  tokens?: number;
  cost?: number;
  attention: boolean;
  href: string;
}

interface ActivityLabels {
  mainSession: string;
  genericSession: string;
  status: Record<string, string>;
}

const STATUS_LABELS: Record<string, string> = {
  running: '运行中',
  input_required: '等待输入',
  awaiting_review: '等待审阅',
  failed: '失败',
  done: '已完成',
  cancelled: '已取消',
  interrupted: '已中断',
  detached: '已分离',
  pending: '等待运行',
  todo: '待开始',
  stopped: '已停止',
  unknown: '未开始',
};

function statusLabel(status: string, labels: Record<string, string> = STATUS_LABELS): string {
  return labels[status] ?? status;
}

function toLifecycle(status: string, attention: boolean): LifecycleState {
  if (attention || status === 'input_required' || status === 'awaiting_review') return 'attention';
  if (status === 'running') return 'running';
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'done' || status === 'completed' || status === 'success') return 'ended';
  return 'idle';
}

function isTerminalStatus(status: string): boolean {
  return ['done', 'completed', 'success', 'failed', 'error', 'cancelled', 'interrupted'].includes(status);
}

function formatDuration(ms?: number): string | null {
  if (!Number.isFinite(ms) || !ms || ms <= 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function formatCost(cost?: number): string | null {
  if (!Number.isFinite(cost) || !cost || cost <= 0) return null;
  return `$${cost < 0.01 ? cost.toFixed(3) : cost.toFixed(2)}`;
}

function runtimeForSession(session: Session): string {
  return session.origin?.surface || session.origin?.provider || session.channel || 'Gateway';
}

function agentIdForSession(session: Session | SessionInfo): string {
  return session.agentId || session.key.split(':')[1] || 'main';
}

function workspaceEntry(task: AgentWorkspaceTask, labels: ActivityLabels): ActivityEntry {
  const attention = agentTaskNeedsAttention(task);
  const durationMs = isTerminalStatus(task.status) ? Math.max(0, task.updatedAt - task.createdAt) : undefined;
  return {
    id: `workspace:${task.id}`,
    title: task.title || task.prompt.trim().split(/\r?\n/)[0]?.slice(0, 100) || 'AI workspace task',
    kind: 'workspace',
    agent: task.agent,
    runtime: task.launchMode === 'worktree' ? 'Worktree' : 'Local workspace',
    project: task.projectPath.split(/[\\/]/).pop() || task.projectPath,
    status: task.status,
    statusLabel: statusLabel(task.status, labels.status),
    lifecycle: toLifecycle(task.status, attention),
    timestamp: task.attentionRequestedAt ?? task.updatedAt ?? task.createdAt,
    durationMs,
    attention,
    href: `/ai-workspace?task=${encodeURIComponent(task.id)}`,
  };
}

function sessionEntry(
  record: ActivitySessionRecord,
  activity: SessionActivity,
  agents: Array<{ id: string; name?: string }>,
  labels: ActivityLabels,
): ActivityEntry | null {
  const session = record.session;
  const status = activity.state;
  const attention = session.hasPendingCompletion === true
    || ['input_required', 'awaiting_review', 'attention'].includes(String(session.status).toLowerCase());
  const timestamp = sessionActivityTime(session);
  if (!timestamp) return null;
  const agentId = agentIdForSession(session);
  const agent = agents.find((candidate) => candidate.id === agentId);
  const metrics = activitySessionMetrics(record);
  const normalizedStatus = status === 'unknown' ? 'stopped' : status;
  return {
    id: `session:${session.key}`,
    title: getSessionDisplayLabel(session, { mainSessionLabel: labels.mainSession, genericSessionLabel: labels.genericSession }),
    kind: 'session',
    agent: getAgentDisplayName(agent, agentId === 'main' ? 'Main Agent' : agentId),
    model: typeof session.model === 'string' && session.model.trim() ? shortModelName(session.model) : undefined,
    runtime: runtimeForSession(session),
    project: session.topic,
    status: normalizedStatus,
    statusLabel: attention ? labels.status.attention : statusLabel(normalizedStatus, labels.status),
    lifecycle: toLifecycle(normalizedStatus, attention),
    timestamp,
    durationMs: metrics.durationMs,
    tokens: metrics.tokens,
    cost: metrics.cost,
    attention,
    href: '/chat',
  };
}

function entryMatches(entry: ActivityEntry, filter: ActivityFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'attention') return entry.attention;
  if (filter === 'running') return entry.status === 'running';
  if (filter === 'failed') return entry.lifecycle === 'failed';
  return entry.lifecycle === 'ended';
}

function ActivityMeta({ entry }: { entry: ActivityEntry }) {
  const duration = formatDuration(entry.durationMs);
  const cost = formatCost(entry.cost);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-aegis-text-dim">
      <span className="inline-flex items-center gap-1 text-aegis-text-secondary"><Bot size={10} />{entry.agent}</span>
      {entry.model && <span className="inline-flex min-w-0 max-w-[180px] items-center gap-1 truncate font-mono" title={entry.model}><Cpu size={10} />{entry.model}</span>}
      {entry.runtime && <span>{entry.runtime}</span>}
      {entry.project && <span className="max-w-[160px] truncate" title={entry.project}>{entry.project}</span>}
      {duration && <span className="inline-flex items-center gap-1 font-mono tabular-nums"><Timer size={10} />{duration}</span>}
      {entry.tokens && <span className="font-mono tabular-nums">{formatTokens(entry.tokens)}</span>}
      {cost && <span className="inline-flex items-center gap-1 font-mono tabular-nums"><Coins size={10} />{cost}</span>}
    </div>
  );
}

export function ActivityCenterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const connected = useChatStore((state) => state.connected);
  const chatSessions = useChatStore((state) => state.sessions);
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const typingBySession = useChatStore((state) => state.typingBySession);
  const typingStartedAtBySession = useChatStore((state) => state.typingStartedAtBySession);
  const thinkingBySession = useChatStore((state) => state.thinkingBySession);
  const sendingBySession = useChatStore((state) => state.sendingBySession);
  const gatewaySessions = useGatewayDataStore((state) => state.sessions);
  const agents = useGatewayDataStore((state) => state.agents);
  const sessionsUsage = useGatewayDataStore((state) => state.sessionsUsage);
  const workspaceTasks = useAgentWorkspaceStore((state) => state.tasks);
  const skills = useSkillsStore((state) => state.skills);
  const refreshSkills = useSkillsStore((state) => state.refresh);
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const labels = useMemo<ActivityLabels>(() => ({
    mainSession: t('dashboard.mainSession', 'Main Session'),
    genericSession: t('dashboard.session', 'Session'),
    status: {
      ...STATUS_LABELS,
      running: t('lifecycle.running', 'Running'),
      failed: t('lifecycle.failed', 'Failed'),
      done: t('lifecycle.ended', 'Completed'),
      stopped: t('lifecycle.idle', 'Idle'),
      attention: t('lifecycle.attention', 'Needs attention'),
    },
  }), [t]);

  useEffect(() => {
    void ensureGroupFresh('sessions');
    void ensureGroupFresh('agents');
    void ensureGroupFresh('usage');
    void refreshSkills();
  }, [refreshSkills]);

  const sessionRecords = useMemo(() => mergeActivitySessions({
    usageSessions: sessionsUsage?.sessions,
    gatewaySessions,
    chatSessions,
  }), [chatSessions, gatewaySessions, sessionsUsage?.sessions]);
  const activityProjection = useMemo(() => projectSessionActivity({
    sessions: sessionRecords.map((record) => record.session),
    activeSessionKey,
    typingBySession,
    typingStartedAtBySession,
    thinkingBySession,
    sendingBySession,
  }), [activeSessionKey, sendingBySession, sessionRecords, thinkingBySession, typingBySession, typingStartedAtBySession]);

  const entries = useMemo(() => {
    const sessionEntries = sessionRecords
      .map((record) => {
        const activity = activityProjection.bySessionKey.get(record.session.key);
        return activity ? sessionEntry(record, activity, agents, labels) : null;
      })
      .filter((entry): entry is ActivityEntry => Boolean(entry));
    return [
      ...workspaceTasks.filter((task) => !task.isDraft).map((task) => workspaceEntry(task, labels)),
      ...sessionEntries,
    ]
      .sort((left, right) => {
        if (left.attention !== right.attention) return left.attention ? -1 : 1;
        if (left.status === 'running' && right.status !== 'running') return -1;
        if (right.status === 'running' && left.status !== 'running') return 1;
        return right.timestamp - left.timestamp;
      });
  }, [activityProjection, agents, labels, sessionRecords, workspaceTasks]);

  const visibleEntries = useMemo(() => entries.filter((entry) => entryMatches(entry, filter)), [entries, filter]);
  const attentionEntries = useMemo(() => entries.filter((entry) => entry.attention), [entries]);
  const runningCount = entries.filter((entry) => entry.status === 'running').length;
  const completedCount = entries.filter((entry) => entry.lifecycle === 'ended').length;
  const failedCount = entries.filter((entry) => entry.lifecycle === 'failed').length;
  const enabledSkills = Object.values(skills).filter((skill) => skill.enabled !== false).length;
  const skillCount = Object.keys(skills).length;

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([refreshAll(), refreshSkills()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshSkills, refreshing]);

  const openEntry = (entry: ActivityEntry) => {
    if (entry.kind === 'workspace') {
      navigate(entry.href);
      return;
    }
    const sessionKey = entry.id.slice('session:'.length);
    useChatStore.getState().openTab(sessionKey);
    navigate('/chat');
  };

  const filters: Array<{ id: ActivityFilter; label: string; count: number }> = [
    { id: 'all', label: t('activity.filters.all', '全部'), count: entries.length },
    { id: 'running', label: t('activity.filters.running', '运行中'), count: runningCount },
    { id: 'attention', label: t('activity.filters.attention', '待关注'), count: attentionEntries.length },
    { id: 'done', label: t('activity.filters.done', '已完成'), count: completedCount },
    { id: 'failed', label: t('activity.filters.failed', '失败'), count: failedCount },
  ];

  return (
    <SceneTransition className="mx-auto min-h-full w-full max-w-[1280px] space-y-4 p-3 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-aegis-primary/20 bg-aegis-primary/10 text-aegis-primary">
            <Activity size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="text-[20px] font-bold text-aegis-text">{t('activity.title', '活动中心')}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigate('/ai-workspace')} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-aegis-border px-2.5 text-[11px] font-medium text-aegis-text-secondary transition-colors hover:bg-aegis-hover hover:text-aegis-text">
            <FolderKanban size={13} />{t('activity.openWorkspace', '打开 AI 工作台')}
          </button>
          <button type="button" onClick={() => void handleRefresh()} disabled={refreshing} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-aegis-border px-2.5 text-[11px] font-medium text-aegis-text-secondary transition-colors hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-wait disabled:opacity-50" title={t('common.refresh', '刷新')}>
            <RefreshCw size={13} className={clsx(refreshing && 'animate-spin')} />
            <span className="hidden sm:inline">{t('common.refresh', '刷新')}</span>
          </button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: t('activity.summary.running', '运行中'), value: runningCount, icon: <Activity size={15} />, tone: 'text-aegis-primary' },
          { label: t('activity.summary.attention', '待关注'), value: attentionEntries.length, icon: <ShieldAlert size={15} />, tone: 'text-aegis-warning' },
          { label: t('activity.summary.done', '已完成'), value: completedCount, icon: <CheckCircle2 size={15} />, tone: 'text-aegis-success' },
          { label: t('activity.summary.failed', '失败'), value: failedCount, icon: <Clock3 size={15} />, tone: 'text-aegis-danger' },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2 rounded-lg border border-aegis-border bg-aegis-card px-3 py-2.5">
            <span className={clsx('shrink-0', item.tone)}>{item.icon}</span>
            <span className="min-w-0">
              <span className="block text-[10px] text-aegis-text-dim">{item.label}</span>
              <strong className="block font-mono text-[17px] leading-5 text-aegis-text">{item.value}</strong>
            </span>
          </div>
        ))}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-2 border-b border-aegis-border pb-3">
        <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-md border border-aegis-border bg-aegis-card p-1 scrollbar-hidden">
          {filters.map((item) => (
            <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={clsx('inline-flex h-7 shrink-0 items-center gap-1.5 rounded px-2.5 text-[11px] transition-colors', filter === item.id ? 'bg-aegis-primary/12 font-semibold text-aegis-primary' : 'text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text')}>
              {item.label}<span className="font-mono text-[10px] opacity-70">{item.count}</span>
            </button>
          ))}
        </div>
        <span className="text-[10.5px] text-aegis-text-dim">{connected ? t('activity.live', '实时同步') : t('activity.offline', '等待 Gateway 连接')}</span>
      </section>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 overflow-hidden rounded-lg border border-aegis-border bg-aegis-card">
          <div className="flex items-center justify-between border-b border-aegis-border px-4 py-3">
            <div>
              <h2 className="text-[13px] font-semibold text-aegis-text">{t('activity.runsTitle', '执行记录')}</h2>
            </div>
            <span className="font-mono text-[10px] text-aegis-text-dim">{visibleEntries.length}</span>
          </div>
          {visibleEntries.length === 0 ? (
            <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 px-6 text-center text-[12px] text-aegis-text-dim">
              <Activity size={28} className="opacity-35" />
              <span>{connected ? t('activity.empty', '当前筛选没有活动记录。') : t('activity.offlineEmpty', '连接 Gateway 后，这里会显示实时活动。')}</span>
            </div>
          ) : (
            <div className="divide-y divide-[rgb(var(--aegis-overlay)/0.06)]">
              {visibleEntries.map((entry) => (
                <button key={entry.id} type="button" onClick={() => openEntry(entry)} className="group flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-aegis-hover/45">
                  <StatusBadge state={entry.lifecycle} label size={8} labelText={entry.statusLabel} className="mt-0.5 min-w-[74px] whitespace-nowrap" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-start justify-between gap-3">
                      <strong className="min-w-0 truncate text-[12.5px] font-semibold text-aegis-text group-hover:text-aegis-primary">{entry.title}</strong>
                      <time className="shrink-0 font-mono text-[10px] tabular-nums text-aegis-text-dim" title={formatActivityTimeTitle(entry.timestamp)}>{new Date(entry.timestamp).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                    </span>
                    <ActivityMeta entry={entry} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-3">
          <div className="rounded-lg border border-aegis-border bg-aegis-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <ShieldAlert size={14} className="text-aegis-warning" />
              <h2 className="text-[12.5px] font-semibold text-aegis-text">{t('activity.attentionTitle', '需要处理')}</h2>
              <span className="ms-auto rounded bg-aegis-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-aegis-warning">{attentionEntries.length}</span>
            </div>
            {attentionEntries.length === 0 ? (
              <p className="text-[11px] leading-5 text-aegis-text-dim">{t('activity.noAttention', '没有等待输入或审阅的任务。')}</p>
            ) : (
              <div className="space-y-1.5">
                {attentionEntries.slice(0, 4).map((entry) => (
                  <button key={entry.id} type="button" onClick={() => openEntry(entry)} className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-aegis-text-secondary transition-colors hover:bg-aegis-hover hover:text-aegis-text">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-aegis-warning" />
                    <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                    <span className="shrink-0 text-[10px] text-aegis-warning">{entry.statusLabel}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-aegis-border bg-aegis-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2"><Puzzle size={14} className="text-aegis-primary" /><h2 className="text-[12.5px] font-semibold text-aegis-text">{t('activity.capabilitiesTitle', '工作区能力')}</h2></div>
              <span className="text-[10px] text-aegis-text-dim">{enabledSkills}/{skillCount}</span>
            </div>
            <div className="space-y-1">
              <button type="button" onClick={() => navigate('/skills')} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[11px] text-aegis-text-secondary transition-colors hover:bg-aegis-hover hover:text-aegis-text"><Puzzle size={12} className="text-aegis-primary" /><span className="flex-1">{t('activity.skills', 'Skills')}</span><span className="font-mono text-[10px] text-aegis-text-dim">{enabledSkills}</span></button>
              <button type="button" onClick={() => navigate('/tools')} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[11px] text-aegis-text-secondary transition-colors hover:bg-aegis-hover hover:text-aegis-text"><Wrench size={12} className="text-aegis-accent" /><span className="flex-1">{t('activity.mcp', 'MCP / 工具')}</span><span className="text-[10px] text-aegis-text-dim">{t('activity.open', '打开')}</span></button>
              <button type="button" onClick={() => navigate('/memory')} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[11px] text-aegis-text-secondary transition-colors hover:bg-aegis-hover hover:text-aegis-text"><MemoryStick size={12} className="text-aegis-success" /><span className="flex-1">{t('activity.memory', 'Memory')}</span><span className="text-[10px] text-aegis-text-dim">{t('activity.open', '打开')}</span></button>
            </div>
          </div>

          <div className="rounded-lg border border-aegis-border bg-aegis-card p-3">
            <h2 className="mb-2 text-[12.5px] font-semibold text-aegis-text">{t('activity.shortcutsTitle', '快速入口')}</h2>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" onClick={() => navigate('/terminal')} className="flex items-center gap-1.5 rounded-md border border-aegis-border px-2 py-2 text-[10.5px] text-aegis-text-secondary hover:bg-aegis-hover"><TerminalSquare size={12} />{t('nav.terminal', '终端')}</button>
              <button type="button" onClick={() => navigate('/timeline')} className="flex items-center gap-1.5 rounded-md border border-aegis-border px-2 py-2 text-[10.5px] text-aegis-text-secondary hover:bg-aegis-hover"><Clock3 size={12} />{t('nav.timeline', '时间线')}</button>
            </div>
          </div>
        </aside>
      </section>
    </SceneTransition>
  );
}

export default ActivityCenterPage;
