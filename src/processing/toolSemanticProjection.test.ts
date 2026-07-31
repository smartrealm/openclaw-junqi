import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSemanticBlocks, projectSemanticBlocksToRenderBlocks } from './buildSemanticBlocks';
import { normalizeGatewayMessage } from './normalizeGatewayMessage';

test('projects failed tool metadata through semantic and render blocks without re-truncating output', () => {
  const normalized = normalizeGatewayMessage({
    id: 'tool-projection-error',
    sessionKey: 'agent:main:main',
    runId: 'run-tool-projection',
    role: 'tool',
    timestamp: 1_784_000_000_000,
    toolName: 'exec',
    toolCallId: 'call-tool-projection',
    toolInput: { command: 'pnpm test' },
    isError: true,
    error: 'permission denied',
    result: { detail: 'x'.repeat(2_400) },
  });
  const semanticBlocks = buildSemanticBlocks(normalized, { toolIntentEnabled: true });
  const semanticTool = semanticBlocks.find((block) => block.type === 'tool-activity');

  assert.ok(semanticTool && semanticTool.type === 'tool-activity');
  assert.equal(semanticTool.toolCallId, 'call-tool-projection');
  assert.equal(semanticTool.status, 'error');
  assert.equal(semanticTool.error, 'permission denied');
  assert.equal(semanticTool.outputTruncated, true);
  assert.ok((semanticTool.outputOriginalLength ?? 0) > (semanticTool.output?.length ?? 0));

  const renderTool = projectSemanticBlocksToRenderBlocks(semanticBlocks)
    .find((block) => block.type === 'tool');
  assert.ok(renderTool && renderTool.type === 'tool');
  assert.equal(renderTool.output, semanticTool.output);
  assert.equal(renderTool.outputOriginalLength, semanticTool.outputOriginalLength);
});

test('projects nested assistant tool call identities into tool activity blocks', () => {
  const normalized = normalizeGatewayMessage({
    id: 'assistant-nested-tool-call',
    sessionKey: 'agent:main:main',
    runId: 'run-nested-tool-call',
    role: 'assistant',
    timestamp: '2026-07-31T00:00:00.000Z',
    content: [{
      type: 'toolCall',
      id: 'call-nested-read',
      name: 'read',
      input: { path: 'README.md' },
    }],
  });
  const blocks = buildSemanticBlocks(normalized, { toolIntentEnabled: true });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.type, 'tool-activity');
  if (blocks[0]?.type === 'tool-activity') {
    assert.equal(blocks[0].toolCallId, 'call-nested-read');
    assert.deepEqual(blocks[0].input, { path: 'README.md' });
  }
});
