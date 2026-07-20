import assert from 'node:assert/strict';
import test from 'node:test';
import { groupExecutionProcessBlocks } from './executionProcessGrouping';
import type { RenderBlock } from '@/types/RenderBlock';

const base = { timestamp: '2026-07-21T00:00:00.000Z', isStreaming: false };

function tool(id: string): RenderBlock {
  return { ...base, id, type: 'tool', toolName: 'exec', status: 'done' };
}

function thinking(id: string): RenderBlock {
  return { ...base, id, type: 'thinking', content: 'reasoning' };
}

function message(id: string): RenderBlock {
  return {
    ...base,
    id,
    type: 'message',
    role: 'assistant',
    markdown: 'done',
    artifacts: [],
    images: [],
  };
}

test('groups only adjacent execution blocks and preserves order', () => {
  const groups = groupExecutionProcessBlocks([tool('tool-1'), thinking('think-1'), message('message-1'), tool('tool-2')]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0]?.type, 'execution');
  assert.deepEqual(groups[0]?.type === 'execution' ? groups[0].blocks.map((block) => block.id) : [], ['tool-1', 'think-1']);
  assert.equal(groups[1]?.type, 'content');
  assert.equal(groups[1]?.type === 'content' ? groups[1].block.id : '', 'message-1');
  assert.equal(groups[2]?.type, 'content');
  assert.equal(groups[2]?.type === 'content' ? groups[2].block.id : '', 'tool-2');
});

test('does not emit empty execution groups', () => {
  const groups = groupExecutionProcessBlocks([message('message-1')]);
  assert.deepEqual(groups.map((group) => group.type), ['content']);
});

test('keeps a single tool as its existing inline tool row', () => {
  const groups = groupExecutionProcessBlocks([tool('tool-1')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.type, 'content');
  assert.equal(groups[0]?.type === 'content' ? groups[0].block.id : '', 'tool-1');
});
