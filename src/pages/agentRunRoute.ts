import type { AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';

export type AgentRunTaskResolution =
  | { kind: 'new' }
  | { kind: 'task'; task: AgentWorkspaceTask }
  | { kind: 'unavailable'; taskId: string };

export function resolveAgentRunTask(
  requestedTaskId: string | null | undefined,
  tasks: readonly AgentWorkspaceTask[],
): AgentRunTaskResolution {
  const taskId = requestedTaskId?.trim();
  if (!taskId) return { kind: 'new' };
  const task = tasks.find((candidate) => candidate.id === taskId);
  return task ? { kind: 'task', task } : { kind: 'unavailable', taskId };
}
