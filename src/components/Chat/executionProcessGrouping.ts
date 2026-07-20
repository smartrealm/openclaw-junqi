import type { RenderBlock, ThinkingBlock, ToolBlock } from '@/types/RenderBlock';

export type ExecutionProcessBlock = ToolBlock | ThinkingBlock;

export type RenderBlockGroup =
  | { type: 'content'; block: RenderBlock }
  | { type: 'execution'; blocks: ExecutionProcessBlock[] };

/**
 * Group adjacent tool/thinking blocks while preserving every other block's
 * position. This keeps the chat stream semantic and lets the renderer show a
 * compact execution summary without hiding message/result blocks.
 */
export function groupExecutionProcessBlocks(blocks: RenderBlock[]): RenderBlockGroup[] {
  const groups: RenderBlockGroup[] = [];
  let execution: ExecutionProcessBlock[] = [];

  const flushExecution = () => {
    if (execution.length === 1) {
      groups.push({ type: 'content', block: execution[0] });
      execution = [];
      return;
    }
    if (execution.length > 1) {
      groups.push({ type: 'execution', blocks: execution });
      execution = [];
    }
  };

  for (const block of blocks) {
    if (block.type === 'tool' || block.type === 'thinking') {
      execution.push(block);
      continue;
    }
    flushExecution();
    groups.push({ type: 'content', block });
  }

  flushExecution();
  return groups;
}
