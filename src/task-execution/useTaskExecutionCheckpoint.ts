import { useEffect, useState } from 'react';
import { taskExecutionCoordinator } from './TaskExecutionCoordinator';
import type { TaskExecutionCheckpoint } from './types';

export interface TaskExecutionCheckpointState {
  loading: boolean;
  checkpoint: TaskExecutionCheckpoint | null;
}

export function useTaskExecutionCheckpoint(
  sessionKey: string,
  sessionId?: string,
): TaskExecutionCheckpointState {
  const [state, setState] = useState<TaskExecutionCheckpointState>({
    loading: true,
    checkpoint: null,
  });

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void taskExecutionCoordinator.checkpointForSession(sessionKey, sessionId)
        .then((checkpoint) => {
          if (active) setState({ loading: false, checkpoint });
        })
        .catch(() => {
          if (active) setState({ loading: false, checkpoint: null });
        });
    };
    const unsubscribe = taskExecutionCoordinator.subscribe(refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [sessionId, sessionKey]);

  return state;
}
