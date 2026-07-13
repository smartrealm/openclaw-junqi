import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAgentWorkspaceStore, type AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';

interface PersistedWorkspace {
  id: string;
  projectDirectory?: string;
  workingDirectory?: string;
}

const MIGRATION_PREFIX = 'junqi:agent-workspace:migrated:';

function workspacePath(workspace: PersistedWorkspace): string {
  return workspace.projectDirectory || workspace.workingDirectory || '';
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined'
    && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export function normalizeLoadedAgentWorkspaceTasks(
  tasks: AgentWorkspaceTask[],
  projectPath: string,
  activeTaskIds: ReadonlySet<string>,
): AgentWorkspaceTask[] {
  const recoveredAt = Date.now();
  return tasks.map((task) => {
    const hasLiveProcess = activeTaskIds.has(task.id);
    const recoverableStatus = task.status === 'pending'
      || task.status === 'running'
      || task.status === 'input_required'
      || task.status === 'awaiting_review'
      || task.status === 'detached'
      || (task.status === 'interrupted' && hasLiveProcess);
    const recoveredStatus = recoverableStatus
      ? hasLiveProcess ? 'detached' as const : 'interrupted' as const
      : task.status;
    return {
      ...task,
      projectPath,
      status: recoveredStatus,
      updatedAt: recoverableStatus ? recoveredAt : Number.isFinite(task.updatedAt) ? task.updatedAt : task.createdAt,
      ...(recoverableStatus ? { attentionRequestedAt: task.attentionRequestedAt ?? recoveredAt } : {}),
    };
  });
}

/** Nezha-compatible per-project disk persistence with startup process reconciliation. */
export function useAgentWorkspacePersistence(workspaces: PersistedWorkspace[]): void {
  const loadedIdsRef = useRef(new Set<string>());
  const blockedIdsRef = useRef(new Set<string>());
  const saveTimersRef = useRef(new Map<string, number>());
  const pendingSavesRef = useRef(new Map<string, AgentWorkspaceTask[]>());
  const workspaceMapRef = useRef(new Map<string, string>());

  useEffect(() => {
    workspaceMapRef.current = new Map(
      workspaces
        .map((workspace): [string, string] => [workspacePath(workspace), workspace.id])
        .filter(([path]) => Boolean(path)),
    );
  }, [workspaces]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;

    const hydrate = async () => {
      const candidates = workspaces.filter((workspace) => {
        const path = workspacePath(workspace);
        return path && !loadedIdsRef.current.has(workspace.id) && !blockedIdsRef.current.has(workspace.id);
      });
      if (candidates.length === 0) return;
      const activeTaskIds = new Set(await invoke<string[]>('get_active_task_ids'));
      await Promise.all(candidates.map(async (workspace) => {
        const path = workspacePath(workspace);
        try {
          const loaded = await invoke<AgentWorkspaceTask[]>('load_agent_workspace_tasks', { projectId: workspace.id });
          if (cancelled) return;
          const local = useAgentWorkspaceStore.getState().tasks.filter((task) => task.projectPath === path);
          const migrationKey = `${MIGRATION_PREFIX}${workspace.id}`;
          const firstMigration = localStorage.getItem(migrationKey) !== '1';
          const source = loaded.length === 0 && local.length > 0 && firstMigration ? local : loaded;
          const normalized = normalizeLoadedAgentWorkspaceTasks(source, path, activeTaskIds);
          useAgentWorkspaceStore.getState().replaceProjectTasks(path, normalized);
          loadedIdsRef.current.add(workspace.id);
          localStorage.setItem(migrationKey, '1');
          if (source === local) {
            await invoke('save_agent_workspace_tasks', { projectId: workspace.id, tasks: normalized });
          }
        } catch (error) {
          blockedIdsRef.current.add(workspace.id);
          console.error(`load AI workspace tasks for ${workspace.id}`, error);
        }
      }));
    };

    void hydrate();
    return () => { cancelled = true; };
  }, [workspaces]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unsubscribe = useAgentWorkspaceStore.subscribe((state, previous) => {
      if (state.tasks === previous.tasks) return;
      for (const [path, projectId] of workspaceMapRef.current) {
        if (!loadedIdsRef.current.has(projectId) || blockedIdsRef.current.has(projectId)) continue;
        const current = state.tasks.filter((task) => task.projectPath === path);
        const before = previous.tasks.filter((task) => task.projectPath === path);
        if (current === before || JSON.stringify(current) === JSON.stringify(before)) continue;
        const existing = saveTimersRef.current.get(projectId);
        if (existing !== undefined) window.clearTimeout(existing);
        pendingSavesRef.current.set(projectId, current);
        saveTimersRef.current.set(projectId, window.setTimeout(() => {
          saveTimersRef.current.delete(projectId);
          const tasks = pendingSavesRef.current.get(projectId);
          pendingSavesRef.current.delete(projectId);
          if (!tasks) return;
          void invoke('save_agent_workspace_tasks', { projectId, tasks }).catch((error) => {
            console.error(`save AI workspace tasks for ${projectId}`, error);
          });
        }, 400));
      }
    });
    return () => {
      unsubscribe();
      for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer);
      saveTimersRef.current.clear();
      for (const [projectId, tasks] of pendingSavesRef.current) {
        void invoke('save_agent_workspace_tasks', { projectId, tasks }).catch((error) => {
          console.error(`flush AI workspace tasks for ${projectId}`, error);
        });
      }
      pendingSavesRef.current.clear();
    };
  }, []);
}
