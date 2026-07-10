import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  checkOpenclawUpdate,
  updateOpenclaw,
  type OpenclawUpdateResult,
  type OpenclawUpdateStatus,
} from '@/api/tauri-commands';
import {
  initialOpenclawUpdateState,
  openclawUpdateReducer,
} from './openclawUpdateState';

export interface OpenclawUpdateCompletion {
  result: OpenclawUpdateResult;
  status: OpenclawUpdateStatus | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown update error');
}

export function useOpenclawUpdate() {
  const [state, dispatch] = useReducer(openclawUpdateReducer, initialOpenclawUpdateState);
  const operationId = useRef(0);
  const busy = useRef(false);

  useEffect(() => () => {
    operationId.current += 1;
  }, []);

  const check = useCallback(async (): Promise<OpenclawUpdateStatus | null> => {
    if (busy.current) return null;
    busy.current = true;
    const id = ++operationId.current;
    dispatch({ type: 'checkStarted' });
    try {
      const status = await checkOpenclawUpdate();
      if (id === operationId.current) {
        dispatch({ type: 'checkCompleted', status });
      }
      return status;
    } catch (error) {
      if (id === operationId.current) {
        dispatch({ type: 'operationFailed', error: errorMessage(error) });
      }
      return null;
    } finally {
      busy.current = false;
    }
  }, []);

  const apply = useCallback(async (): Promise<OpenclawUpdateCompletion | null> => {
    if (busy.current) return null;
    busy.current = true;
    const id = ++operationId.current;
    dispatch({ type: 'updateStarted' });
    try {
      const result = await updateOpenclaw();
      if (!result.success) {
        if (id === operationId.current) {
          dispatch({
            type: 'operationFailed',
            error: result.error || result.reason || 'OpenClaw update did not complete',
          });
        }
        return { result, status: null };
      }

      let status: OpenclawUpdateStatus | null = null;
      try {
        status = await checkOpenclawUpdate();
      } catch {
        // The core update succeeded. A follow-up network check is optional;
        // retain the updater's afterVersion when the registry is unavailable.
      }
      if (id === operationId.current) {
        dispatch({ type: 'updateCompleted', result, status });
      }
      return { result, status };
    } catch (error) {
      if (id === operationId.current) {
        dispatch({ type: 'operationFailed', error: errorMessage(error) });
      }
      return null;
    } finally {
      busy.current = false;
    }
  }, []);

  return {
    ...state,
    checking: state.phase === 'checking',
    updating: state.phase === 'updating',
    check,
    apply,
  };
}
