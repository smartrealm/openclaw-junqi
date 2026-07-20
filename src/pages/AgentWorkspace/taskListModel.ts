import type { AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';

export function agentTaskNeedsAttention(task: AgentWorkspaceTask): boolean {
  return task.status === 'input_required'
    || task.status === 'awaiting_review'
    || task.status === 'detached'
    || task.status === 'interrupted';
}

function taskTimestamp(task: AgentWorkspaceTask): number {
  return Number.isFinite(task.updatedAt) ? task.updatedAt : task.createdAt;
}

export function compareAgentWorkspaceTasks(left: AgentWorkspaceTask, right: AgentWorkspaceTask): number {
  const leftNeedsAttention = agentTaskNeedsAttention(left);
  const rightNeedsAttention = agentTaskNeedsAttention(right);
  if (leftNeedsAttention !== rightNeedsAttention) return leftNeedsAttention ? -1 : 1;
  if (leftNeedsAttention) {
    return (right.attentionRequestedAt ?? taskTimestamp(right))
      - (left.attentionRequestedAt ?? taskTimestamp(left));
  }
  return taskTimestamp(right) - taskTimestamp(left);
}
