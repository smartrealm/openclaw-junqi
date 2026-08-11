export type FocusTargetKind = 'chat-session';
export type FocusState = 'idle' | 'running' | 'attention' | 'error' | 'unavailable';

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
}

const CHAT_ROUTE_PREFIX = '/chat';
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
    && target.kind === 'chat-session'
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
  return pathname === CHAT_ROUTE_PREFIX || pathname.startsWith(`${CHAT_ROUTE_PREFIX}/`)
    ? context.route
    : null;
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
  const session = sources.chatSessions?.find((candidate) => candidate.key === context.target.id);
  if (!session) return { ...context, state: 'unavailable' };
  return {
    ...context,
    title: session.topic?.trim() || session.label?.trim() || context.title,
    detail: session.agentId || context.detail,
    state: chatState(session, sources.activeChatSessionKeys),
  };
}
