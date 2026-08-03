import { create } from 'zustand';
import {
  gateway,
  type OpenClawApproval,
  type OpenClawApprovalDecision,
  type OpenClawApprovalHistoryResult,
  type OpenClawApprovalListResult,
} from '@/services/gateway';
import { subscribeGatewayApprovalEvents } from '@/services/gateway/approvalEventBridge';

export type {
  OpenClawApproval,
  OpenClawApprovalDecision,
  OpenClawApprovalHistoryResult,
  OpenClawApprovalListResult,
  OpenClawApprovalSnapshot,
  OpenClawApprovalTerminalReason,
} from '@/services/gateway';

interface OpenClawApprovalsState {
  snapshot: OpenClawApprovalListResult | null;
  history: OpenClawApprovalHistoryResult | null;
  loading: boolean;
  historyLoading: boolean;
  error: string | null;
  historyError: string | null;
  resolvingId: string | null;
  refresh: (connected: boolean, showLoading?: boolean) => Promise<void>;
  refreshHistory: (connected: boolean, showLoading?: boolean) => Promise<void>;
  loadMoreHistory: (connected: boolean) => Promise<void>;
  subscribeLiveUpdates: (connected: boolean) => () => void;
  resolve: (
    connected: boolean,
    approval: OpenClawApproval,
    decision: OpenClawApprovalDecision,
  ) => Promise<void>;
}

let requestSequence = 0;
let historyRequestSequence = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'OpenClaw approval request failed';
}

export const useOpenClawApprovalsStore = create<OpenClawApprovalsState>((set, get) => ({
  snapshot: null,
  history: null,
  loading: false,
  historyLoading: false,
  error: null,
  historyError: null,
  resolvingId: null,
  refresh: async (connected, showLoading = true) => {
    if (!connected) {
      requestSequence += 1;
      historyRequestSequence += 1;
      set({
        snapshot: null,
        history: null,
        loading: false,
        historyLoading: false,
        error: null,
        historyError: null,
      });
      return;
    }
    if (showLoading) set({ loading: true });
    const sequence = requestSequence + 1;
    requestSequence = sequence;
    try {
      const snapshot = await gateway.listPendingApprovals();
      if (sequence !== requestSequence) return;
      set({ snapshot, error: null, loading: false });
    } catch (error) {
      if (sequence !== requestSequence) return;
      set({ error: errorMessage(error), loading: false });
    }
  },
  refreshHistory: async (connected, showLoading = true) => {
    historyRequestSequence += 1;
    const sequence = historyRequestSequence;
    if (!connected) {
      set({ history: null, historyLoading: false, historyError: null });
      return;
    }
    if (showLoading) set({ historyLoading: true });
    try {
      const history = await gateway.listApprovalHistory({ limit: 25 });
      if (sequence !== historyRequestSequence) return;
      set({ history, historyError: null, historyLoading: false });
    } catch (error) {
      if (sequence !== historyRequestSequence) return;
      set({ historyError: errorMessage(error), historyLoading: false });
    }
  },
  loadMoreHistory: async (connected) => {
    const cursor = get().history?.nextCursor;
    if (!connected || !cursor || get().historyLoading) return;
    const sequence = historyRequestSequence + 1;
    historyRequestSequence = sequence;
    set({ historyLoading: true });
    try {
      const page = await gateway.listApprovalHistory({ cursor, limit: 25 });
      if (sequence !== historyRequestSequence) return;
      const existing = get().history;
      const merged = existing && page.availability === 'available'
        ? {
          ...page,
          items: [...existing.items, ...page.items].filter((item, index, all) => (
            all.findIndex((candidate) => candidate.id === item.id) === index
          )),
        }
        : page;
      set({ history: merged, historyError: null, historyLoading: false });
    } catch (error) {
      if (sequence !== historyRequestSequence) return;
      set({ historyError: errorMessage(error), historyLoading: false });
    }
  },
  subscribeLiveUpdates: (connected) => {
    if (!connected) return () => {};
    const unsubscribe = subscribeGatewayApprovalEvents((event) => {
      void get().refresh(gateway.getStatus().connected, false);
      if (event.phase === 'resolved') {
        void get().refreshHistory(gateway.getStatus().connected, false);
      }
    });
    const release = gateway.acquireGatewayApprovalEvents();
    return () => {
      unsubscribe();
      release();
    };
  },
  resolve: async (connected, approval, decision) => {
    if (!connected) {
      set({ error: 'Gateway is not connected' });
      return;
    }
    const id = `${approval.kind}:${approval.id}`;
    set({ resolvingId: id, error: null });
    try {
      await gateway.resolveApproval(approval, decision);
      await get().refresh(gateway.getStatus().connected, false);
      if (get().history?.availability === 'available') {
        await get().refreshHistory(gateway.getStatus().connected, false);
      }
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ resolvingId: null });
    }
  },
}));
