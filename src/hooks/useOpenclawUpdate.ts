import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
import {
  dispatchOpenclawUpdateMaintenanceFinished,
  dispatchOpenclawUpdateMaintenanceStarted,
} from '@/services/openclawUpdateLifecycle';
import { normalizeSetupProgressPayload } from './setupProgressEvents';
import { translateSetupProgressMessage } from './setupProgressParams';
import { subscribeTauriEvent } from '@/utils/tauriEvents';

export interface OpenclawUpdateCompletion {
  result: OpenclawUpdateResult;
  status: OpenclawUpdateStatus | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown update error');
}

export function useOpenclawUpdate() {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(openclawUpdateReducer, initialOpenclawUpdateState);
  const operationId = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    const unlisten = subscribeTauriEvent('setup-progress', (event) => {
      if (!busy.current) return;
      const detail = normalizeSetupProgressPayload(event.payload);
      if (!detail || !['openclaw-update', 'node'].includes(detail.step || '')) return;
      dispatch({
        type: 'progressReceived',
        progress: detail.progress,
        message: translateSetupProgressMessage(
          detail.key,
          detail.message,
          (translationKey, options) => t(translationKey, options),
        ),
      });
    });
    return () => {
      operationId.current += 1;
      unlisten();
    };
  }, [t]);

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
    dispatchOpenclawUpdateMaintenanceStarted();
    let maintenanceFinished = false;
    try {
      const result = await updateOpenclaw();
      dispatchOpenclawUpdateMaintenanceFinished();
      maintenanceFinished = true;
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
      if (!maintenanceFinished) {
        dispatchOpenclawUpdateMaintenanceFinished();
      }
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
