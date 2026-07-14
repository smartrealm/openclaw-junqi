import type { AgentWorkspaceTask, AgentWorkspaceTaskStatus } from '@/stores/agentWorkspaceStore';
import type { NotificationType } from '@/stores/notificationStore';
import type { PomodoroState } from '@/stores/petStore';

export interface DynamicIslandTask {
  id: string;
  title: string;
  agent: string;
  projectPath: string;
  status: AgentWorkspaceTaskStatus;
  updatedAt: number;
}

export interface DynamicIslandNotice {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
}

export interface DynamicIslandDrop {
  phase: 'dragging' | 'received';
  count: number;
  labels: string[];
}

export interface DynamicIslandSnapshot {
  revision: number;
  connected: boolean;
  connecting: boolean;
  sessionRunning: boolean;
  petEnabled: boolean;
  dndMode: boolean;
  autoExpand: boolean;
  tasks: DynamicIslandTask[];
  pomodoro: Pick<PomodoroState, 'enabled' | 'running' | 'paused' | 'phase' | 'endsAt' | 'pausedRemainingMs'>;
  notice: DynamicIslandNotice | null;
  resourceDrop: DynamicIslandDrop | null;
}

export const EMPTY_DYNAMIC_ISLAND_SNAPSHOT: DynamicIslandSnapshot = {
  revision: 0,
  connected: false,
  connecting: false,
  sessionRunning: false,
  petEnabled: false,
  dndMode: false,
  autoExpand: true,
  tasks: [],
  pomodoro: {
    enabled: false,
    running: false,
    paused: false,
    phase: 'work',
    endsAt: null,
    pausedRemainingMs: null,
  },
  notice: null,
  resourceDrop: null,
};

const VISIBLE_TASK_STATUSES = new Set<AgentWorkspaceTaskStatus>([
  'running',
  'input_required',
  'awaiting_review',
  'done',
  'failed',
  'interrupted',
]);

const TASK_PRIORITY: Record<AgentWorkspaceTaskStatus, number> = {
  input_required: 0,
  awaiting_review: 1,
  failed: 2,
  interrupted: 3,
  running: 4,
  done: 5,
  pending: 6,
  todo: 7,
  detached: 8,
  cancelled: 9,
};

export function selectDynamicIslandTasks(tasks: AgentWorkspaceTask[], limit = 4): DynamicIslandTask[] {
  return tasks
    .filter((task) => !task.isDraft && VISIBLE_TASK_STATUSES.has(task.status))
    .sort((left, right) => (
      TASK_PRIORITY[left.status] - TASK_PRIORITY[right.status]
      || right.updatedAt - left.updatedAt
    ))
    .slice(0, Math.max(0, limit))
    .map((task) => ({
      id: task.id,
      title: task.title?.trim() || task.prompt.trim().slice(0, 64) || 'Agent task',
      agent: task.agent,
      projectPath: task.projectPath,
      status: task.status,
      updatedAt: task.updatedAt,
    }));
}

export function shouldShowDynamicIsland(input: {
  enabled: boolean;
  mainMinimized: boolean;
  sessionRunning: boolean;
  tasks: DynamicIslandTask[];
  resourceDrop: DynamicIslandDrop | null;
  terminalPulse: boolean;
}): boolean {
  if (!input.enabled) return false;
  if (input.resourceDrop) return true;
  if (!input.mainMinimized) return false;
  return input.sessionRunning
    || input.terminalPulse
    || input.tasks.some((task) => (
      task.status === 'running'
      || task.status === 'input_required'
      || task.status === 'awaiting_review'
    ));
}

export function shouldPeekForSnapshot(
  previous: DynamicIslandSnapshot,
  next: DynamicIslandSnapshot,
): boolean {
  if (!next.autoExpand) return false;
  if (next.resourceDrop && (
    !previous.resourceDrop
    || next.resourceDrop.phase !== previous.resourceDrop.phase
    || next.resourceDrop.count !== previous.resourceDrop.count
  )) return true;
  if (next.notice && next.notice.id !== previous.notice?.id) return true;

  const oldStatuses = new Map(previous.tasks.map((task) => [task.id, task.status]));
  return next.tasks.some((task) => {
    if (oldStatuses.get(task.id) === task.status) return false;
    return task.status === 'input_required'
      || task.status === 'awaiting_review'
      || task.status === 'done'
      || task.status === 'failed';
  });
}

export function formatRemainingTime(snapshot: DynamicIslandSnapshot, now: number): string | null {
  const pomodoro = snapshot.pomodoro;
  if (!pomodoro.enabled || !pomodoro.running) return null;
  const remaining = pomodoro.paused
    ? Math.max(0, pomodoro.pausedRemainingMs ?? 0)
    : Math.max(0, (pomodoro.endsAt ?? now) - now);
  const seconds = Math.ceil(remaining / 1000);
  const minutesPart = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secondsPart = (seconds % 60).toString().padStart(2, '0');
  return `${minutesPart}:${secondsPart}`;
}
