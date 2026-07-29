export function createTaskWorktreeArgs(projectPath: string, taskId: string, baseBranch?: string) {
  return { projectPath: projectPath || '.', taskId, baseBranch: baseBranch || '' };
}

export function taskWorktreeArgs(projectPath: string, worktreePath: string, branch: string) {
  return { projectPath: projectPath || '.', worktreePath, branch };
}

export function mergeTaskWorktreeArgs(projectPath: string, worktreePath: string, branch: string, baseBranch?: string) {
  return { ...taskWorktreeArgs(projectPath, worktreePath, branch), baseBranch: baseBranch || '' };
}

export async function mergeAndRemoveTaskWorktree(
  merge: () => Promise<void>,
  remove: () => Promise<void>,
): Promise<void> {
  await merge();
  await remove();
}

export async function cleanupAgentWorkspaceTask(
  task: {
    active: boolean;
    worktreePath?: string;
    worktreeBranch?: string;
    worktreeDiscarded?: boolean;
  },
  cleanup: {
    cancel: () => Promise<void>;
    removeWorktree: () => Promise<void>;
  },
): Promise<void> {
  if (task.active) await cleanup.cancel();
  if (task.worktreePath && task.worktreeBranch && !task.worktreeDiscarded) {
    await cleanup.removeWorktree();
  }
}

export function worktreeDiffStatsArgs(projectPath: string, worktreePath: string, baseBranch?: string) {
  return { projectPath: projectPath || '.', worktreePath, baseBranch: baseBranch || '' };
}
