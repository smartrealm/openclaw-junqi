export type FocusTargetKind = 'agent-task' | 'chat-session' | 'worktree' | 'task-brief';
export type FocusState = 'idle' | 'running' | 'attention' | 'success' | 'error' | 'unavailable';

export interface FocusTarget {
  kind: FocusTargetKind;
  id: string;
}

export interface FocusContext {
  schemaVersion: 1;
  target: FocusTarget;
  title: string;
  detail: string;
  route: string;
  focusedAt: number;
}

export interface FocusProjection extends FocusContext {
  state: FocusState;
}

export interface FocusProjectionSources {
  agentTasks?: Array<{ id: string; title?: string; prompt?: string; status: string; agent: string; projectPath: string }>;
  chatSessions?: Array<{
    key: string;
    label?: string;
    topic?: string;
    agentId?: string;
    status?: string;
    hasActiveRun?: boolean;
    hasActiveSubagentRun?: boolean;
    hasPendingCompletion?: boolean;
  }>;
  activeChatSessionKeys?: ReadonlySet<string>;
  worktrees?: Array<{ id: string; path: string; branch: string | null; lifecycle: string }>;
  taskBriefs?: Array<{ id: string; title: string; status: string; projectPath: string }>;
}

const ALLOWED_ROUTE_PREFIXES = ['/agent-run', '/chat', '/ai-workspace', '/briefs'] as const;
const ROUTE_PREFIX_BY_TARGET: Record<FocusTargetKind, (typeof ALLOWED_ROUTE_PREFIXES)[number]> = {
  'agent-task': '/agent-run',
  'chat-session': '/chat',
  worktree: '/ai-workspace',
  'task-brief': '/briefs',
};
const FOCUS_ID_MAX_LENGTH = 512;
const FOCUS_TITLE_MAX_LENGTH = 256;
const FOCUS_DETAIL_MAX_LENGTH = 1024;
const FOCUS_ROUTE_MAX_LENGTH = 2048;

function boundedString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === 'string'
    && value.length <= maxLength
    && (allowEmpty || value.trim().length > 0);
}

export function isFocusContext(value: unknown): value is FocusContext {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<FocusContext>;
  const target = context.target as Partial<FocusTarget> | undefined;
  return context.schemaVersion === 1
    && !!target
    && (target.kind === 'agent-task' || target.kind === 'chat-session' || target.kind === 'worktree' || target.kind === 'task-brief')
    && boundedString(target.id, FOCUS_ID_MAX_LENGTH)
    && boundedString(context.title, FOCUS_TITLE_MAX_LENGTH)
    && boundedString(context.detail, FOCUS_DETAIL_MAX_LENGTH, true)
    && boundedString(context.route, FOCUS_ROUTE_MAX_LENGTH)
    && typeof context.focusedAt === 'number' && Number.isFinite(context.focusedAt)
    && focusNavigationTarget(context as FocusContext) !== null;
}

export function focusNavigationTarget(context: FocusContext): string | null {
  if (!context.route.startsWith('/') || context.route.includes('..') || context.route.includes('://')) return null;
  const pathname = context.route.split(/[?#]/, 1)[0];
  const expectedPrefix = ROUTE_PREFIX_BY_TARGET[context.target.kind];
  if (!ALLOWED_ROUTE_PREFIXES.includes(expectedPrefix)) return null;
  return pathname === expectedPrefix || pathname.startsWith(`${expectedPrefix}/`) ? context.route : null;
}

function taskState(status: string): FocusState {
  if (status === 'running') return 'running';
  if (status === 'input_required' || status === 'awaiting_review') return 'attention';
  if (status === 'done') return 'success';
  if (status === 'failed' || status === 'interrupted' || status === 'cancelled') return 'error';
  return 'idle';
}

function chatState(
  session: NonNullable<FocusProjectionSources['chatSessions']>[number],
  activeChatSessionKeys: ReadonlySet<string> | undefined,
): FocusState {
  if (session.status === 'failed' || session.status === 'error') return 'error';
  if (session.status === 'input_required' || session.status === 'awaiting_review') return 'attention';
  if (
    activeChatSessionKeys?.has(session.key)
    || session.hasActiveRun
    || session.hasActiveSubagentRun
    || session.hasPendingCompletion
  ) return 'running';
  return 'idle';
}

export function projectFocusContext(context: FocusContext | null, sources: FocusProjectionSources): FocusProjection | null {
  if (!context) return null;
  if (context.target.kind === 'agent-task') {
    const task = sources.agentTasks?.find((candidate) => candidate.id === context.target.id);
    if (!task) return { ...context, state: 'unavailable' };
    return {
      ...context,
      title: task.title?.trim() || task.prompt?.trim().split('\n')[0]?.slice(0, 72) || context.title,
      detail: `${task.agent} · ${task.projectPath}`,
      state: taskState(task.status),
    };
  }
  if (context.target.kind === 'chat-session') {
    const session = sources.chatSessions?.find((candidate) => candidate.key === context.target.id);
    if (!session) return { ...context, state: 'unavailable' };
    return {
      ...context,
      title: session.topic?.trim() || session.label?.trim() || context.title,
      detail: session.agentId || context.detail,
      state: chatState(session, sources.activeChatSessionKeys),
    };
  }
  if (context.target.kind === 'worktree') {
    const worktree = sources.worktrees?.find((candidate) => candidate.id === context.target.id);
    if (!worktree) return { ...context, state: 'unavailable' };
    return {
      ...context,
      title: worktree.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || context.title,
      detail: worktree.branch || worktree.path,
      state: worktree.lifecycle === 'unavailable' || worktree.lifecycle === 'deleting'
        ? 'unavailable'
        : worktree.lifecycle === 'waking'
          ? 'running'
          : 'idle',
    };
  }
  const brief = sources.taskBriefs?.find((candidate) => candidate.id === context.target.id);
  if (!brief) return { ...context, state: 'unavailable' };
  return {
    ...context,
    title: brief.title || context.title,
    detail: brief.projectPath,
    state: brief.status === 'archived'
      ? 'unavailable'
      : brief.status === 'launched' || brief.status === 'ready'
        ? 'success'
        : 'idle',
  };
}
