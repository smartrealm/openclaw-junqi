import { useCallback, useEffect, useRef, useState } from 'react';
import { openClawModelAuthStatusClient } from '@/services/gateway';
import {
  OpenClawModelAuthStatusUnavailableError,
  type OpenClawModelAuthStatusSnapshot,
} from '@/services/gateway/OpenClawModelAuthStatusClient';

export type OpenClawModelAuthStatusFailure = 'unavailable' | 'invalid';

export interface OpenClawModelAuthStatusRefreshOptions {
  /** Request a fresh Gateway status only for an explicit user-driven refresh. */
  readonly force?: boolean;
}

interface OpenClawModelAuthStatusState {
  readonly status: OpenClawModelAuthStatusSnapshot | null;
  readonly loading: boolean;
  readonly failure: OpenClawModelAuthStatusFailure | null;
}

const EMPTY_STATE: OpenClawModelAuthStatusState = {
  status: null,
  loading: false,
  failure: null,
};

export function useOpenClawModelAuthStatus(active: boolean, agentId?: string) {
  const [state, setState] = useState<OpenClawModelAuthStatusState>(EMPTY_STATE);
  const requestVersion = useRef(0);

  const refresh = useCallback(async ({ force = false }: OpenClawModelAuthStatusRefreshOptions = {}) => {
    if (!active) return;
    const version = ++requestVersion.current;
    setState((current) => ({ ...current, loading: true, failure: null }));
    try {
      const status = await openClawModelAuthStatusClient.get({ refresh: force, agentId });
      if (requestVersion.current === version) {
        setState({ status, loading: false, failure: null });
      }
    } catch (error) {
      if (requestVersion.current === version) {
        setState({
          status: null,
          loading: false,
          failure: error instanceof OpenClawModelAuthStatusUnavailableError ? 'unavailable' : 'invalid',
        });
      }
    }
  }, [active, agentId]);

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
