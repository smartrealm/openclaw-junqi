import { useCallback, useEffect, useRef, useState } from 'react';
import { gateway } from '@/services/gateway';
import type {
  SessionCompactionCheckpoint,
  SessionPreview,
  SessionsCompactionBranchResult,
  SessionsCompactionRestoreResult,
} from '@/services/gateway/sessionInspection';

export type SessionInspectionAction = 'branch' | 'restore' | null;

interface SessionInspectionState {
  preview: SessionPreview | null;
  resolvedKey: string | null;
  checkpoints: SessionCompactionCheckpoint[];
  loading: boolean;
  error: string | null;
}

const EMPTY_STATE: SessionInspectionState = {
  preview: null,
  resolvedKey: null,
  checkpoints: [],
  loading: false,
  error: null,
};

export function useSessionInspection(
  sessionKey: string,
  agentId: string,
  enabled: boolean,
): SessionInspectionState & {
  refresh: () => Promise<void>;
  action: SessionInspectionAction;
  branchCheckpoint: (checkpointId: string) => Promise<SessionsCompactionBranchResult>;
  restoreCheckpoint: (checkpointId: string) => Promise<SessionsCompactionRestoreResult>;
} {
  const [state, setState] = useState<SessionInspectionState>(EMPTY_STATE);
  const [action, setAction] = useState<SessionInspectionAction>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const normalizedSessionKey = sessionKey.trim();
    const normalizedAgentId = agentId.trim();
    if (!normalizedSessionKey) {
      setState({ ...EMPTY_STATE, error: 'OpenClaw session identity is unavailable' });
      return;
    }
    const currentRequest = ++requestId.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const [preview, resolved, checkpoints] = await Promise.all([
        gateway.getSessionPreview(normalizedSessionKey, { limit: 12, maxChars: 240 }),
        gateway.resolveSessionKey(normalizedSessionKey, normalizedAgentId || undefined),
        gateway.listSessionCompactionCheckpoints(normalizedSessionKey, normalizedAgentId || undefined),
      ]);
      if (requestId.current !== currentRequest) return;
      setState({
        preview,
        resolvedKey: resolved.ok ? resolved.key : null,
        checkpoints,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (requestId.current !== currentRequest) return;
      setState({
        ...EMPTY_STATE,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [agentId, sessionKey]);

  useEffect(() => {
    requestId.current += 1;
    setState(EMPTY_STATE);
    setAction(null);
    if (!enabled) return;
    void load();
    return () => { requestId.current += 1; };
  }, [enabled, load]);

  const branchCheckpoint = useCallback(async (checkpointId: string): Promise<SessionsCompactionBranchResult> => {
    setAction('branch');
    try {
      return await gateway.branchSessionCompactionCheckpoint(sessionKey, checkpointId, agentId || undefined);
    } finally {
      setAction(null);
    }
  }, [agentId, sessionKey]);

  const restoreCheckpoint = useCallback(async (checkpointId: string): Promise<SessionsCompactionRestoreResult> => {
    setAction('restore');
    try {
      const result = await gateway.restoreSessionCompactionCheckpoint(sessionKey, checkpointId, agentId || undefined);
      gateway.invalidateChatSession(sessionKey);
      return result;
    } finally {
      setAction(null);
    }
  }, [agentId, sessionKey]);

  return {
    ...state,
    action,
    refresh: load,
    branchCheckpoint,
    restoreCheckpoint,
  };
}
