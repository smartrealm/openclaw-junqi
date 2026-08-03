import { useCallback, useEffect, useRef, useState } from 'react';
import { gateway } from '@/services/gateway';
import type { ToolsEffectiveResult } from '@/services/gateway/toolsEffective';

interface EffectiveToolsState {
  result: ToolsEffectiveResult | null;
  loading: boolean;
  error: string | null;
}

export function useEffectiveTools(sessionKey: string, agentId: string, enabled: boolean): EffectiveToolsState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<EffectiveToolsState>({ result: null, loading: false, error: null });
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const normalizedSessionKey = sessionKey.trim();
    const normalizedAgentId = agentId.trim();
    if (!normalizedSessionKey || !normalizedAgentId) {
      setState({ result: null, loading: false, error: 'OpenClaw session identity is unavailable' });
      return;
    }
    const currentRequest = ++requestId.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await gateway.getEffectiveTools(normalizedSessionKey, normalizedAgentId);
      if (requestId.current !== currentRequest) return;
      setState({ result, loading: false, error: null });
    } catch (error) {
      if (requestId.current !== currentRequest) return;
      setState({
        result: null,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [agentId, sessionKey]);

  useEffect(() => {
    requestId.current += 1;
    setState({ result: null, loading: false, error: null });
    if (!enabled) return;
    void load();
    return () => { requestId.current += 1; };
  }, [enabled, load]);

  return { ...state, refresh: load };
}
