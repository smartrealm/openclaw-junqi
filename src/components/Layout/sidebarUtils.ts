// sidebarUtils — 业务函数（纯函数 + 高阶桥）
// 不在组件内联逻辑 — 全部抽到此处，方便单元测试

import type { Session } from '@/stores/chatStore';
import { isUnmaterializedLocalSession } from '@/utils/sessionLifecycle';

export function isSessionActive(sx: Session): boolean {
  if (sx.running === true) return true;
  if (sx.hasPendingCompletion) return true;
  return false;
}

export function sessionActivityTime(sx: Session): number {
  const raw = sx.lastActive ?? sx.lastTimestamp ?? sx.updatedAt ?? sx.createdAt;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function sortSessionsByActivity<T extends Session>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => {
    const runningDelta = Number(isSessionActive(b)) - Number(isSessionActive(a));
    if (runningDelta !== 0) return runningDelta;
    const timeDelta = sessionActivityTime(b) - sessionActivityTime(a);
    if (timeDelta !== 0) return timeDelta;
    return String(a.key).localeCompare(String(b.key));
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type SessionBucketKey = 'today' | 'withinWeek' | 'withinMonth' | 'older';

export const SESSION_BUCKET_KEYS: readonly SessionBucketKey[] = [
  'today',
  'withinWeek',
  'withinMonth',
  'older',
];

export interface SessionBucket {
  key: SessionBucketKey;
  labelKey: string;
  fallback: string;
  sessions: Session[];
}

export function getSessionBucketKey(activityMs: number, nowMs: number = Date.now()): SessionBucketKey {
  if (!activityMs || activityMs <= 0) return 'older';
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (activityMs >= startOfToday) return 'today';
  if (activityMs >= startOfToday - 7 * DAY_MS) return 'withinWeek';
  if (activityMs >= startOfToday - 30 * DAY_MS) return 'withinMonth';
  return 'older';
}

export function bucketSessionsByActivity(sessions: Session[], nowMs: number = Date.now()): SessionBucket[] {
  const buckets: SessionBucket[] = [
    { key: 'today', labelKey: 'sidebar.history.today', fallback: '今天', sessions: [] },
    { key: 'withinWeek', labelKey: 'sidebar.history.withinWeek', fallback: '最近 7 天', sessions: [] },
    { key: 'withinMonth', labelKey: 'sidebar.history.withinMonth', fallback: '最近 30 天', sessions: [] },
    { key: 'older', labelKey: 'sidebar.history.older', fallback: '更早', sessions: [] },
  ];
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const session of sortSessionsByActivity(sessions)) {
    byKey.get(getSessionBucketKey(sessionActivityTime(session), nowMs))?.sessions.push(session);
  }
  return buckets;
}

export function isSessionBucketKey(value: unknown): value is SessionBucketKey {
  return typeof value === 'string' && SESSION_BUCKET_KEYS.includes(value as SessionBucketKey);
}

/**
 * The preferred bucket reflects the user's explicit choice. Buckets that
 * contain the selected conversation or live work are always added so those
 * sessions cannot disappear behind a collapsed disclosure.
 */
export function resolveExpandedSessionBuckets(
  buckets: readonly SessionBucket[],
  preferredBucket: SessionBucketKey,
  requiredSessionKeys: ReadonlySet<string>,
): ReadonlySet<SessionBucketKey> {
  const expanded = new Set<SessionBucketKey>([preferredBucket]);
  for (const bucket of buckets) {
    if (bucket.sessions.some((session) => requiredSessionKeys.has(session.key))) {
      expanded.add(bucket.key);
    }
  }
  return expanded;
}

export function isEmptyTransientSession(
  session: Session | undefined,
  messages: unknown[] | undefined,
): boolean {
  if (!session) return false;
  if (session.key === 'agent:main:main') return false;
  if (!isUnmaterializedLocalSession(session, messages)) return false;
  if (session.pinned || session.archived) return false;
  if (isSessionActive(session)) return false;
  if (messages && messages.length > 0) return false;
  if (session.lastMessage || session.lastTimestamp || session.lastActive || session.updatedAt) return false;
  if ((session.totalTokens ?? 0) > 0) return false;
  return /^(新会话|new session|untitled)$/i.test((session.label || '').trim());
}

export function sessionTitle(sx: Session, firstUserMessage?: string): string {
  // 1. User-set label wins ONLY for explicit renames — we treat the
  //    gateway-default placeholder ("Main Session", "新会话", "Default
  //    Session", etc.) as if the user never set a title, so the first
  //    real user message becomes the natural label once sent.
  if (sx.label && sx.label.trim().length > 0) {
    const trimmed = sx.label.trim();
    const isGatewayPlaceholder = /^(main session|新会话|default session|untitled)$/i.test(trimmed);
    if (!isGatewayPlaceholder) return trimmed;
  }
  // 2. First user message — the most direct preview of what this session is
  //    about. Capped at 30 chars with ellipsis to keep sidebar rows uniform.
  //    We take only the first sentence/line so a long pasted prompt doesn't
  //    blow out the row height.
  if (firstUserMessage && firstUserMessage.trim().length > 0) {
    const trimmed = firstUserMessage.replace(/\s+/g, ' ').trim();
    if (trimmed) {
      // Cut at the first natural break: period, newline, or hard char cap.
      const breakIdx = trimmed.search(/[。.!?！？\n]/);
      const firstChunk = breakIdx > 0 ? trimmed.slice(0, breakIdx) : trimmed;
      return firstChunk.length > 30 ? `${firstChunk.slice(0, 29)}…` : firstChunk;
    }
  }
  // 3. Topic > key-derived sub > agent name.
  if (typeof sx.topic === 'string' && sx.topic.trim()) return sx.topic;
  const parts = String(sx.key || '').split(':');
  const agentId = parts.length >= 2 ? parts[1] : '';
  const sub = parts.length >= 4 ? parts.slice(3).join(':') : '';
  if (sub) return sub.length > 30 ? `${sub.slice(0, 28)}…` : sub;
  if (agentId && agentId !== 'main') return agentId;
  return '新对话';
}
