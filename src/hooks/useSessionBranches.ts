import { useCallback, useEffect, useRef, useState } from 'react';
import { gateway } from '@/services/gateway';
import type { OpenClawSessionBranch } from '@/services/gateway';

interface SessionBranchesState {
  branches: readonly OpenClawSessionBranch[];
  loading: boolean;
  error: string | null;
  switchingLeafEntryId: string | null;
}

const EMPTY_STATE: SessionBranchesState = {
  branches: [],
  loading: false,
  error: null,
  switchingLeafEntryId: null,
};

export function useSessionBranches(sessionKey: string, agentId: string, enabled: boolean) {
  const [state, setState] = useState<SessionBranchesState>(EMPTY_STATE);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const targetSessionKey = sessionKey.trim();
    const targetAgentId = agentId.trim();
    if (!targetSessionKey) {
      setState({ ...EMPTY_STATE, error: 'OpenClaw session identity is unavailable' });
      return;
    }
    const currentRequest = ++requestId.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const branches = await gateway.listSessionBranches(targetSessionKey, targetAgentId || undefined);
      if (requestId.current !== currentRequest) return;
      setState((current) => ({ ...current, branches, loading: false, error: null }));
    } catch (error) {
      if (requestId.current !== currentRequest) return;
      setState((current) => ({
        ...current,
        branches: [],
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [agentId, sessionKey]);

  useEffect(() => {
    requestId.current += 1;
    setState(EMPTY_STATE);
    if (!enabled) return;
    void refresh();
    return () => { requestId.current += 1; };
  }, [enabled, refresh]);

  const switchBranch = useCallback(async (leafEntryId: string) => {
    const targetSessionKey = sessionKey.trim();
    if (!targetSessionKey) throw new Error('OpenClaw session identity is unavailable');
    setState((current) => ({ ...current, switchingLeafEntryId: leafEntryId, error: null }));
    try {
      await gateway.switchSessionBranch(targetSessionKey, leafEntryId, agentId.trim() || undefined);
    } finally {
      setState((current) => ({ ...current, switchingLeafEntryId: null }));
    }
  }, [agentId, sessionKey]);

  return { ...state, refresh, switchBranch };
}
