// sidebarUtils — 业务函数（纯函数 + 高阶桥）
// 不在组件内联逻辑 — 全部抽到此处，方便单元测试

import type { Session } from '@/stores/chatStore';

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

export function sessionTitle(sx: Session, firstUserMessage?: string): string {
  // Gateway label 是会话权威名称。仅 JunQi 创建的默认名称可在首条提示后
  // 用消息摘要展示；手动重命名和 Gateway 标签变化均会清除该标记。
  if (sx.label && sx.label.trim().length > 0 && sx.label !== sx.initialLabel) {
    return sx.label.trim();
  }
  // Gateway 未提供 label 时，首条用户消息可作为只读展示回退。
  // 该回退不会写回或覆盖 Gateway 会话条目。
  // 首条用户消息是会话主题的直接摘要，截断以保持侧边栏行高稳定。
  // 只取首句或首行，避免长粘贴内容撑高行高。
  if (firstUserMessage && firstUserMessage.trim().length > 0) {
    const trimmed = firstUserMessage.replace(/\s+/g, ' ').trim();
    if (trimmed) {
      // 在首个自然断句处或长度上限处截断。
      const breakIdx = trimmed.search(/[。.!?！？\n]/);
      const firstChunk = breakIdx > 0 ? trimmed.slice(0, breakIdx) : trimmed;
      return firstChunk.length > 30 ? `${firstChunk.slice(0, 29)}…` : firstChunk;
    }
  }
  // 依次使用 topic、会话 key 子段和智能体名称。
  if (typeof sx.topic === 'string' && sx.topic.trim()) return sx.topic;
  const parts = String(sx.key || '').split(':');
  const agentId = parts.length >= 2 ? parts[1] : '';
  const sub = parts.length >= 4 ? parts.slice(3).join(':') : '';
  if (sub) return sub.length > 30 ? `${sub.slice(0, 28)}…` : sub;
  if (agentId && agentId !== 'main') return agentId;
  return sx.key;
}
