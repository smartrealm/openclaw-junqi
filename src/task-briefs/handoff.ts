import type { FocusContext } from '@/focus/focusContext';
import type { AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';
import { checkTaskBrief } from './checker';
import { compileTaskBrief, type TaskBriefPromptLabels } from './compiler';
import type { TaskBrief } from './domain';

export type TaskBriefTaskInput = Omit<AgentWorkspaceTask, 'id' | 'createdAt' | 'updatedAt'>;

export interface TaskBriefHandoffDependencies {
  createTask: (input: Omit<AgentWorkspaceTask, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status?: AgentWorkspaceTask['status'] }) => AgentWorkspaceTask;
  findTaskBySourceBriefId: (briefId: string) => AgentWorkspaceTask | null;
  markLaunched: (briefId: string, taskId: string) => void;
  setFocus: (focus: FocusContext) => void;
  promptLabels: TaskBriefPromptLabels;
}

export function handoffTaskBrief(brief: TaskBrief, dependencies: TaskBriefHandoffDependencies): {
  taskId: string;
  route: string;
  task: TaskBriefTaskInput;
  created: boolean;
} {
  if (checkTaskBrief(brief).some((finding) => finding.severity === 'error')) {
    throw new Error('Task brief is not ready for handoff');
  }
  const existing = dependencies.findTaskBySourceBriefId(brief.id);
  const task: TaskBriefTaskInput = existing ?? {
    projectPath: brief.projectPath.trim(),
    title: brief.title.trim() || undefined,
    prompt: compileTaskBrief(brief, dependencies.promptLabels),
    agent: brief.agent,
    permissionMode: brief.permissionMode,
    planMode: brief.planMode,
    launchMode: brief.launchMode,
    baseBranch: brief.baseBranch?.trim() || undefined,
    sourceBriefId: brief.id,
    status: 'todo',
  };
  const createdTask = existing ?? dependencies.createTask(task);
  dependencies.markLaunched(brief.id, createdTask.id);
  const route = `/agent-run?taskId=${encodeURIComponent(createdTask.id)}`;
  dependencies.setFocus({
    schemaVersion: 1,
    target: { kind: 'agent-task', id: createdTask.id },
    title: createdTask.title || brief.title || dependencies.promptLabels.untitled,
    detail: `${createdTask.agent} - ${createdTask.projectPath}`,
    route,
    focusedAt: Date.now(),
  });
  return { taskId: createdTask.id, route, task, created: !existing };
}
