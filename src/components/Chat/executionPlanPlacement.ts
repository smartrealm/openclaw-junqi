import type { AgentExecutionPlan } from '@/agent-execution-plan/domain';
import { projectResponseGroupToRenderBlocks } from '@/processing/projectResponseGroup';
import type { ResponseGroup } from '@/types/ResponseGroup';

/**
 * Where a plan belongs, and what it means.
 *
 * OpenClaw's `update_plan` only reports per-step status, so a run that dies
 * mid-plan still leaves its last snapshot with an `in_progress` step. The plan
 * alone therefore cannot distinguish "still working" from "stopped working".
 * The owning response group's terminal status supplies that missing half.
 */
export type ExecutionPlanOutcome = 'running' | 'completed' | 'interrupted';

function isTerminalResponse(status: ResponseGroup['status']): boolean {
  return status === 'error' || status === 'aborted';
}

export function executionPlanOutcome(
  plan: AgentExecutionPlan,
  responseStatus: ResponseGroup['status'],
): ExecutionPlanOutcome {
  if (plan.state === 'completed') return 'completed';
  if (isTerminalResponse(responseStatus)) return 'interrupted';
  return 'running';
}

/** Settled plans are durable records: they belong in transcript history. */
export function isSettledExecutionPlan(outcome: ExecutionPlanOutcome): boolean {
  return outcome !== 'running';
}

/**
 * The newest still-running plan is a session-level composer companion. Settled
 * plans (completed or interrupted) stay in transcript history, while this
 * projection sits above the input.
 */
export function selectActiveExecutionPlan(
  groups: readonly ResponseGroup[],
): AgentExecutionPlan | null {
  for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
    const group = groups[groupIndex];
    const blocks = projectResponseGroupToRenderBlocks(group);
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex];
      if (block.type !== 'execution-plan') continue;
      return executionPlanOutcome(block.plan, group.status) === 'running' ? block.plan : null;
    }
  }
  return null;
}
