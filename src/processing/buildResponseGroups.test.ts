import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildResponseGroups,
  projectResponseGroupChrome,
  projectResponseGroupMessagePositions,
} from './buildResponseGroups';
import type {
  MessageSemanticBlock,
  SemanticBlock,
  ToolActivitySemanticBlock,
} from '@/types/SemanticBlock';

const SESSION_KEY = 'agent:main:desktop';

function message(
  id: string,
  role: 'user' | 'assistant',
  runId: string | null,
): MessageSemanticBlock {
  return {
    id,
    sessionKey: SESSION_KEY,
    runId,
    sourceMessageId: id,
    timestamp: '2026-07-22T00:00:00.000Z',
    isStreaming: false,
    responseState: 'final',
    type: 'message-content',
    role,
    markdown: id,
    artifacts: [],
    images: [],
  };
}

function tool(id: string, runId: string | null): ToolActivitySemanticBlock {
  return {
    id,
    sessionKey: SESSION_KEY,
    runId,
    sourceMessageId: id,
    timestamp: '2026-07-22T00:00:01.000Z',
    isStreaming: false,
    responseState: 'final',
    type: 'tool-activity',
    toolName: 'read',
    status: 'done',
  };
}

test('groups one run without collapsing its text and tool segments', () => {
  const blocks: SemanticBlock[] = [
    message('assistant-before', 'assistant', 'run-1'),
    tool('tool-result', 'run-1'),
    message('assistant-after', 'assistant', 'run-1'),
  ];

  const groups = buildResponseGroups(blocks);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].blocks.map((block) => block.id), [
    'assistant-before',
    'tool-result',
    'assistant-after',
  ]);
  assert.deepEqual(
    [...projectResponseGroupMessagePositions(groups[0])],
    [['assistant-before', 'first'], ['assistant-after', 'last']],
  );
});

test('uses user messages as boundaries for historical rows without run ids', () => {
  const groups = buildResponseGroups([
    message('user-1', 'user', null),
    message('assistant-before', 'assistant', null),
    tool('tool-result', null),
    message('assistant-after', 'assistant', null),
    message('user-2', 'user', null),
    message('assistant-next', 'assistant', null),
  ]);

  assert.deepEqual(groups.map((group) => group.role), [
    'user',
    'assistant',
    'user',
    'assistant',
  ]);
  assert.deepEqual(groups[1].blocks.map((block) => block.id), [
    'assistant-before',
    'tool-result',
    'assistant-after',
  ]);
});

test('does not merge adjacent responses from different runs', () => {
  const groups = buildResponseGroups([
    message('assistant-1', 'assistant', 'run-1'),
    message('assistant-2', 'assistant', 'run-2'),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(projectResponseGroupMessagePositions(groups[0]).get('assistant-1'), 'standalone');
  assert.equal(projectResponseGroupMessagePositions(groups[1]).get('assistant-2'), 'standalone');
});

test('assistant response owns chrome even when it contains only structured blocks', () => {
  const [group] = buildResponseGroups([tool('tool-only', 'run-1')]);

  assert.deepEqual(projectResponseGroupChrome(group), {
    owner: 'group',
    representativeMessageId: null,
  });
});

test('assistant response selects its last message segment as footer metadata source', () => {
  const [group] = buildResponseGroups([
    message('assistant-before', 'assistant', 'run-1'),
    tool('tool-result', 'run-1'),
    message('assistant-after', 'assistant', 'run-1'),
    tool('tool-final', 'run-1'),
  ]);

  assert.deepEqual(projectResponseGroupChrome(group), {
    owner: 'group',
    representativeMessageId: 'assistant-after',
  });
});
