import { useCallback, useEffect, useRef, useState } from 'react';
import { gateway } from '@/services/gateway';
import type { SessionTranscriptBranch } from '@/services/gateway/SessionTranscriptHistoryClient';
import { useGatewaySessionHistoryCapabilities } from './useGatewaySessionHistoryCapabilities';

interface SessionBranchesState {
  readonly branches: readonly SessionTranscriptBranch[];
  readonly loading: boolean;
  readonly error: string | null;
}

const EMPTY_STATE: SessionBranchesState = {
  branches: [],
  loading: false,
  error: null,
};

export function useSessionBranches(sessionKey: string, agentId: string, enabled: boolean) {
  const capabilities = useGatewaySessionHistoryCapabilities();
  const [state, setState] = useState<SessionBranchesState>(EMPTY_STATE);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    if (!capabilities.branches || !enabled) return;
    const targetSessionKey = sessionKey.trim();
    const targetAgentId = agentId.trim();
    if (!targetSessionKey) {
      setState(EMPTY_STATE);
      return;
    }
    const currentRequestId = ++requestId.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const branches = await gateway.listSessionBranches(targetSessionKey, targetAgentId || undefined);
      if (requestId.current !== currentRequestId) return;
      setState({ branches, loading: false, error: null });
    } catch (cause) {
      if (requestId.current !== currentRequestId) return;
      setState({
        branches: [],
        loading: false,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [agentId, capabilities.branches, enabled, sessionKey]);

  useEffect(() => {
    requestId.current += 1;
    setState(EMPTY_STATE);
    if (enabled && capabilities.branches) void refresh();
    return () => { requestId.current += 1; };
  }, [capabilities.branches, enabled, refresh]);

  const switchBranch = useCallback(async (leafEntryId: string) => {
    await gateway.switchSessionBranch(sessionKey.trim(), leafEntryId, agentId.trim() || undefined);
  }, [agentId, sessionKey]);

  return { capabilities, ...state, refresh, switchBranch };
}
