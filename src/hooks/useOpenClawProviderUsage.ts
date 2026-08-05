import { useCallback, useEffect, useRef, useState } from 'react';
import { openClawProviderUsageClient } from '@/services/gateway';
import {
  OpenClawProviderUsageUnavailableError,
  type OpenClawProviderUsageSnapshot,
} from '@/services/gateway/OpenClawProviderUsageClient';

export type OpenClawProviderUsageFailure = 'unavailable' | 'invalid';

interface OpenClawProviderUsageState {
  readonly usage: OpenClawProviderUsageSnapshot | null;
  readonly loading: boolean;
  readonly failure: OpenClawProviderUsageFailure | null;
}

const EMPTY_STATE: OpenClawProviderUsageState = {
  usage: null,
  loading: false,
  failure: null,
};

export function useOpenClawProviderUsage(active: boolean) {
  const [state, setState] = useState<OpenClawProviderUsageState>(EMPTY_STATE);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    if (!active) return;
    const version = ++requestVersion.current;
    setState((current) => ({ ...current, loading: true, failure: null }));
    try {
      const usage = await openClawProviderUsageClient.get();
      if (requestVersion.current === version) {
        setState({ usage, loading: false, failure: null });
      }
    } catch (error) {
      if (requestVersion.current === version) {
        setState({
          usage: null,
          loading: false,
          failure: error instanceof OpenClawProviderUsageUnavailableError ? 'unavailable' : 'invalid',
        });
      }
    }
  }, [active]);

  useEffect(() => {
    if (!active) {
      requestVersion.current += 1;
      setState(EMPTY_STATE);
      return;
    }
    void refresh();
  }, [active, refresh]);

  return { ...state, refresh };
}
