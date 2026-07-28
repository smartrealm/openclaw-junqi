import type { AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';
import type { WorkbenchWorktree } from '../domain/types';

export interface LegacyWorkbenchMigration {
  worktrees: WorkbenchWorktree[];
  providerSessions: Array<{
    taskId: string;
    worktreeId: string;
    providerId: string;
    providerSessionId: string;
    transcriptPath: string | null;
  }>;
}

function stableId(prefix: string, value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(16)}`;
}

function providerSession(task: AgentWorkspaceTask): { id: string; path: string | null } | null {
  const id = task.sessionId ?? task.claudeSessionId ?? task.codexSessionId;
  if (!id) return null;
  return { id, path: task.sessionPath ?? task.claudeSessionPath ?? task.codexSessionPath ?? null };
}

/**
 * One-way, read-only projection of legacy tasks. The result seeds a new
 * Workbench session but never writes Workbench state back into the legacy
 * AgentWorkspaceTask store.
 */
export function projectLegacyTasksToWorkbench(tasks: readonly AgentWorkspaceTask[]): LegacyWorkbenchMigration {
  const worktreeByPath = new Map<string, WorkbenchWorktree>();
  const providerSessions: LegacyWorkbenchMigration['providerSessions'] = [];

  for (const task of tasks) {
    const path = task.worktreePath || task.projectPath;
    if (!path) continue;
    const worktreeId = stableId('legacy-worktree', path);
    if (!worktreeByPath.has(path)) {
      worktreeByPath.set(path, {
        id: worktreeId,
        projectId: stableId('legacy-project', task.projectPath),
        repositoryId: stableId('legacy-repository', task.projectPath),
        hostId: 'local',
        hostRevision: 0,
        path,
        branch: task.worktreeBranch ?? task.baseBranch ?? null,
        lifecycle: 'active',
      });
    }
    const session = providerSession(task);
    if (session) {
      providerSessions.push({
        taskId: task.id,
        worktreeId,
        providerId: task.agent,
        providerSessionId: session.id,
        transcriptPath: session.path,
      });
    }
  }

  return { worktrees: [...worktreeByPath.values()], providerSessions };
}
