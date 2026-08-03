import { useCallback, useEffect, useRef, useState } from 'react';
import { gateway } from '@/services/gateway';
import type { ToolsCatalogResult } from '@/services/gateway/toolsCatalog';

interface ToolsCatalogState {
  result: ToolsCatalogResult | null;
  loading: boolean;
  error: string | null;
}

export function useToolsCatalog(
  agentId?: string,
  includePlugins = true,
  enabled = true,
): ToolsCatalogState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<ToolsCatalogState>({ result: null, loading: false, error: null });
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const normalizedAgentId = agentId?.trim();
    const currentRequest = ++requestId.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await gateway.getToolsCatalog(normalizedAgentId || undefined, includePlugins);
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
  }, [agentId, includePlugins]);

  useEffect(() => {
    requestId.current += 1;
    setState({ result: null, loading: false, error: null });
    if (!enabled) return;
    void load();
    return () => { requestId.current += 1; };
  }, [enabled, load]);

  return { ...state, refresh: load };
}
