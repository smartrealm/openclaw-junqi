import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeGatewayToolLifecycleEvent,
  projectToolOutput,
  TOOL_OUTPUT_DISPLAY_LIMIT,
} from './toolExecutionProjection';

test('normalizes an official tool result with an error, object output, and epoch timestamp', () => {
  const epochMilliseconds = 1_784_000_000_123;
  const event = normalizeGatewayToolLifecycleEvent({
    sessionKey: 'agent:main:main',
    runId: 'run-tool-error',
    seq: 12,
    stream: 'tool',
    ts: epochMilliseconds,
    data: {
      phase: 'result',
      name: 'exec',
      toolCallId: 'call-tool-error',
      isError: true,
      toolErrorSummary: 'permission denied',
      result: { exitCode: 1, stderr: 'permission denied' },
    },
  });

  assert.ok(event);
  assert.equal(event.phase, 'result');
  assert.equal(event.toolCallId, 'call-tool-error');
  assert.equal(event.status, 'error');
  assert.equal(event.isError, true);
  assert.equal(event.error, 'permission denied');
  assert.equal(event.timestamp, new Date(epochMilliseconds).toISOString());
  assert.deepEqual(event.output, { exitCode: 1, stderr: 'permission denied' });
});

test('normalizes a failed item lifecycle and derives its tool identity and duration', () => {
  const event = normalizeGatewayToolLifecycleEvent({
    sessionKey: 'agent:main:main',
    runId: 'run-item-error',
    seq: 13,
    stream: 'item',
    ts: 1_784_000_001_000,
    data: {
      kind: 'tool',
      phase: 'end',
      itemId: 'tool:call-item-error',
      name: 'read',
      toolArgs: { path: 'workspace/notes.md' },
      status: 'failed',
      error: 'workspace path unavailable',
      startedAt: 1_784_000_000_000,
      endedAt: 1_784_000_000_500,
    },
  }, 'item');

  assert.ok(event);
  assert.equal(event.phase, 'result');
  assert.equal(event.toolCallId, 'call-item-error');
  assert.equal(event.status, 'error');
  assert.equal(event.error, 'workspace path unavailable');
  assert.deepEqual(event.input, { path: 'workspace/notes.md' });
  assert.equal(event.durationMs, 500);
  assert.equal(event.timestamp, new Date(1_784_000_000_500).toISOString());
});

test('projects structured output once while preserving truncation metadata', () => {
  const output = projectToolOutput({ detail: 'x'.repeat(TOOL_OUTPUT_DISPLAY_LIMIT + 20) });

  assert.ok(output);
  assert.equal(output.truncated, true);
  assert.ok(output.originalLength > TOOL_OUTPUT_DISPLAY_LIMIT);
  assert.equal(output.text.length, TOOL_OUTPUT_DISPLAY_LIMIT);
});
