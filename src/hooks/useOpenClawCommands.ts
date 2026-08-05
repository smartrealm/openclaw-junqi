import { useCallback, useEffect, useRef, useState } from 'react';
import { openClawCommandsClient } from '@/services/gateway';
import {
  OpenClawCommandsUnavailableError,
  type OpenClawCommandEntry,
  type OpenClawCommandsListInput,
} from '@/services/gateway/OpenClawCommandsClient';

export type OpenClawCommandsFailure = 'unavailable' | 'invalid';

interface OpenClawCommandsState {
  readonly commands: readonly OpenClawCommandEntry[];
  readonly loading: boolean;
  readonly failure: OpenClawCommandsFailure | null;
}

const EMPTY_STATE: OpenClawCommandsState = {
  commands: [],
  loading: false,
  failure: null,
};

/** Keeps a visible command catalog tied to its active Gateway request generation. */
export function useOpenClawCommands(active: boolean, input: OpenClawCommandsListInput = {}) {
  const [state, setState] = useState<OpenClawCommandsState>(EMPTY_STATE);
  const requestVersion = useRef(0);
  const { agentId, provider, scope, includeArgs } = input;

  const refresh = useCallback(async () => {
    if (!active) return;
    const version = ++requestVersion.current;
    setState({ commands: [], loading: true, failure: null });
    try {
      const commands = await openClawCommandsClient.list({ agentId, provider, scope, includeArgs });
      if (requestVersion.current === version) {
        setState({ commands, loading: false, failure: null });
      }
    } catch (error) {
      if (requestVersion.current === version) {
        setState({
          commands: [],
          loading: false,
          failure: error instanceof OpenClawCommandsUnavailableError ? 'unavailable' : 'invalid',
        });
      }
    }
  }, [active, agentId, includeArgs, provider, scope]);

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
