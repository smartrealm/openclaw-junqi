import { useEffect } from 'react';
import { isAgentWorkspaceTaskStatus, useAgentWorkspaceStore } from '@/stores/agentWorkspaceStore';
import { combineUnlisteners, subscribeTauriEvent } from '@/utils/tauriEvents';

/** Keep persisted AI-workspace tasks in sync even while their page is not open. */
export function useAgentWorkspaceTaskEvents() {
  useEffect(() => {
    const unlisten = combineUnlisteners([
      subscribeTauriEvent<{ task_id: string; status: string; failure_reason?: string }>('task-status', (event) => {
        const { task_id: taskId, status, failure_reason: failureReason } = event.payload;
        if (!taskId || !isAgentWorkspaceTaskStatus(status)) return;
        const task = useAgentWorkspaceStore.getState().tasks.find((item) => item.id === taskId);
        if (!task) return;
        if (task.status === 'detached' && (status === 'running' || status === 'input_required' || status === 'awaiting_review')) return;
        const attentionRequestedAt = status === 'input_required' || status === 'awaiting_review'
          ? task.attentionRequestedAt ?? Date.now()
          : undefined;
        if (task.status === status && task.attentionRequestedAt === attentionRequestedAt && (!failureReason || task.failureReason === failureReason)) return;
        useAgentWorkspaceStore.getState().updateTask(taskId, {
          status,
          attentionRequestedAt,
          ...(status === 'failed' && failureReason ? { failureReason } : {}),
        });
      }),
      subscribeTauriEvent<{ task_id: string; session_id: string; session_path: string }>('task-session', (event) => {
        const { task_id: taskId, session_id: sessionId, session_path: sessionPath } = event.payload;
        const task = useAgentWorkspaceStore.getState().tasks.find((item) => item.id === taskId);
        if (!task || !sessionPath) return;
        useAgentWorkspaceStore.getState().updateTask(taskId, {
          sessionId,
          sessionPath,
          ...(task.agent === 'codex'
            ? { codexSessionId: sessionId, codexSessionPath: sessionPath }
            : task.agent === 'claude'
              ? { claudeSessionId: sessionId, claudeSessionPath: sessionPath }
              : {}),
        });
      }),
    ]);

    return () => {
      unlisten();
    };
  }, []);
}
