import { useCallback, useEffect, useRef, useState } from 'react';
import { openClawHooksStatusClient } from '@/services/gateway';
import {
  OpenClawHooksStatusUnavailableError,
  type OpenClawHooksStatusSnapshot,
} from '@/services/gateway/OpenClawHooksStatusClient';

export type OpenClawHooksStatusFailure = 'unavailable' | 'invalid';

interface OpenClawHooksStatusState {
  readonly snapshot: OpenClawHooksStatusSnapshot | null;
  readonly loading: boolean;
  readonly failure: OpenClawHooksStatusFailure | null;
}

const EMPTY_STATE: OpenClawHooksStatusState = {
  snapshot: null,
  loading: false,
  failure: null,
};

/** Hook 状态由 Gateway 计算；JunQi 仅保留当前连接的一次只读投影。 */
export function useOpenClawHooksStatus() {
  const [state, setState] = useState<OpenClawHooksStatusState>(EMPTY_STATE);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setState((current) => ({ ...current, loading: true, failure: null }));
    try {
      const snapshot = await openClawHooksStatusClient.get();
      if (requestVersion.current === version) setState({ snapshot, loading: false, failure: null });
    } catch (error) {
      if (requestVersion.current === version) {
        setState({
          snapshot: null,
          loading: false,
          failure: error instanceof OpenClawHooksStatusUnavailableError ? 'unavailable' : 'invalid',
        });
      }
    }
  }, []);

  useEffect(() => () => {
    requestVersion.current += 1;
  }, []);

  return { ...state, refresh };
}
