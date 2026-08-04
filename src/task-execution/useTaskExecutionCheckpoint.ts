import { useEffect, useState } from 'react';
import { taskExecutionCoordinator } from './TaskExecutionCoordinator';
import {
  projectTaskExecutionCheckpointState,
  taskExecutionCheckpointTarget,
  type StoredTaskExecutionCheckpointState,
} from './checkpointViewState';
import type { TaskExecutionCheckpoint } from './types';

export interface TaskExecutionCheckpointState {
  loading: boolean;
  checkpoint: TaskExecutionCheckpoint | null;
}

export function useTaskExecutionCheckpoint(
  sessionKey: string,
  sessionId?: string,
): TaskExecutionCheckpointState {
  const target = taskExecutionCheckpointTarget(sessionKey, sessionId);
  const [state, setState] = useState<StoredTaskExecutionCheckpointState>({
    target,
    loading: true,
    checkpoint: null,
  });

  useEffect(() => {
    let active = true;
    setState({ target, loading: true, checkpoint: null });
    const refresh = () => {
      void taskExecutionCoordinator.checkpointForSession(sessionKey, sessionId)
        .then((checkpoint) => {
          if (active) setState({ target, loading: false, checkpoint });
        })
        .catch(() => {
          if (active) setState({ target, loading: false, checkpoint: null });
        });
    };
    const unsubscribe = taskExecutionCoordinator.subscribe(refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [sessionId, sessionKey, target]);

  return projectTaskExecutionCheckpointState(state, target);
}
