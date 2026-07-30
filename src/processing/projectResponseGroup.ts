import type { RenderBlock } from '@/types/RenderBlock';
import type { ResponseGroup } from '@/types/ResponseGroup';
import { projectSemanticBlocksToRenderBlocks } from './buildSemanticBlocks';
import { reconcileExecutionPlanSnapshots } from '@/agent-execution-plan/domain';
import type { ExecutionPlanSemanticBlock } from '@/types/SemanticBlock';

export function projectResponseGroupToRenderBlocks(group: ResponseGroup): RenderBlock[] {
  const planBlocks = group.blocks.filter(
    (block): block is ExecutionPlanSemanticBlock => block.type === 'execution-plan',
  );
  if (planBlocks.length < 2) return projectSemanticBlocksToRenderBlocks(group.blocks);

  const latest = planBlocks[planBlocks.length - 1];
  const plan = reconcileExecutionPlanSnapshots(planBlocks.map((block) => block.snapshot));
  return group.blocks.flatMap((block) => {
    if (block.type !== 'execution-plan') return projectSemanticBlocksToRenderBlocks([block]);
    if (block !== latest || !plan) return [];
    return [{
      type: 'execution-plan',
      id: latest.id,
      timestamp: latest.timestamp,
      isStreaming: latest.isStreaming,
      plan,
    } satisfies RenderBlock];
  });
}
