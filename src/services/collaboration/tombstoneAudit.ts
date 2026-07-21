import type { CollaborationTombstone } from './types';

export interface CollaborationFlowReconciliationAbandonmentAudit {
  commandId: string;
  flowId: string | null;
  flowRevision: number | null;
  diagnostic: string | null;
  abandonedAt: number;
  reason: string;
}

export function flowReconciliationAbandonmentAudit(
  tombstone: CollaborationTombstone,
): CollaborationFlowReconciliationAbandonmentAudit | null {
  if (
    tombstone.flowReconciliationCommandId === null
    || tombstone.flowReconciliationAbandonedAt === null
    || tombstone.flowReconciliationAbandonReason === null
  ) {
    return null;
  }

  return {
    commandId: tombstone.flowReconciliationCommandId,
    flowId: tombstone.openclawFlowId,
    flowRevision: tombstone.openclawFlowRevision,
    diagnostic: tombstone.flowReconciliationDiagnostic,
    abandonedAt: tombstone.flowReconciliationAbandonedAt,
    reason: tombstone.flowReconciliationAbandonReason,
  };
}
