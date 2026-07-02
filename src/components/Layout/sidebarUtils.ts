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

export function sessionTitle(sx: Session, firstUserMessage?: string): string {
  // 1. User-set label wins. Display the explicit user-chosen name even
  //    on the main session and even if it matches the legacy "Main Session"
  //    placeholder.
  if (sx.label && sx.label.trim().length > 0) {
    if (sx.label !== 'Main Session') return sx.label;
    // Even when the label literally equals "Main Session", if the user
    // typed it themselves (the openclaw-side default for new sessions),
    // respect it. Only fall through to key-based labels if the label
    // is missing or empty.
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

/** Group sessions by the agentId embedded in their key.
 *  Key format: `agent:<agentId>:<...>` — e.g. `agent:main:main`,
 *  `agent:researcher:run-1`, `agent:coder:sess-9`.
 *  Sessions whose key doesn't match the `agent:<id>:...` shape fall into
 *  the synthetic `'__ungrouped__'` bucket so they still render.
 */
export interface AgentGroup {
  agentId: string;
  label: string;
  sessions: Session[];
}

export function groupSessionsByAgent(
  sessions: Session[],
): AgentGroup[] {
  const buckets = new Map<string, Session[]>();
  for (const sx of sessions) {
    const parts = String(sx.key || '').split(':');
    const agentId = parts[0] === 'agent' && parts[1] ? parts[1] : '__ungrouped__';
    const bucket = buckets.get(agentId) ?? [];
    bucket.push(sx);
    buckets.set(agentId, bucket);
  }
  const groups: AgentGroup[] = [];
  for (const [agentId, ss] of buckets) {
    groups.push({
      agentId,
      label: agentId === '__ungrouped__'
        ? '其他'
        : agentId === 'main' ? '主智能体' : agentId,
      sessions: ss,
    });
  }
  // Stable order: main first, others alphabetical, ungrouped last.
  groups.sort((a, b) => {
    const rank = (g: AgentGroup) => g.agentId === 'main' ? 0
      : g.agentId === '__ungrouped__' ? 2 : 1;
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label);
  });
  return groups;
}

export function modelShort(m: unknown): string {
  if (typeof m !== 'string' || !m) return '';
  return m.split('/').pop() ?? '';
}

// Re-export the navigate-hook signature for typed PanelActions consumers
export type NavigateFn = ReturnType<typeof useNavigate>;
