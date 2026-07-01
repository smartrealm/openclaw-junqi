// sidebarUtils — 业务函数（纯函数 + 高阶桥）
// 不在组件内联逻辑 — 全部抽到此处，方便单元测试

import type { Session } from '@/stores/chatStore';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useNavigate } from 'react-router-dom';

export interface PanelActions {
  navigate: (to: string) => void;
  goSession: (key: string) => void;
  navigateActiveSession: (key: string) => void;
}

export function isSessionActive(sx: Session): boolean {
  if (sx.running === true) return true;
  if (sx.hasPendingCompletion) return true;
  return false;
}

/**
 * 4-bucket session partition for the sidebar.
 *   pinned:  user-pinned sessions, sorted to the very top, regardless of
 *            activity (most recently pinned first by array order — caller
 *            passes sessions in stable order, pinned are surfaced first
 *            so the user sees the pinstick take effect immediately).
 *   active:  currently running or streaming.
 *   recent:  the rest, excluding archived.
 *   archived: hidden by default; exposed via the "Show archived (N)" toggle.
 *
 * Archived sessions are filtered OUT of the default sidebar view so they
 * don't clutter the working set. The toggle at the bottom of the
 * sidebar opts in to showing them.
 */
export interface PartitionResult {
  pinned: Session[];
  active: Session[];
  recent: Session[];
  archived: Session[];
}

export function partitionSessions(
  sessions: Session[],
  typingBySession: Record<string, boolean>,
  showArchived: boolean = false,
): PartitionResult {
  // Filter sub-agents + empty sessions out of the working set.
  // Archived sessions ARE preserved in the result (in `archived`), they
  // just don't appear in active/recent/pinned unless showArchived.
  const visible = sessions.filter((sx) => {
    if (sx.key?.includes(':subagent:')) return false;
    const hasContent = Boolean(sx.lastMessage) || (sx.totalTokens ?? 0) > 0 || sx.label !== 'Main Session';
    if (!hasContent && !isSessionActive(sx) && !typingBySession[sx.key]) return false;
    return true;
  });

  const archived = visible.filter((sx) => sx.archived === true);

  // Working set = visible minus archived (unless toggle is on).
  const working = showArchived ? visible : visible.filter((sx) => !sx.archived);

  // Pinned bucket surfaces regardless of activity, so a pinned-but-idle
  // session still sits at the top.
  const pinned = working.filter((sx) => sx.pinned === true);
  const pinnedKeys = new Set(pinned.map((sx) => sx.key));

  const active = working.filter(
    (sx) => !pinnedKeys.has(sx.key) && (isSessionActive(sx) || typingBySession[sx.key]),
  );
  const activeKeys = new Set(active.map((sx) => sx.key));

  const recent = working.filter(
    (sx) => !pinnedKeys.has(sx.key) && !activeKeys.has(sx.key),
  );

  return { pinned, active, recent, archived };
}

export function sessionTitle(sx: Session): string {
  if (typeof sx.topic === 'string' && sx.topic.trim()) return sx.topic;
  if (sx.label && sx.label !== 'Main Session' && !sx.key?.endsWith(':main')) return sx.label;
  const parts = String(sx.key || '').split(':');
  const agentId = parts.length >= 2 ? parts[1] : '';
  const sub = parts.length >= 4 ? parts.slice(3).join(':') : '';
  if (sub) return sub.length > 30 ? `${sub.slice(0, 28)}…` : sub;
  if (agentId && agentId !== 'main') return agentId;
  return '新对话';
}

export function modelShort(m: unknown): string {
  if (typeof m !== 'string' || !m) return '';
  return m.split('/').pop() ?? '';
}

// Re-export the navigate-hook signature for typed PanelActions consumers
export type NavigateFn = ReturnType<typeof useNavigate>;
