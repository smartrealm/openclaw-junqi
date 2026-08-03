import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useEffectiveTools } from './useEffectiveTools';
import { probeBrowserProviders } from '@/services/browser/browserProviderRuntime';
import {
  hasOpenClawBrowserTool,
  type BrowserProviderProbe,
} from '@/services/browser/browserProviders';

interface ProviderProbeState {
  probes: BrowserProviderProbe[];
  loading: boolean;
  error: string | null;
}

export type NativeBrowserStatus = 'checking' | 'available' | 'unavailable' | 'unknown';

export interface BrowserRuntimeStatus {
  probes: BrowserProviderProbe[];
  probeLoading: boolean;
  probeError: string | null;
  refresh: () => Promise<void>;
  nativeStatus: NativeBrowserStatus;
  nativeToolError: string | null;
  nativeToolLoading: boolean;
}

export function useBrowserRuntimeStatus(): BrowserRuntimeStatus {
  const connected = useChatStore((state) => state.connected);
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const agentId = useMemo(() => activeSessionKey.split(':')[1]?.trim() ?? '', [activeSessionKey]);
  const effectiveTools = useEffectiveTools(activeSessionKey, agentId, connected);
  const [state, setState] = useState<ProviderProbeState>({ probes: [], loading: false, error: null });
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const probes = await probeBrowserProviders();
      if (requestId.current !== request) return;
      setState({ probes, loading: false, error: null });
    } catch (error) {
      if (requestId.current !== request) return;
      setState({
        probes: [],
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => { requestId.current += 1; };
  }, [refresh]);

  const nativeStatus: NativeBrowserStatus = !connected
    ? 'unknown'
    : effectiveTools.loading
      ? 'checking'
      : effectiveTools.error
        ? 'unknown'
        : hasOpenClawBrowserTool(effectiveTools.result)
          ? 'available'
          : 'unavailable';

  return {
    probes: state.probes,
    probeLoading: state.loading,
    probeError: state.error,
    refresh,
    nativeStatus,
    nativeToolError: effectiveTools.error,
    nativeToolLoading: effectiveTools.loading,
  };
}
