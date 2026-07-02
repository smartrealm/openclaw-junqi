/**
 * useAgentScopedSession — read `?agent=<id>&new=1` from the route, materialize
 * a fresh session key for that agent, register it as a local placeholder,
 * and pin/mark it active. Fires only once per `?new=1` navigation so
 * subsequent renders leave the user alone.
 *
 * The session is a placeholder until the user sends a real message — at
 * which point the gateway's sessions.list reply swaps it out with the
 * real session record.
 */
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useChatStore, type Session } from '@/stores/chatStore';

/** Build a fresh session key scoped to a specific agent id. */
export function makeAgentSessionKey(agentId: string): string {
  const slot = `s-${Date.now().toString(36).slice(-5)}`;
  return `agent:${agentId}:${slot}`;
}

export function useAgentScopedSession(): void {
  const [params] = useSearchParams();
  const agentId = params.get('agent');
  const wantNew = params.get('new') === '1';
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current) return;
    if (!agentId || !wantNew) return;

    const newKey = makeAgentSessionKey(agentId);
    const placeholder: Session = {
      key: newKey,
      label: '新会话',
      agentId,
      createdAt: Date.now(),
      pinned: true,
    } as any;

    useChatStore.getState().addLocalSession(placeholder);

    appliedRef.current = true;

    // Strip the querystring so refreshing the page doesn't recreate the
    // session. Use replaceState to avoid re-triggering useSearchParams.
    const url = new URL(window.location.href);
    url.searchParams.delete('new');
    url.searchParams.delete('agent');
    window.history.replaceState({}, '', url.toString());
  // Re-runs only when the querystring changes; we re-trigger this from
  // the sidebar's "+ New Session" button by adding ?new=1 each click.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, wantNew]);
}
