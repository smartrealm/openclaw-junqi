import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  checkOpenclawUpdate,
  updateOpenclaw,
  type OpenclawUpdateResult,
  type OpenclawUpdateStatus,
} from '@/api/tauri-commands';
import {
  beginOpenclawUpdateOperation,
  canPublishOpenclawUpdateOperation,
  createOpenclawUpdateOperationGuard,
  initialOpenclawUpdateState,
  openclawUpdateReducer,
  setOpenclawUpdateOperationMounted,
} from './openclawUpdateState';
import {
  beginOpenclawUpdateMaintenance,
  assertOpenclawUpdateMaintenanceCurrent,
  CollaborationMaintenanceError,
  dispatchOpenclawUpdateMaintenanceFinished,
  dispatchOpenclawUpdateMaintenanceStarted,
  failOpenclawUpdateMaintenance,
  finishOpenclawUpdateMaintenance,
  recoverOpenclawUpdateMaintenance,
} from '@/services/openclawUpdateLifecycle';
import { normalizeSetupProgressPayload } from './setupProgressEvents';
import { translateSetupProgressMessage } from './setupProgressParams';
import { subscribeTauriEvent } from '@/utils/tauriEvents';

export interface OpenclawUpdateCompletion {
  result: OpenclawUpdateResult;
  status: OpenclawUpdateStatus | null;
}

function errorMessage(error: unknown): string {
  if (error instanceof CollaborationMaintenanceError) {
    if (error.activeRuns.length > 0) {
      const goals = error.activeRuns
        .slice(0, 3)
        .map((run) => run.goal || run.runId)
        .join(', ');
      return `${error.message}${goals ? `: ${goals}` : ''}`;
    }
    if (error.recoveryRequired) {
      return `${error.message}. The maintenance lease remains active and must be recovered explicitly.`;
    }
  }
  return error instanceof Error ? error.message : String(error || 'Unknown update error');
}

export function useOpenclawUpdate() {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(openclawUpdateReducer, initialOpenclawUpdateState);
  const operationGuard = useRef(createOpenclawUpdateOperationGuard());
  const busy = useRef(false);
  const [maintenanceIssue, setMaintenanceIssue] = useState<CollaborationMaintenanceError | null>(null);
  const [recoveringMaintenance, setRecoveringMaintenance] = useState(false);

  useEffect(() => {
    const guard = operationGuard.current;
    setOpenclawUpdateOperationMounted(guard, true);
    return () => {
      setOpenclawUpdateOperationMounted(guard, false);
    };
  }, []);

  useEffect(() => {
    const unlisten = subscribeTauriEvent('setup-progress', (event) => {
      if (!busy.current) return;
      const detail = normalizeSetupProgressPayload(event.payload);
      if (!detail || !['openclaw-update', 'node'].includes(detail.step || '')) return;
      if (detail.operationId) return;
      if (detail.diagnostic) {
        dispatch({ type: 'diagnosticReceived', message: detail.message });
        return;
      }
      dispatch({
        type: 'progressReceived',
        progress: detail.progress,
        message: translateSetupProgressMessage(
          detail.key,
          detail.message,
          (translationKey, options) => t(translationKey, options),
          detail.params,
        ),
      });
    });
    // 监听器重建不代表请求取消；开发模式会额外执行一次 Effect 清理与重建。
    return unlisten;
  }, [t]);

  const check = useCallback(async (): Promise<OpenclawUpdateStatus | null> => {
    if (busy.current) return null;
    busy.current = true;
    const guard = operationGuard.current;
    const id = beginOpenclawUpdateOperation(guard);
    dispatch({ type: 'checkStarted' });
    setMaintenanceIssue(null);
    try {
      const status = await checkOpenclawUpdate();
      if (canPublishOpenclawUpdateOperation(guard, id)) {
        dispatch({ type: 'checkCompleted', status });
      }
      return status;
    } catch (error) {
      if (canPublishOpenclawUpdateOperation(guard, id)) {
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
    const guard = operationGuard.current;
    const id = beginOpenclawUpdateOperation(guard);
    let maintenanceEventStarted = false;
    let maintenance: Awaited<ReturnType<typeof beginOpenclawUpdateMaintenance>> | null = null;
    try {
      setMaintenanceIssue(null);
      maintenance = await beginOpenclawUpdateMaintenance();
      await assertOpenclawUpdateMaintenanceCurrent(maintenance);
      dispatch({ type: 'updateStarted' });
      dispatchOpenclawUpdateMaintenanceStarted();
      maintenanceEventStarted = true;
      const result = await updateOpenclaw();
      if (!result.success) {
        if (maintenance.guarded) {
          throw failOpenclawUpdateMaintenance(
            maintenance,
            new Error(result.error || result.reason || 'OpenClaw update did not complete'),
          );
        }
        if (canPublishOpenclawUpdateOperation(guard, id)) {
          dispatch({
            type: 'operationFailed',
            error: result.error || result.reason || 'OpenClaw update did not complete',
          });
        }
        return { result, status: null };
      }

      await finishOpenclawUpdateMaintenance(maintenance);

      let status: OpenclawUpdateStatus | null = null;
      try {
        status = await checkOpenclawUpdate();
      } catch {
        // 核心更新已经成功；注册表不可用时保留更新器返回的版本，不以追加检查否定成功结果。
      }
      if (canPublishOpenclawUpdateOperation(guard, id)) {
        dispatch({ type: 'updateCompleted', result, status });
      }
      return { result, status };
    } catch (cause) {
      const error = cause instanceof CollaborationMaintenanceError || !maintenance?.guarded
        ? cause
        : failOpenclawUpdateMaintenance(maintenance, cause);
      const issue = error instanceof CollaborationMaintenanceError ? error : null;
      if (canPublishOpenclawUpdateOperation(guard, id)) {
        setMaintenanceIssue(issue);
        dispatch({ type: 'operationFailed', error: errorMessage(error) });
      }
      return null;
    } finally {
      if (maintenanceEventStarted) {
        dispatchOpenclawUpdateMaintenanceFinished();
      }
      busy.current = false;
    }
  }, []);

  const recoverMaintenance = useCallback(async (): Promise<boolean> => {
    if (busy.current || recoveringMaintenance) return false;
    busy.current = true;
    const guard = operationGuard.current;
    if (guard.mounted) {
      setRecoveringMaintenance(true);
    }
    try {
      await recoverOpenclawUpdateMaintenance();
      if (guard.mounted) {
        setMaintenanceIssue(null);
        dispatch({ type: 'maintenanceRecovered' });
      }
      return true;
    } catch (error) {
      const issue = error instanceof CollaborationMaintenanceError ? error : null;
      if (guard.mounted) {
        setMaintenanceIssue(issue);
        dispatch({ type: 'operationFailed', error: errorMessage(error) });
      }
      return false;
    } finally {
      if (guard.mounted) {
        setRecoveringMaintenance(false);
      }
      busy.current = false;
    }
  }, [recoveringMaintenance]);

  return {
    ...state,
    checking: state.phase === 'checking',
    updating: state.phase === 'updating',
    maintenanceIssue,
    recoveringMaintenance,
    check,
    apply,
    recoverMaintenance,
  };
}
