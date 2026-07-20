// TimelinePage — one activity view for chat sessions, AI-workspace tasks and
// workshop work. The AI-workspace rows intentionally read the persisted task
// store used by AgentWorkspace; this page does not maintain a second workflow.

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TimelineView, type TimelineTask } from '@/components/shared/TimelineView';
import { useChatStore, type Session } from '@/stores/chatStore';
import { useGatewayDataStore, type SessionInfo } from '@/stores/gatewayDataStore';
import { useAgentWorkspaceStore, type AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { getAgentDisplayName } from '@/utils/agentDisplayName';
import { sessionActivityTime } from '@/components/Layout/sidebarUtils';
import { getSessionDisplayLabel } from '@/utils/sessionLabel';
import { sessionExecutionState } from '@/utils/sessionPresentation';

function workspaceStatus(status: AgentWorkspaceTask['status']): TimelineTask['status'] {
  if (status === 'running') return 'running';
  if (status === 'input_required' || status === 'awaiting_review') return status;
  if (status === 'failed') return 'failed';
  if (status === 'done') return 'done';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'interrupted' || status === 'detached') return status;
  return status === 'todo' ? 'todo' : 'pending';
}

function sessionStatus(session: Session | SessionInfo): TimelineTask['status'] {
  const state = sessionExecutionState(session as Session);
  if (state === 'running') return 'running';
  if (state === 'failed') return 'failed';
  if (state === 'done') return 'done';
  if (state === 'stopped') return 'idle';
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

function statusLabel(status: TimelineTask['status']): string {
  const labels: Record<string, string> = {
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
    queued: '排队中',
    idle: '已停止',
  };
  return labels[status] ?? status;
}

function latestUserPrompt(messages: Array<{ role?: string; content?: string; timestamp?: string }> | undefined): { text?: string; timestamp?: number } {
  if (!messages) return {};
  const message = [...messages].reverse().find((item) => item.role === 'user' && typeof item.content === 'string' && item.content.trim());
  if (!message) return {};
  const text = message.content!.trim().split(/\r?\n/)[0]?.slice(0, 90) || undefined;
  const timestamp = message.timestamp ? Date.parse(message.timestamp) : 0;
  return { text, timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined };
}

function deriveTimelineTasks({
  workspaceTasks,
  workshopTasks,
  chatSessions,
  gatewaySessions,
  messagesPerSession,
  agents,
}: {
  workspaceTasks: AgentWorkspaceTask[];
  workshopTasks: Array<{ id: string; title: string; assignedAgent?: string; status: string; createdAt: string }>;
  chatSessions: Session[];
  gatewaySessions: SessionInfo[];
  messagesPerSession: Record<string, Array<{ role?: string; content?: string; timestamp?: string }> | undefined>;
  agents: Array<{ id: string; name?: string }>;
}): TimelineTask[] {
  const out: TimelineTask[] = [];

  for (const task of workspaceTasks) {
    const durationMs = task.status === 'done' || task.status === 'failed'
      ? Math.max(0, task.updatedAt - task.createdAt)
      : undefined;
    out.push({
      id: `workspace:${task.id}`,
      title: task.title || task.prompt.trim().split(/\r?\n/)[0]?.slice(0, 90) || 'AI workspace task',
      agent: task.agent,
      model: task.agent,
      runtime: task.launchMode === 'worktree' ? '工作树' : '本地工作区',
      status: workspaceStatus(task.status),
      statusLabel: statusLabel(workspaceStatus(task.status)),
      createdAt: task.updatedAt || task.createdAt,
      durationMs,
      project: task.projectPath.split(/[\\/]/).pop() || task.projectPath,
      additions: task.additions,
      deletions: task.deletions,
      href: `/ai-workspace?task=${encodeURIComponent(task.id)}`,
    });
  }

  for (const task of workshopTasks) {
    const created = Date.parse(task.createdAt);
    if (!Number.isFinite(created)) continue;
    out.push({
      id: `workshop:${task.id}`,
      title: task.title,
      agent: task.assignedAgent,
      status: task.status,
      statusLabel: statusLabel(task.status),
      createdAt: created,
      project: 'Workshop',
      href: '/workshop',
    });
  }

  const agentNames = new Map(agents.map((agent) => [agent.id, getAgentDisplayName(agent, agent.id)]));
  const mergedByKey = new Map<string, Session | SessionInfo>();
  for (const session of gatewaySessions) mergedByKey.set(session.key, session);
  for (const session of chatSessions) {
    const previous = mergedByKey.get(session.key);
    mergedByKey.set(session.key, previous ? { ...previous, ...session } : session);
  }

  for (const session of mergedByKey.values()) {
    const prompt = latestUserPrompt(messagesPerSession[session.key]);
    const activity = sessionActivityTime(session as Session) || prompt.timestamp || 0;
    if (!activity) continue;
    const agentId = session.agentId || session.key.split(':')[1] || 'main';
    const status = sessionStatus(session);
    const runtime = (session as Session).origin?.surface
      || (session as Session).origin?.provider
      || (session as Session).channel
      || 'Gateway';
    const totalCost = Number((session as any).totalCost ?? (session as any).cost);
    out.push({
      id: `session:${session.key}`,
      title: prompt.text || getSessionDisplayLabel(session as any, { mainSessionLabel: '主会话', genericSessionLabel: '会话' }),
      agent: agentNames.get(agentId) || agentId,
      model: modelName(session.model),
      runtime,
      status,
      statusLabel: statusLabel(status),
      createdAt: activity,
      tokens: Number(session.totalTokens) || undefined,
      cost: Number.isFinite(totalCost) && totalCost > 0 ? totalCost : undefined,
      project: (session as Session).topic || undefined,
      href: '/chat',
    });
  }

  return out.sort((left, right) => right.createdAt - left.createdAt).slice(0, 300);
}

export function TimelinePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const workspaceTasks = useAgentWorkspaceStore((state) => state.tasks);
  const workshopTasks = useWorkshopStore((state) => state.tasks);
  const chatSessions = useChatStore((state) => state.sessions);
  const messagesPerSession = useChatStore((state) => state.messagesPerSession);
  const gatewaySessions = useGatewayDataStore((state) => state.sessions);
  const agents = useGatewayDataStore((state) => state.agents);
  const tasks = useMemo(() => deriveTimelineTasks({
    workspaceTasks,
    workshopTasks,
    chatSessions,
    gatewaySessions,
    messagesPerSession,
    agents,
  }), [agents, chatSessions, gatewaySessions, messagesPerSession, workshopTasks, workspaceTasks]);

  return (
    <TimelineView
      tasks={tasks}
      onTaskClick={(task) => {
        if (task.id.startsWith('workspace:')) {
          navigate(task.href || '/ai-workspace');
          return;
        }
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
