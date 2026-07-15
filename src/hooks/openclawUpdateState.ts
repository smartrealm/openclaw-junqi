import type { OpenclawUpdateResult, OpenclawUpdateStatus } from '@/api/tauri-commands';

export type OpenclawUpdatePhase = 'idle' | 'checking' | 'ready' | 'updating' | 'success' | 'error';

export interface OpenclawUpdateState {
  phase: OpenclawUpdatePhase;
  status: OpenclawUpdateStatus | null;
  result: OpenclawUpdateResult | null;
  error: string | null;
  progress: number | null;
  logs: string[];
}

export type OpenclawUpdateAction =
  | { type: 'checkStarted' }
  | { type: 'checkCompleted'; status: OpenclawUpdateStatus }
  | { type: 'updateStarted' }
  | { type: 'updateCompleted'; result: OpenclawUpdateResult; status: OpenclawUpdateStatus | null }
  | { type: 'operationFailed'; error: string }
  | { type: 'progressReceived'; progress: number | null; message: string };

export const initialOpenclawUpdateState: OpenclawUpdateState = {
  phase: 'idle',
  status: null,
  result: null,
  error: null,
  progress: null,
  logs: [],
};

const MAX_UPDATE_LOG_LINES = 200;

export function openclawUpdateReducer(
  state: OpenclawUpdateState,
  action: OpenclawUpdateAction,
): OpenclawUpdateState {
  switch (action.type) {
    case 'checkStarted':
      return {
        ...state,
        phase: 'checking',
        status: null,
        result: null,
        error: null,
        progress: 0,
        logs: [],
      };
    case 'checkCompleted':
      return {
        ...state,
        phase: action.status.error ? 'error' : 'ready',
        status: action.status,
        result: null,
        error: action.status.error,
      };
    case 'updateStarted':
      return {
        ...state,
        phase: 'updating',
        result: null,
        error: null,
        progress: 0,
        logs: [],
      };
    case 'updateCompleted':
      return {
        phase: 'success',
        status: action.status,
        result: action.result,
        error: null,
        progress: 100,
        logs: state.logs,
      };
    case 'operationFailed':
      return { ...state, phase: 'error', error: action.error };
    case 'progressReceived': {
      const last = state.logs[state.logs.length - 1];
      const logs = last === action.message
        ? state.logs
        : [...state.logs, action.message].slice(-MAX_UPDATE_LOG_LINES);
      const nextProgress = action.progress == null
        ? state.progress
        : Math.max(state.progress ?? 0, action.progress);
      return { ...state, progress: nextProgress, logs };
    }
    default:
      return state;
  }
}
