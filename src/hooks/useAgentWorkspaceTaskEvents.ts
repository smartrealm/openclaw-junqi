import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isAgentWorkspaceTaskStatus, useAgentWorkspaceStore } from '@/stores/agentWorkspaceStore';

/** Keep persisted AI-workspace tasks in sync even while their page is not open. */
export function useAgentWorkspaceTaskEvents() {
  useEffect(() => {
    const subscriptions = [
      listen<{ task_id: string; status: string }>('task-status', (event) => {
        const { task_id: taskId, status } = event.payload;
        if (!taskId || !isAgentWorkspaceTaskStatus(status)) return;
        const task = useAgentWorkspaceStore.getState().tasks.find((item) => item.id === taskId);
        if (!task || task.status === status) return;
        useAgentWorkspaceStore.getState().updateTask(taskId, { status });
      }),
      listen<{ task_id: string; session_id: string; session_path: string }>('task-session', (event) => {
        const { task_id: taskId, session_id: sessionId, session_path: sessionPath } = event.payload;
        const task = useAgentWorkspaceStore.getState().tasks.find((item) => item.id === taskId);
        if (!task || !sessionPath) return;
        useAgentWorkspaceStore.getState().updateTask(taskId, { sessionId, sessionPath });
      }),
    ];

    return () => {
      void Promise.all(subscriptions).then((unlisteners) => unlisteners.forEach((unlisten) => unlisten()));
    };
  }, []);
}
