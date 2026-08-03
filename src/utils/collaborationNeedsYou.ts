import type {
  CollaborationRunSnapshot,
  CollaborationRunSummary,
} from '@/services/collaboration/types';

export type CollaborationNeedsYouText = (key: string, fallback: string) => string;

export interface CollaborationNeedsYouItem {
  id: string;
  run: CollaborationRunSummary;
  title: string;
  detail: string;
}

/**
 * Project only plugin-owned states that require an operator decision.
 * Summary status is authoritative for the category; a snapshot is used only
 * to replace the generic intervention text with the current unresolved code.
 */
export function collaborationNeedsYouItems(
  runs: CollaborationRunSummary[],
  snapshots: Record<string, CollaborationRunSnapshot | undefined>,
  text: CollaborationNeedsYouText,
): CollaborationNeedsYouItem[] {
  return runs.flatMap((run) => {
    if (run.status === 'AWAITING_APPROVAL') {
      return [{
        id: `${run.runId}:approval`,
        run,
        title: text('collaboration.drawer.needsYou.approvalTitle', 'Plan approval required'),
        detail: text('collaboration.drawer.needsYou.approvalDetail', 'Review the proposed plan before worker dispatch begins.'),
      }];
    }
    if (run.status === 'AWAITING_INTERVENTION') {
      const snapshot = snapshots[run.runId];
      const intervention = snapshot && snapshot.revision >= run.revision
        ? snapshot.interventions
          .filter((item) => !item.resolvedAt)
          .sort((left, right) => right.createdAt - left.createdAt)[0]
        : undefined;
      return [{
        id: intervention?.id ?? `${run.runId}:intervention`,
        run,
        title: intervention?.code ?? text('collaboration.drawer.needsYou.interventionTitle', 'Intervention required'),
        detail: intervention?.requiredAction
          ?? text('collaboration.drawer.needsYou.interventionDetail', 'Review the current run and choose a recovery action.'),
      }];
    }
    if (run.status === 'DELIVERY_PENDING') {
      return [{
        id: `${run.runId}:delivery`,
        run,
        title: text('collaboration.drawer.needsYou.deliveryTitle', 'Delivery requires attention'),
        detail: text('collaboration.drawer.needsYou.deliveryDetail', 'Reconcile, retry, change the target, or explicitly abandon the pending delivery.'),
      }];
    }
    return [];
  });
}
