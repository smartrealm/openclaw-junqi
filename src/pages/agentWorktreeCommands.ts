export function createTaskWorktreeArgs(projectPath: string, taskId: string, baseBranch?: string) {
  return { projectPath: projectPath || '.', taskId, baseBranch: baseBranch || 'main' };
}

export function taskWorktreeArgs(projectPath: string, worktreePath: string, branch: string) {
  return { projectPath: projectPath || '.', worktreePath, branch };
}

export function mergeTaskWorktreeArgs(projectPath: string, worktreePath: string, branch: string, baseBranch?: string) {
  return { ...taskWorktreeArgs(projectPath, worktreePath, branch), baseBranch: baseBranch || 'main' };
}

export function worktreeDiffStatsArgs(projectPath: string, worktreePath: string, baseBranch?: string) {
  return { projectPath: projectPath || '.', worktreePath, baseBranch: baseBranch || 'main' };
}

