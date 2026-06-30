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

export function partitionSessions(
  sessions: Session[],
  typingBySession: Record<string, boolean>,
): { active: Session[]; recent: Session[] } {
  const visible = sessions.filter((sx) => {
    if (sx.key?.includes(':subagent:')) return false;
    const hasContent = Boolean(sx.lastMessage) || (sx.totalTokens ?? 0) > 0 || sx.label !== 'Main Session';
    if (!hasContent && !isSessionActive(sx) && !typingBySession[sx.key]) return false;
    return true;
  });
  const active = visible.filter((sx) => isSessionActive(sx) || typingBySession[sx.key]);
  const activeKeys = new Set(active.map((sx) => sx.key));
  return { active, recent: visible.filter((sx) => !activeKeys.has(sx.key)) };
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
