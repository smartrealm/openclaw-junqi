import { useCallback, useEffect, useRef, useState } from 'react';
import { openClawTtsStatusClient } from '@/services/gateway';
import {
  OpenClawTtsStatusUnavailableError,
  type OpenClawTtsStatus,
} from '@/services/gateway/OpenClawTtsStatusClient';

export type OpenClawTtsStatusFailure = 'unavailable' | 'invalid';

interface OpenClawTtsStatusState {
  readonly status: OpenClawTtsStatus | null;
  readonly loading: boolean;
  readonly failure: OpenClawTtsStatusFailure | null;
}

const EMPTY_STATE: OpenClawTtsStatusState = {
  status: null,
  loading: false,
  failure: null,
};

export function useOpenClawTtsStatus(active: boolean) {
  const [state, setState] = useState<OpenClawTtsStatusState>(EMPTY_STATE);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    if (!active) return;
    const version = ++requestVersion.current;
    setState((current) => ({ ...current, loading: true, failure: null }));
    try {
      const status = await openClawTtsStatusClient.get();
      if (requestVersion.current === version) {
        setState({ status, loading: false, failure: null });
      }
    } catch (error) {
      if (requestVersion.current === version) {
        setState({
          status: null,
          loading: false,
          failure: error instanceof OpenClawTtsStatusUnavailableError ? 'unavailable' : 'invalid',
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
