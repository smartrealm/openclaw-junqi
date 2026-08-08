import type { CollaborationRunSummary } from '@/services/collaboration/types';

export const DEFAULT_AGENT_HUB_VIEW = 'office' as const;

export function selectableAgentHubOfficeRuns(
  runs: readonly CollaborationRunSummary[],
): CollaborationRunSummary[] {
  return runs
    .filter((run) => run.archiveState === 'ACTIVE')
    .sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
      return left.runId.localeCompare(right.runId);
    });
}

export function selectAgentHubOfficeRun(
  runs: readonly CollaborationRunSummary[],
  selectedRunId: string | null,
): CollaborationRunSummary | null {
  const selectable = selectableAgentHubOfficeRuns(runs);
  return selectable.find((run) => run.runId === selectedRunId) ?? selectable[0] ?? null;
}
