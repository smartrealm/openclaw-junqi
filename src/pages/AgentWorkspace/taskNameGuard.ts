import type { AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';

export interface TaskNameSnapshot {
  title: string;
  prompt: string;
  status: AgentWorkspaceTask['status'];
  sessionPath: string | null;
}

export function taskSessionPath(task: AgentWorkspaceTask): string | null {
  return task.agent === 'codex'
    ? task.codexSessionPath ?? null
    : task.agent === 'claude'
      ? task.claudeSessionPath ?? null
      : task.sessionPath ?? null;
}

export function captureTaskNameSnapshot(task: AgentWorkspaceTask): TaskNameSnapshot {
  return {
    title: task.title ?? '',
    prompt: task.prompt,
    status: task.status,
    sessionPath: taskSessionPath(task),
  };
}

export function taskStillMatchesNameSnapshot(
  task: AgentWorkspaceTask | undefined,
  snapshot: TaskNameSnapshot,
): task is AgentWorkspaceTask {
  return Boolean(task)
    && (task!.title ?? '') === snapshot.title
    && task!.prompt === snapshot.prompt
    && task!.status === snapshot.status
    && taskSessionPath(task!) === snapshot.sessionPath;
}
