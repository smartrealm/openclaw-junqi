import type { Session } from '@/stores/chatStore';
import { resolveKnownAgentMainSessionKey } from '@/utils/sessionLifecycle';
import { agentIdFromSessionKey } from '@/utils/sessionPresentation';

export type SidebarSessionGrouping = 'category' | 'none';
export type SidebarSessionSortMode = 'created' | 'updated';

export function normalizeSidebarSessionGrouping(value: unknown): SidebarSessionGrouping {
  return value === 'none' ? 'none' : 'category';
}

export interface SidebarSessionCategory<T extends Session> {
  readonly id: string;
  readonly label: string;
  readonly sessions: readonly T[];
}

export interface SidebarSessionProjection<T extends Session> {
  readonly mainSession: T | null;
  readonly pinnedSessions: readonly T[];
  readonly categories: readonly SidebarSessionCategory<T>[];
  readonly ungroupedSessions: readonly T[];
  readonly flatSessions: readonly T[];
}

export interface SidebarSessionProjectionInput<T extends Session> {
  readonly sessions: readonly T[];
  readonly agentId: string;
  readonly defaultAgentId: string | null | undefined;
  readonly defaultMainSessionKey: string | null | undefined;
  readonly grouping: SidebarSessionGrouping;
  readonly sortMode: SidebarSessionSortMode;
  readonly createdOrder?: ReadonlyMap<string, number>;
  readonly categoryOrder?: readonly string[];
}

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timestamp(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string' || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function isSessionActive(session: Session): boolean {
  return session.running === true || session.hasPendingCompletion === true;
}

export function sessionActivityTime(session: Session): number {
  return timestamp(session.lastActive ?? session.lastTimestamp ?? session.updatedAt ?? session.createdAt);
}

export function sessionCreatedTime(session: Session): number {
  return timestamp(session.createdAt);
}

export function extendSidebarSessionCreatedOrder(
  current: ReadonlyMap<string, number>,
  sessions: readonly Pick<Session, 'key'>[],
): ReadonlyMap<string, number> {
  let next: Map<string, number> | null = null;
  for (const session of sessions) {
    if (current.has(session.key) || next?.has(session.key)) continue;
    next ??= new Map(current);
    next.set(session.key, next.size);
  }
  return next ?? current;
}

export function promoteSidebarSessionCreatedOrder(
  current: ReadonlyMap<string, number>,
  sessionKey: string,
): ReadonlyMap<string, number> {
  const key = normalized(sessionKey);
  if (!key || current.get(key) === 0) return current;
  const previousOrder = current.get(key);
  const next = new Map(current);
  for (const [candidateKey, order] of current) {
    if (candidateKey !== key && (previousOrder === undefined || order < previousOrder)) {
      next.set(candidateKey, order + 1);
    }
  }
  next.set(key, 0);
  return next;
}

export function resolveSidebarSessionAgentId(
  session: Pick<Session, 'key' | 'agentId'>,
  defaultAgentId?: string | null,
  defaultMainSessionKey?: string | null,
): string | null {
  const directAgentId = normalized(session.agentId) || agentIdFromSessionKey(session.key);
  if (directAgentId) return directAgentId;
  if (normalized(session.key) !== normalized(defaultMainSessionKey)) return null;
  return normalized(defaultAgentId) || null;
}

export function filterSidebarSessionsByAgent<T extends Session>(
  sessions: readonly T[],
  agentId: string,
  defaultAgentId?: string | null,
  defaultMainSessionKey?: string | null,
): T[] {
  const selectedAgentId = normalized(agentId);
  if (!selectedAgentId) return [];
  return sessions.filter((session) => (
    resolveSidebarSessionAgentId(session, defaultAgentId, defaultMainSessionKey) === selectedAgentId
  ));
}

export function sortSessionsByActivity<T extends Session>(sessions: readonly T[]): T[] {
  return [...sessions].sort((left, right) => {
    const runningDelta = Number(isSessionActive(right)) - Number(isSessionActive(left));
    if (runningDelta !== 0) return runningDelta;
    const timeDelta = sessionActivityTime(right) - sessionActivityTime(left);
    return timeDelta || left.key.localeCompare(right.key);
  });
}

export function sortSidebarSessions<T extends Session>(
  sessions: readonly T[],
  mode: SidebarSessionSortMode,
  createdOrder?: ReadonlyMap<string, number>,
): T[] {
  const originalIndex = new Map(sessions.map((session, index) => [session.key, index]));
  return [...sessions].sort((left, right) => {
    if (mode === 'created' && createdOrder) {
      const orderDelta = (createdOrder.get(left.key) ?? Number.MAX_SAFE_INTEGER)
        - (createdOrder.get(right.key) ?? Number.MAX_SAFE_INTEGER);
      if (orderDelta !== 0) return orderDelta;
    } else {
      const leftTime = mode === 'created' ? sessionCreatedTime(left) : sessionActivityTime(left);
      const rightTime = mode === 'created' ? sessionCreatedTime(right) : sessionActivityTime(right);
      const timeDelta = rightTime - leftTime;
      if (timeDelta !== 0) return timeDelta;
    }
    const orderDelta = (originalIndex.get(left.key) ?? 0) - (originalIndex.get(right.key) ?? 0);
    return orderDelta || left.key.localeCompare(right.key);
  });
}

function orderedCategoryNames<T extends Session>(
  sessions: readonly T[],
  categoryOrder: readonly string[],
): string[] {
  const discovered = new Set(sessions.map((session) => normalized(session.category)).filter(Boolean));
  const ordered = categoryOrder.map(normalized).filter((category) => discovered.delete(category));
  return [...ordered, ...discovered];
}

export function projectSidebarSessions<T extends Session>(
  input: SidebarSessionProjectionInput<T>,
): SidebarSessionProjection<T> {
  const scopedSessions = filterSidebarSessionsByAgent(
    input.sessions,
    input.agentId,
    input.defaultAgentId,
    input.defaultMainSessionKey,
  );
  const mainSessionKey = resolveKnownAgentMainSessionKey(
    input.agentId,
    input.defaultAgentId,
    input.defaultMainSessionKey,
    scopedSessions.map((session) => session.key),
  );
  const mainSession = mainSessionKey
    ? scopedSessions.find((session) => session.key === mainSessionKey) ?? null
    : null;
  const ordinarySessions = scopedSessions.filter((session) => session.key !== mainSessionKey);
  const pinnedSessions = sortSidebarSessions(
    ordinarySessions.filter((session) => session.pinned === true),
    input.sortMode,
    input.createdOrder,
  );
  const unpinnedSessions = sortSidebarSessions(
    ordinarySessions.filter((session) => session.pinned !== true),
    input.sortMode,
    input.createdOrder,
  );
  if (input.grouping === 'none') {
    return {
      mainSession,
      pinnedSessions,
      categories: [],
      ungroupedSessions: [],
      flatSessions: unpinnedSessions,
    };
  }

  const categories = orderedCategoryNames(unpinnedSessions, input.categoryOrder ?? []).map((category) => ({
    id: category,
    label: category,
    sessions: unpinnedSessions.filter((session) => normalized(session.category) === category),
  }));
  return {
    mainSession,
    pinnedSessions,
    categories,
    ungroupedSessions: unpinnedSessions.filter((session) => !normalized(session.category)),
    flatSessions: [],
  };
}
