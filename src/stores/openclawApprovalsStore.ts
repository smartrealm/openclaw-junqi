import { create } from 'zustand';
import {
  gateway,
  type OpenClawApproval,
  type OpenClawApprovalDecision,
  type OpenClawApprovalListResult,
} from '@/services/gateway';

export type {
  OpenClawApproval,
  OpenClawApprovalDecision,
  OpenClawApprovalListResult,
} from '@/services/gateway';

interface OpenClawApprovalsState {
  snapshot: OpenClawApprovalListResult | null;
  loading: boolean;
  error: string | null;
  resolvingId: string | null;
  refresh: (connected: boolean, showLoading?: boolean) => Promise<void>;
  resolve: (
    connected: boolean,
    approval: OpenClawApproval,
    decision: OpenClawApprovalDecision,
  ) => Promise<void>;
}

let requestSequence = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'OpenClaw approval request failed';
}

export const useOpenClawApprovalsStore = create<OpenClawApprovalsState>((set, get) => ({
  snapshot: null,
  loading: false,
  error: null,
  resolvingId: null,
  refresh: async (connected, showLoading = true) => {
    if (!connected) {
      requestSequence += 1;
      set({ snapshot: null, loading: false, error: null });
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
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ resolvingId: null });
    }
  },
}));
