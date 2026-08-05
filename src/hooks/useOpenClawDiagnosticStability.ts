import { useCallback, useEffect, useRef, useState } from 'react';
import { openClawDiagnosticStabilityClient } from '@/services/gateway';
import {
  OpenClawDiagnosticStabilityUnavailableError,
  type OpenClawDiagnosticStabilitySnapshot,
} from '@/services/gateway/OpenClawDiagnosticStabilityClient';

export type OpenClawDiagnosticStabilityFailure = 'unavailable' | 'invalid';

interface OpenClawDiagnosticStabilityState {
  readonly snapshot: OpenClawDiagnosticStabilitySnapshot | null;
  readonly loading: boolean;
  readonly failure: OpenClawDiagnosticStabilityFailure | null;
}

const EMPTY_STATE: OpenClawDiagnosticStabilityState = {
  snapshot: null,
  loading: false,
  failure: null,
};

/**
 * Stability diagnostics are intentionally user-driven. The Gateway owns the
 * recorder; JunQi keeps only the current, connection-fenced projection.
 */
export function useOpenClawDiagnosticStability() {
  const [state, setState] = useState<OpenClawDiagnosticStabilityState>(EMPTY_STATE);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setState((current) => ({ ...current, loading: true, failure: null }));
    try {
      const snapshot = await openClawDiagnosticStabilityClient.get();
      if (requestVersion.current === version) {
        setState({ snapshot, loading: false, failure: null });
      }
    } catch (error) {
      if (requestVersion.current === version) {
        setState({
          snapshot: null,
          loading: false,
          failure: error instanceof OpenClawDiagnosticStabilityUnavailableError ? 'unavailable' : 'invalid',
        });
      }
    }
  }, []);

  useEffect(() => () => {
    requestVersion.current += 1;
  }, []);

  return { ...state, refresh };
}
