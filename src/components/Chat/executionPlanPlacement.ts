import type { AgentExecutionPlan } from '@/agent-execution-plan/domain';
import { projectResponseGroupToRenderBlocks } from '@/processing/projectResponseGroup';
import type { ResponseGroup } from '@/types/ResponseGroup';

/**
 * The newest unfinished plan is a session-level composer companion. Completed
 * plans stay in transcript history, while this projection sits above the input.
 */
export function selectActiveExecutionPlan(
  groups: readonly ResponseGroup[],
): AgentExecutionPlan | null {
  for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
    const blocks = projectResponseGroupToRenderBlocks(groups[groupIndex]);
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex];
      if (block.type !== 'execution-plan') continue;
      return block.plan.state === 'completed' ? null : block.plan;
    }
  }
  return null;
}
