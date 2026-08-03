export type TaskBriefCardKind = 'goal' | 'background' | 'constraint' | 'acceptance' | 'note';
export type TaskBriefReferenceKind = 'file' | 'directory' | 'chat-session' | 'agent-task' | 'worktree' | 'collaboration-run' | 'url';
export type TaskBriefStatus = 'draft' | 'ready' | 'launched' | 'archived';

export const TASK_BRIEF_TEXT_LIMITS = {
  title: 200,
  projectPath: 2048,
  cardContent: 20_000,
  referenceLabel: 256,
  referenceValue: 4096,
} as const;

export interface TaskBriefCard {
  id: string;
  kind: TaskBriefCardKind;
  content: string;
}

export interface TaskBriefReference {
  id: string;
  kind: TaskBriefReferenceKind;
  label: string;
  value: string;
}

export interface TaskBrief {
  id: string;
  title: string;
  projectPath: string;
  status: TaskBriefStatus;
  cards: TaskBriefCard[];
  references: TaskBriefReference[];
  agent: 'claude' | 'codex' | 'pi';
  permissionMode: 'ask' | 'auto_edit' | 'full_access';
  planMode: boolean;
  launchMode: 'local' | 'worktree';
  baseBranch?: string;
  launchedTaskId?: string;
  createdAt: number;
  updatedAt: number;
}

export const TASK_BRIEF_CARD_KINDS: readonly TaskBriefCardKind[] = ['goal', 'background', 'constraint', 'acceptance', 'note'];
export const TASK_BRIEF_REFERENCE_KINDS: readonly TaskBriefReferenceKind[] = ['file', 'directory', 'chat-session', 'agent-task', 'worktree', 'collaboration-run', 'url'];

export function createTaskBriefEntityId(prefix: 'brief' | 'card' | 'ref', now = Date.now()): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${now.toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${suffix}`;
}

export function createTaskBrief(now = Date.now()): TaskBrief {
  const briefId = createTaskBriefEntityId('brief', now);
  return {
    id: briefId,
    title: '',
    projectPath: '',
    status: 'draft',
    cards: [
      { id: `${briefId}:goal`, kind: 'goal', content: '' },
      { id: `${briefId}:acceptance`, kind: 'acceptance', content: '' },
    ],
    references: [],
    agent: 'claude',
    permissionMode: 'ask',
    planMode: true,
    launchMode: 'local',
    createdAt: now,
    updatedAt: now,
  };
}
