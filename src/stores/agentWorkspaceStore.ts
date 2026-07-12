import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AgentWorkspaceTaskStatus =
  | 'todo'
  | 'pending'
  | 'running'
  | 'input_required'
  | 'awaiting_review'
  | 'detached'
  | 'interrupted'
  | 'done'
  | 'failed'
  | 'cancelled';

export function isAgentWorkspaceTaskStatus(value: string): value is AgentWorkspaceTaskStatus {
  return value === 'todo'
    || value === 'pending'
    || value === 'running'
    || value === 'input_required'
    || value === 'awaiting_review'
    || value === 'detached'
    || value === 'interrupted'
    || value === 'done'
    || value === 'failed'
    || value === 'cancelled';
}

export interface AgentWorkspaceTask {
  id: string;
  projectPath: string;
  title?: string;
  prompt: string;
  agent: string;
  permissionMode: 'ask' | 'auto_edit' | 'full_access';
  /** Persisted NewTaskView configuration, restored with an unsent task draft. */
  planMode?: boolean;
  launchMode?: 'local' | 'worktree';
  status: AgentWorkspaceTaskStatus;
  createdAt: number;
  updatedAt: number;
  /** Nezha-style unsent new-task view. It stays out of the history until saved or run. */
  isDraft?: boolean;
  starred?: boolean;
  sessionId?: string;
  sessionPath?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  baseBranch?: string;
  worktreeDiscarded?: boolean;
  additions?: number;
  deletions?: number;
  failureReason?: string;
}

interface AgentWorkspaceState {
  tasks: AgentWorkspaceTask[];
  selectedTaskId: string | null;
  selectTask: (id: string | null) => void;
  createTask: (task: Omit<AgentWorkspaceTask, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status?: AgentWorkspaceTaskStatus }) => AgentWorkspaceTask;
  updateTask: (id: string, patch: Partial<Omit<AgentWorkspaceTask, 'id' | 'createdAt'>>) => void;
  removeTask: (id: string) => void;
  clearProjectTasks: (projectPath: string) => void;
}

function createTaskId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `agent-task:${crypto.randomUUID()}`
    : `agent-task:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

export const useAgentWorkspaceStore = create<AgentWorkspaceState>()(
  persist(
    (set) => ({
      tasks: [],
      selectedTaskId: null,
      selectTask: (selectedTaskId) => set({ selectedTaskId }),
      createTask: (input) => {
        const now = Date.now();
        const task: AgentWorkspaceTask = {
          ...input,
          id: createTaskId(),
          status: input.status ?? 'todo',
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ tasks: [task, ...state.tasks], selectedTaskId: task.id }));
        return task;
      },
      updateTask: (id, patch) => set((state) => ({
        tasks: state.tasks.map((task) => task.id === id ? { ...task, ...patch, updatedAt: Date.now() } : task),
      })),
      removeTask: (id) => set((state) => ({
        tasks: state.tasks.filter((task) => task.id !== id),
        selectedTaskId: state.selectedTaskId === id ? null : state.selectedTaskId,
      })),
      clearProjectTasks: (projectPath) => set((state) => ({
        tasks: state.tasks.filter((task) => task.projectPath !== projectPath),
        selectedTaskId: state.tasks.find((task) => task.id === state.selectedTaskId)?.projectPath === projectPath
          ? null
          : state.selectedTaskId,
      })),
    }),
    { name: 'junqi:agent-workspace:v1', version: 1 },
  ),
);
