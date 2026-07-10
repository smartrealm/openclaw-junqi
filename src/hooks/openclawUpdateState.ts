import type { OpenclawUpdateResult, OpenclawUpdateStatus } from '@/api/tauri-commands';

export type OpenclawUpdatePhase = 'idle' | 'checking' | 'ready' | 'updating' | 'success' | 'error';

export interface OpenclawUpdateState {
  phase: OpenclawUpdatePhase;
  status: OpenclawUpdateStatus | null;
  result: OpenclawUpdateResult | null;
  error: string | null;
}

export type OpenclawUpdateAction =
  | { type: 'checkStarted' }
  | { type: 'checkCompleted'; status: OpenclawUpdateStatus }
  | { type: 'updateStarted' }
  | { type: 'updateCompleted'; result: OpenclawUpdateResult; status: OpenclawUpdateStatus | null }
  | { type: 'operationFailed'; error: string };

export const initialOpenclawUpdateState: OpenclawUpdateState = {
  phase: 'idle',
  status: null,
  result: null,
  error: null,
};

export function openclawUpdateReducer(
  state: OpenclawUpdateState,
  action: OpenclawUpdateAction,
): OpenclawUpdateState {
  switch (action.type) {
    case 'checkStarted':
      return { ...state, phase: 'checking', status: null, result: null, error: null };
    case 'checkCompleted':
      return {
        ...state,
        phase: action.status.error ? 'error' : 'ready',
        status: action.status,
        result: null,
        error: action.status.error,
      };
    case 'updateStarted':
      return { ...state, phase: 'updating', result: null, error: null };
    case 'updateCompleted':
      return {
        phase: 'success',
        status: action.status,
        result: action.result,
        error: null,
      };
    case 'operationFailed':
      return { ...state, phase: 'error', error: action.error };
    default:
      return state;
  }
}
