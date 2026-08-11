import type { PomodoroState } from '@/stores/petStore';
import type { VoicePhase } from '@/types/voice';
import type {
  VoiceInputMode,
  VoiceInputPhase,
  VoiceModeErrorCode,
  VoiceModeSnapshot,
} from '@/services/voice/VoiceModeCoordinator';
import type { FocusProjection } from '@/focus/focusContext';

export interface DynamicIslandSessionActivity {
  id: string;
  sessionKey: string;
  agentName: string;
  sessionTitle: string;
  phase: 'compacting' | 'thinking' | 'generating' | 'observing';
  startedAt: number;
  observer?: {
    headline: string;
    health: DynamicIslandSessionObserverHealth;
  };
}

export type DynamicIslandAgentActivity = 'thinking' | 'generating' | 'working' | 'listening';

export type DynamicIslandSessionObserverHealth =
  | 'on-track'
  | 'grinding'
  | 'stuck'
  | 'waiting-on-user'
  | 'wrapping-up'
  | 'done'
  | 'failed';

export interface DynamicIslandDrop {
  phase: 'dragging' | 'received';
  count: number;
  labels: string[];
}

/** 辅助窗口只接收非敏感语音状态，不接收轮次、转写、音频或凭据。 */
export interface DynamicIslandVoiceInput {
  mode: VoiceInputMode;
  phase: VoiceInputPhase;
  error: VoiceModeErrorCode | null;
}

/** 活动计划只投影步骤位置和标题，不把解释、工具参数或转写传给辅助窗口。 */
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
  focus: FocusProjection | null;
  pomodoro: Pick<PomodoroState, 'enabled' | 'running' | 'paused' | 'phase' | 'endsAt' | 'pausedRemainingMs'>;
  resourceDrop: DynamicIslandDrop | null;
}

/** 表示用户可见音频工作的阶段。 */
export function isVoiceActivePhase(phase: VoicePhase): boolean {
  return phase === 'listening'
    || phase === 'transcribing'
    || phase === 'queued'
    || phase === 'speaking';
}

export function projectDynamicIslandVoiceInput(
  snapshot: Pick<VoiceModeSnapshot, 'mode' | 'phase' | 'error'>,
): DynamicIslandVoiceInput {
  return {
    mode: snapshot.mode,
    phase: snapshot.phase,
    error: snapshot.error,
  };
}

export function isDynamicIslandVoiceInputActive(input: DynamicIslandVoiceInput): boolean {
  return input.mode === 'talk' && input.phase !== 'off';
}

export function resolveDynamicIslandAgentActivity(input: {
  voicePhase: VoicePhase;
  voiceInput: DynamicIslandVoiceInput;
  sessionPhase?: DynamicIslandSessionActivity['phase'];
}): DynamicIslandAgentActivity | null {
  if (isDynamicIslandVoiceInputActive(input.voiceInput)) {
    if (input.voiceInput.phase === 'thinking') return 'thinking';
    if (input.voiceInput.phase === 'speaking') return 'generating';
    if (input.voiceInput.phase === 'listening' || input.voiceInput.phase === 'hearing') return 'listening';
    if (input.voiceInput.phase === 'preparing') return 'working';
  }
  if (input.voicePhase === 'listening' || input.voicePhase === 'transcribing') return 'listening';
  if (input.voicePhase === 'speaking' || input.voicePhase === 'queued') return 'generating';
  if (input.sessionPhase === 'thinking') return 'thinking';
  if (input.sessionPhase === 'generating') return 'generating';
  if (input.sessionPhase === 'observing' || input.sessionPhase === 'compacting') return 'working';
  return null;
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
    error: null,
  },
  petEnabled: false,
  dndMode: false,
  autoExpand: true,
  focus: null,
  pomodoro: {
    enabled: false,
    running: false,
    paused: false,
    phase: 'work',
    endsAt: null,
    pausedRemainingMs: null,
  },
  resourceDrop: null,
};

export function shouldShowDynamicIsland(input: {
  enabled: boolean;
  preview?: boolean;
  mainMinimized: boolean;
  sessionRunning: boolean;
  voiceActive?: boolean;
  focus?: FocusProjection | null;
  resourceDrop: DynamicIslandDrop | null;
}): boolean {
  if (!input.enabled) return false;
  if (input.preview) return true;
  if (input.resourceDrop) return true;
  if (!input.mainMinimized) return false;
  return Boolean(input.focus)
    || input.sessionRunning
    || Boolean(input.voiceActive);
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
  if (next.resourceDrop && (
    !previous.resourceDrop
    || next.resourceDrop.phase !== previous.resourceDrop.phase
    || next.resourceDrop.count !== previous.resourceDrop.count
  )) return true;
  // 只有当前步骤前进才短暂展开；重新规划导致的步骤数量变化不能反复打开窗口。
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

  return false;
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
