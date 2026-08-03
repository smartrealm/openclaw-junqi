import { create } from 'zustand';
import {
  gateway,
  type OpenClawTaskListPage,
  type OpenClawTaskSummary,
} from '@/services/gateway';

export type {
  OpenClawTaskCancelResult,
  OpenClawTaskLedgerStatus,
  OpenClawTaskListPage,
  OpenClawTaskSummary,
} from '@/services/gateway';

interface OpenClawTaskLedgerState {
  page: OpenClawTaskListPage | null;
  detailsById: Readonly<Record<string, OpenClawTaskSummary>>;
  loading: boolean;
  detailLoadingId: string | null;
  cancellingTaskId: string | null;
  error: string | null;
  detailErrors: Readonly<Record<string, string>>;
  refresh: (connected: boolean, showLoading?: boolean) => Promise<void>;
  loadMore: (connected: boolean) => Promise<void>;
  loadDetail: (connected: boolean, taskId: string) => Promise<void>;
  cancel: (connected: boolean, task: OpenClawTaskSummary) => Promise<void>;
}

let listRequestSequence = 0;
let detailRequestEpoch = 0;
const detailRequestSequences = new Map<string, number>();
let cancellationRequestSequence = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'OpenClaw task ledger request failed';
}

export const useOpenClawTaskLedgerStore = create<OpenClawTaskLedgerState>((set, get) => ({
  page: null,
  detailsById: {},
  loading: false,
  detailLoadingId: null,
  cancellingTaskId: null,
  error: null,
  detailErrors: {},
  refresh: async (connected, showLoading = true) => {
    const sequence = listRequestSequence + 1;
    listRequestSequence = sequence;
    if (!connected) {
      detailRequestEpoch += 1;
      detailRequestSequences.clear();
      cancellationRequestSequence += 1;
      set({
        page: null,
        detailsById: {},
        loading: false,
        detailLoadingId: null,
        cancellingTaskId: null,
        error: null,
        detailErrors: {},
      });
      return;
    }
    if (showLoading) set({ loading: true });
    try {
      const page = await gateway.listTasks({ limit: 25 });
      if (sequence !== listRequestSequence) return;
      set({ page, loading: false, error: null });
    } catch (error) {
      if (sequence !== listRequestSequence) return;
      set({ loading: false, error: errorMessage(error) });
    }
  },
  loadMore: async (connected) => {
    const current = get().page;
    const cursor = current?.nextCursor;
    if (!connected || current?.availability !== 'available' || cursor === undefined || get().loading) return;
    const sequence = listRequestSequence + 1;
    listRequestSequence = sequence;
    set({ loading: true });
    try {
      const nextPage = await gateway.listTasks({ limit: 25, cursor });
      if (sequence !== listRequestSequence) return;
      const existing = get().page;
      const page = existing && nextPage.availability === 'available'
        ? {
          ...nextPage,
          tasks: [...existing.tasks, ...nextPage.tasks].filter((task, index, tasks) => (
            tasks.findIndex((candidate) => candidate.id === task.id) === index
          )),
        }
        : nextPage;
      set({ page, loading: false, error: null });
    } catch (error) {
      if (sequence !== listRequestSequence) return;
      set({ loading: false, error: errorMessage(error) });
    }
  },
  loadDetail: async (connected, taskId) => {
    if (!connected || get().detailLoadingId === taskId) return;
    const epoch = detailRequestEpoch;
    const sequence = (detailRequestSequences.get(taskId) ?? 0) + 1;
    detailRequestSequences.set(taskId, sequence);
    set((state) => ({
      detailLoadingId: taskId,
      detailErrors: Object.fromEntries(Object.entries(state.detailErrors).filter(([id]) => id !== taskId)),
    }));
    try {
      const task = await gateway.getTask(taskId);
      if (epoch !== detailRequestEpoch || sequence !== detailRequestSequences.get(taskId)) return;
      set((state) => ({
        detailLoadingId: null,
        detailsById: { ...state.detailsById, [task.id]: task },
      }));
    } catch (error) {
      if (epoch !== detailRequestEpoch || sequence !== detailRequestSequences.get(taskId)) return;
      set((state) => ({
        detailLoadingId: null,
        detailErrors: { ...state.detailErrors, [taskId]: errorMessage(error) },
      }));
    }
  },
  cancel: async (connected, task) => {
    if (!connected) {
      set({ error: 'Gateway is not connected' });
      return;
    }
    const sequence = cancellationRequestSequence + 1;
    cancellationRequestSequence = sequence;
    set({ cancellingTaskId: task.id, error: null });
    try {
      const result = await gateway.cancelTask(task.id);
      if (sequence !== cancellationRequestSequence) return;
      if (!result.found || !result.cancelled) {
        set({ error: result.reason || 'OpenClaw did not confirm task cancellation' });
        return;
      }
      await get().refresh(gateway.getStatus().connected, false);
    } catch (error) {
      if (sequence !== cancellationRequestSequence) return;
      set({ error: errorMessage(error) });
    } finally {
      if (sequence === cancellationRequestSequence) set({ cancellingTaskId: null });
    }
  },
}));
