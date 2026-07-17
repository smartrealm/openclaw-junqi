/**
 * useAgentScopedSession — read `?agent=<id>&new=1` from the route, materialize
 * a fresh session key for that agent, register it as a local placeholder,
 * and mark it active. Fires only once per `?new=1` navigation so subsequent
 * renders leave the user alone.
 *
 * The session is a placeholder until the user sends a real message — at
 * which point the gateway's sessions.list reply swaps it out with the
 * real session record.
 */
import { useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useChatStore, type Session } from '@/stores/chatStore';
import { createAgentSessionKey } from '@/utils/sessionLifecycle';

/** Build a fresh session key scoped to a specific agent id. */
export function makeAgentSessionKey(agentId: string): string {
  return createAgentSessionKey(agentId);
}

export function useAgentScopedSession(): void {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const agentId = params.get('agent');
  const wantNew = params.get('new') === '1';
  const handledLocationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!agentId || !wantNew) return;
    if (handledLocationKeyRef.current === location.key) return;
    handledLocationKeyRef.current = location.key;

    const newKey = makeAgentSessionKey(agentId);
    const placeholder: Session = {
      key: newKey,
      label: '新会话',
      agentId,
      createdAt: Date.now(),
    };

    useChatStore.getState().addLocalSession(placeholder);

    // Keep React Router's location state in sync with the visible URL. A later
    // navigation to the same ?agent=...&new=1 URL receives a fresh location
    // key and creates another session instead of being blocked forever.
    const nextParams = new URLSearchParams(params);
    nextParams.delete('new');
    nextParams.delete('agent');
    setParams(nextParams, { replace: true });
  }, [agentId, location.key, params, setParams, wantNew]);
}
