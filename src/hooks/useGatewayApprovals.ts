import { useCallback, useEffect, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { gateway } from '@/services/gateway';
import {
  subscribeGatewayApprovalEvents,
} from '@/services/gateway/approvalEventBridge';
import type {
  ApprovalDecision,
  ApprovalRecord,
} from '@/services/gateway/approvals';

interface GatewayApprovalsState {
  approvals: ApprovalRecord[];
  loading: boolean;
  unavailable: boolean;
  error: string | null;
  resolvingIds: Set<string>;
}

const EMPTY_STATE: GatewayApprovalsState = {
  approvals: [],
  loading: false,
  unavailable: false,
  error: null,
  resolvingIds: new Set(),
};

/**
 * Approval access is deliberately opt-in: the list and resolve RPCs require
 * operator.approvals and therefore use the Gateway's short-lived scoped lane.
 */
export function useGatewayApprovals(enabled = true) {
  const connected = useChatStore((state) => state.connected);
  const [state, setState] = useState<GatewayApprovalsState>(EMPTY_STATE);

  const refresh = useCallback(async () => {
    if (!enabled || !connected) {
      setState((current) => ({
        ...current,
        approvals: [],
        loading: false,
        unavailable: Boolean(enabled && !connected),
        error: null,
      }));
      return;
    }
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const approvals = await gateway.listGatewayApprovals();
      setState((current) => ({
        ...current,
        approvals,
        loading: false,
        unavailable: false,
        error: null,
      }));
    } catch (cause) {
      setState((current) => ({
        ...current,
        loading: false,
        unavailable: true,
        error: cause instanceof Error ? cause.message : String(cause),
      }));
    }
  }, [connected, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const releaseApprovalEvents = gateway.acquireGatewayApprovalEvents();
    const unsubscribe = subscribeGatewayApprovalEvents((event) => {
      if (event.phase === 'requested') {
        setState((current) => ({
          ...current,
          approvals: [
            event.record,
            ...current.approvals.filter((record) => record.id !== event.record.id),
          ],
          unavailable: false,
        }));
      } else {
        setState((current) => ({
          ...current,
          approvals: current.approvals.filter((record) => record.id !== event.id),
        }));
      }
    });
    void refresh();
    return () => {
      unsubscribe();
      releaseApprovalEvents();
    };
  }, [enabled, refresh]);

  const resolve = useCallback(async (record: ApprovalRecord, decision: ApprovalDecision) => {
    if (!record.request.allowedDecisions.includes(decision)) {
      throw new Error('The selected approval decision is not allowed by OpenClaw');
    }
    setState((current) => ({
      ...current,
      resolvingIds: new Set(current.resolvingIds).add(record.id),
    }));
    try {
      await gateway.resolveGatewayApproval(record, decision);
      setState((current) => ({
        ...current,
        approvals: current.approvals.filter((candidate) => candidate.id !== record.id),
      }));
    } finally {
      setState((current) => {
        const resolvingIds = new Set(current.resolvingIds);
        resolvingIds.delete(record.id);
        return { ...current, resolvingIds };
      });
    }
  }, []);

  return { ...state, connected, refresh, resolve };
}
