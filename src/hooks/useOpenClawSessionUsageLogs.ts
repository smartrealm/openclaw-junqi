import { useCallback, useEffect, useRef, useState } from 'react';
import { openClawSessionUsageLogsClient } from '@/services/gateway';
import {
  OpenClawSessionUsageLogsUnavailableError,
  type OpenClawSessionUsageLogEntry,
} from '@/services/gateway/OpenClawSessionUsageLogsClient';

export type OpenClawSessionUsageLogsFailure = 'unavailable' | 'invalid';

interface OpenClawSessionUsageLogsState {
  readonly logs: readonly OpenClawSessionUsageLogEntry[];
  readonly loading: boolean;
  readonly failure: OpenClawSessionUsageLogsFailure | null;
}

const EMPTY_STATE: OpenClawSessionUsageLogsState = {
  logs: [],
  loading: false,
  failure: null,
};

export function useOpenClawSessionUsageLogs(sessionKey: string | null) {
  const [state, setState] = useState<OpenClawSessionUsageLogsState>(EMPTY_STATE);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const key = sessionKey?.trim() ?? '';
    if (!key) {
      requestVersion.current += 1;
      setState(EMPTY_STATE);
      return;
    }
    const version = ++requestVersion.current;
    setState((current) => ({ ...current, loading: true, failure: null }));
    try {
      const logs = await openClawSessionUsageLogsClient.get(key);
      if (requestVersion.current === version) {
        setState({ logs, loading: false, failure: null });
      }
    } catch (error) {
      if (requestVersion.current === version) {
        setState({
          logs: [],
          loading: false,
          failure: error instanceof OpenClawSessionUsageLogsUnavailableError ? 'unavailable' : 'invalid',
        });
      }
    }
  }, [sessionKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => () => {
    requestVersion.current += 1;
  }, []);

  return { ...state, refresh };
}
