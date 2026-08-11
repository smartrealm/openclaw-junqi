// 时间线只投影 Gateway 会话与既有 Workshop 记录，不维护客户端任务状态。

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TimelineView, type TimelineTask } from '@/components/shared/TimelineView';
import { useChatStore, type Session } from '@/stores/chatStore';
import { useGatewayDataStore, type SessionInfo } from '@/stores/gatewayDataStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { getAgentDisplayName } from '@/utils/agentDisplayName';
import { sessionActivityTime } from '@/components/Layout/sidebarUtils';
import { getSessionDisplayLabel } from '@/utils/sessionLabel';
import { sessionExecutionState } from '@/utils/sessionPresentation';
import { activitySessionMetrics, mergeActivitySessions } from '@/utils/activitySessions';
import { resolveStatusLabel } from '@/utils/taskStatusLabels';

function sessionStatus(session: Session | SessionInfo): TimelineTask['status'] {
  const state = sessionExecutionState(session as Session);
  if (state === 'running') return 'running';
  if (state === 'failed') return 'failed';
  if (state === 'done') return 'done';
  if (state === 'stopped' || state === 'unknown') return 'idle';
  return 'queued';
}

function modelName(value: unknown): string | undefined {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    value = record.primary ?? record.id ?? record.model;
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.trim().split('/').filter(Boolean).pop();
}

// 状态文案统一由共享词汇表提供，避免不同页面对同一状态使用不同名称。

function latestUserPrompt(messages: Array<{ role?: string; content?: string; timestamp?: string }> | undefined): { text?: string; timestamp?: number } {
  if (!messages) return {};
  const message = [...messages].reverse().find((item) => item.role === 'user' && typeof item.content === 'string' && item.content.trim());
  if (!message) return {};
  const text = message.content!.trim().split(/\r?\n/)[0]?.slice(0, 90) || undefined;
  const timestamp = message.timestamp ? Date.parse(message.timestamp) : 0;
  return { text, timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined };
}

function deriveTimelineTasks({
  workshopTasks,
  chatSessions,
  gatewaySessions,
  sessionsUsage,
  messagesPerSession,
  agents,
  t,
}: {
  workshopTasks: Array<{ id: string; title: string; assignedAgent?: string; status: string; createdAt: string }>;
  chatSessions: Session[];
  gatewaySessions: SessionInfo[];
  sessionsUsage?: { sessions?: unknown[] } | null;
  messagesPerSession: Record<string, Array<{ role?: string; content?: string; timestamp?: string }> | undefined>;
  agents: Array<{ id: string; name?: string }>;
  t: (key: string, options?: Record<string, unknown>) => string;
}): TimelineTask[] {
  const out: TimelineTask[] = [];

  for (const task of workshopTasks) {
    const created = Date.parse(task.createdAt);
    if (!Number.isFinite(created)) continue;
    out.push({
      id: `workshop:${task.id}`,
      title: task.title,
      agent: task.assignedAgent,
      status: task.status,
      statusLabel: resolveStatusLabel(task.status, t),
      createdAt: created,
      project: 'Workshop',
      href: '/workshop',
    });
  }

  const agentNames = new Map(agents.map((agent) => [agent.id, getAgentDisplayName(agent, agent.id)]));
  const activitySessions = mergeActivitySessions({
    usageSessions: sessionsUsage?.sessions,
    gatewaySessions,
    chatSessions,
  });

  for (const activityRecord of activitySessions) {
    const session = activityRecord.session;
    const prompt = latestUserPrompt(messagesPerSession[session.key]);
    const activity = sessionActivityTime(session as Session) || prompt.timestamp || 0;
    if (!activity) continue;
    const agentId = session.agentId || session.key.split(':')[1] || 'main';
    const status = sessionStatus(session);
    const runtime = (session as Session).origin?.surface
      || (session as Session).origin?.provider
      || (session as Session).channel
      || 'Gateway';
    const metrics = activitySessionMetrics(activityRecord);
    out.push({
      id: `session:${session.key}`,
      title: prompt.text || getSessionDisplayLabel(session as any, {
        mainSessionLabel: t('dashboard.mainSession', {}),
        genericSessionLabel: t('dashboard.session', {}),
      }),
      agent: agentNames.get(agentId) || agentId,
      model: modelName(session.model),
      runtime,
      status,
      statusLabel: resolveStatusLabel(status, t),
      createdAt: activity,
      tokens: metrics.tokens,
      cost: metrics.cost,
      durationMs: metrics.durationMs,
      project: (session as Session).topic || undefined,
      href: '/chat',
    });
  }

  return out.sort((left, right) => right.createdAt - left.createdAt).slice(0, 300);
}

export function TimelinePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const workshopTasks = useWorkshopStore((state) => state.tasks);
  const chatSessions = useChatStore((state) => state.sessions);
  const messagesPerSession = useChatStore((state) => state.messagesPerSession);
  const gatewaySessions = useGatewayDataStore((state) => state.sessions);
  const sessionsUsage = useGatewayDataStore((state) => state.sessionsUsage);
  const agents = useGatewayDataStore((state) => state.agents);
  const tasks = useMemo(() => deriveTimelineTasks({
    workshopTasks,
    chatSessions,
    gatewaySessions,
    sessionsUsage,
    messagesPerSession,
    agents,
    t,
  }), [agents, chatSessions, gatewaySessions, messagesPerSession, sessionsUsage, t, workshopTasks]);

  return (
    <TimelineView
      tasks={tasks}
      onTaskClick={(task) => {
        if (task.id.startsWith('session:')) {
          const sessionKey = task.id.slice('session:'.length);
          useChatStore.getState().openTab(sessionKey);
          navigate('/chat');
          return;
        }
        navigate(task.href || '/workshop');
      }}
      title={t('timeline.title', 'Timeline')}
      subtitle={t('timeline.subtitle', '模型、智能体、运行时间与任务状态集中展示。')}
      emptyMessage={t('timeline.empty', '最近 7 天暂无活动。')}
    />
  );
}

export default TimelinePage;
