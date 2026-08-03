import type { AgentWorkspaceTask, AgentWorkspaceTaskStatus } from '@/stores/agentWorkspaceStore';
import type { NotificationType } from '@/stores/notificationStore';
import type { PomodoroState } from '@/stores/petStore';
import type { VoicePhase } from '@/services/voice/types';
import type {
  VoiceInputMode,
  VoiceInputPhase,
  VoiceModeErrorCode,
  VoiceModeSnapshot,
} from '@/services/voice/VoiceModeCoordinator';
import type { FocusProjection } from '@/focus/focusContext';

export interface DynamicIslandTask {
  id: string;
  title: string;
  agent: string;
  projectPath: string;
  status: AgentWorkspaceTaskStatus;
  updatedAt: number;
}

export interface DynamicIslandSessionActivity {
  id: string;
  sessionKey: string;
  agentName: string;
  sessionTitle: string;
  phase: 'thinking' | 'generating' | 'observing';
  startedAt: number;
  observer?: {
    headline: string;
    health: DynamicIslandSessionObserverHealth;
  };
}

export type DynamicIslandSessionObserverHealth =
  | 'on-track'
  | 'grinding'
  | 'stuck'
  | 'waiting-on-user'
  | 'wrapping-up'
  | 'done'
  | 'failed';

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

/**
 * The auxiliary window receives only a non-sensitive voice cue. It never
 * receives the voice turn, target, transcript, audio payload, or credentials.
 */
export interface DynamicIslandVoiceInput {
  mode: VoiceInputMode;
  phase: VoiceInputPhase;
  requiresConfirmation: boolean;
  error: VoiceModeErrorCode | null;
}

/**
 * The running `update_plan` projection for the active session. Carries only the
 * step position and its title - never the plan explanation, tool arguments, or
 * any other transcript content, since the island is an auxiliary window.
 */
export interface DynamicIslandExecutionPlan {
  currentStep: number;
  totalSteps: number;
  stepTitle: string;
}

export interface DynamicIslandSnapshot {
  revision: number;
  preview: boolean;
  sessionKey: string;
  connected: boolean;
  connecting: boolean;
  sessionRunning: boolean;
  sessionActivities: DynamicIslandSessionActivity[];
  executionPlan: DynamicIslandExecutionPlan | null;
  voicePhase: VoicePhase;
  voiceQueueLength: number;
  voiceInput: DynamicIslandVoiceInput;
  petEnabled: boolean;
  dndMode: boolean;
  autoExpand: boolean;
  tasks: DynamicIslandTask[];
  focus: FocusProjection | null;
  pomodoro: Pick<PomodoroState, 'enabled' | 'running' | 'paused' | 'phase' | 'endsAt' | 'pausedRemainingMs'>;
  notice: DynamicIslandNotice | null;
  resourceDrop: DynamicIslandDrop | null;
}

/** Voice phases that represent ongoing user-visible audio work. */
export function isVoiceActivePhase(phase: VoicePhase): boolean {
  return phase === 'listening'
    || phase === 'transcribing'
    || phase === 'queued'
    || phase === 'speaking';
}

export function projectDynamicIslandVoiceInput(
  snapshot: Pick<VoiceModeSnapshot, 'mode' | 'phase' | 'draft' | 'error'>,
): DynamicIslandVoiceInput {
  return {
    mode: snapshot.mode,
    phase: snapshot.phase,
    requiresConfirmation: snapshot.phase === 'ready_to_send' && snapshot.draft !== null,
    error: snapshot.error,
  };
}

export function isDynamicIslandVoiceInputActive(input: DynamicIslandVoiceInput): boolean {
  return input.phase === 'listening'
    || input.phase === 'triggered'
    || input.phase === 'transcribing'
    || input.phase === 'ready_to_send'
    || input.phase === 'unavailable'
    || input.phase === 'error';
}

export const EMPTY_DYNAMIC_ISLAND_SNAPSHOT: DynamicIslandSnapshot = {
  revision: 0,
  preview: false,
  sessionKey: '',
  connected: false,
  connecting: false,
  sessionRunning: false,
  sessionActivities: [],
  executionPlan: null,
  voicePhase: 'idle',
  voiceQueueLength: 0,
  voiceInput: {
    mode: 'off',
    phase: 'off',
    requiresConfirmation: false,
    error: null,
  },
  petEnabled: false,
  dndMode: false,
  autoExpand: true,
  tasks: [],
  focus: null,
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
  preview?: boolean;
  mainMinimized: boolean;
  sessionRunning: boolean;
  voiceActive?: boolean;
  tasks: DynamicIslandTask[];
  focus?: FocusProjection | null;
  resourceDrop: DynamicIslandDrop | null;
  terminalPulse: boolean;
}): boolean {
  if (!input.enabled) return false;
  if (input.preview) return true;
  if (input.resourceDrop) return true;
  if (!input.mainMinimized) return false;
  return Boolean(input.focus)
    || input.sessionRunning
    || Boolean(input.voiceActive)
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
  if (!isVoiceActivePhase(previous.voicePhase) && isVoiceActivePhase(next.voicePhase)) return true;
  if (
    !isDynamicIslandVoiceInputActive(previous.voiceInput)
    && isDynamicIslandVoiceInputActive(next.voiceInput)
  ) return true;
  if (!previous.voiceInput.requiresConfirmation && next.voiceInput.requiresConfirmation) return true;
  if (next.resourceDrop && (
    !previous.resourceDrop
    || next.resourceDrop.phase !== previous.resourceDrop.phase
    || next.resourceDrop.count !== previous.resourceDrop.count
  )) return true;
  if (next.notice && next.notice.id !== previous.notice?.id) return true;
  // Advancing to a new plan step is the agent reporting real progress, so it
  // earns one peek. Step count changes alone do not - a replanned run would
  // otherwise reopen the island on every revision.
  if (
    next.executionPlan
    && previous.executionPlan
    && next.executionPlan.currentStep > previous.executionPlan.currentStep
  ) return true;

  const previousObserverHealth = new Map(
    previous.sessionActivities
      .filter((activity) => activity.observer)
      .map((activity) => [activity.id, activity.observer?.health]),
  );
  if (next.sessionActivities.some((activity) => (
    activity.observer
    && (activity.observer.health === 'stuck' || activity.observer.health === 'waiting-on-user')
    && previousObserverHealth.get(activity.id) !== activity.observer.health
  ))) return true;

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

export function formatElapsedTime(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secondsPart = (seconds % 60).toString().padStart(2, '0');
  return minutes !== '00' ? `${minutes}:${secondsPart}` : `00:${secondsPart}`;
}
