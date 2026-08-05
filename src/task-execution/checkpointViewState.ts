import type { TaskExecutionCheckpoint } from './types';

export interface StoredTaskExecutionCheckpointState {
  target: string;
  loading: boolean;
  checkpoint: TaskExecutionCheckpoint | null;
}

export interface TaskExecutionCheckpointViewState {
  loading: boolean;
  checkpoint: TaskExecutionCheckpoint | null;
}

export function taskExecutionCheckpointTarget(
  sessionKey: string,
  sessionId?: string,
): string {
  return `${sessionKey.trim()}\u0000${sessionId?.trim() ?? ''}`;
}

export function projectTaskExecutionCheckpointState(
  state: StoredTaskExecutionCheckpointState,
  target: string,
): TaskExecutionCheckpointViewState {
  if (state.target !== target) {
    return { loading: true, checkpoint: null };
  }

  return { loading: state.loading, checkpoint: state.checkpoint };
}
