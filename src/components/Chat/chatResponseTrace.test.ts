import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSemanticBlocks } from '@/processing/buildSemanticBlocks';
import { buildResponseGroups } from '@/processing/buildResponseGroups';
import { normalizeGatewayMessage } from '@/processing/normalizeGatewayMessage';
import type { ResponseGroup } from '@/types/ResponseGroup';
import { findTraceSourceMessage, projectChatResponseTrace } from './chatResponseTrace';

function blocks(message: Record<string, unknown>) {
  return buildSemanticBlocks(normalizeGatewayMessage({
    sessionKey: 'agent:main:main',
    runId: 'run-trace',
    timestamp: '2026-07-31T00:00:00.000Z',
    ...message,
  }), { toolIntentEnabled: true });
}

test('projects every structured response node in transcript order with upstream identities', () => {
  const semanticBlocks = [
    ...blocks({
      id: 'plan-1',
      role: 'tool',
      toolCallId: 'call-plan-1',
      toolName: 'update_plan',
      toolInput: { plan: [{ step: 'Inspect', status: 'in_progress' }] },
      toolStatus: 'done',
      nativeSequence: 10,
    }),
    ...blocks({
      id: 'tool-1',
      role: 'tool',
      toolCallId: 'call-exec-1',
      toolName: 'exec',
      toolInput: { command: 'pnpm test' },
      toolOutput: 'passed',
      toolStatus: 'done',
      nativeSequence: 11,
    }),
    ...blocks({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Choose the next action.',
      decisionOptions: [{ text: 'Continue', value: 'continue' }],
      nativeSequence: 12,
    }),
  ];
  const groups = buildResponseGroups(semanticBlocks);
  assert.equal(groups.length, 1);

  const trace = projectChatResponseTrace(groups[0]);
  assert.equal(trace.authority, 'openclaw-run');
  assert.equal(trace.runId, 'run-trace');
  assert.deepEqual(trace.nodes.map((node) => node.kind), [
    'plan',
    'tool',
    'message',
    'review-request',
  ]);
  assert.equal(trace.nodes[0]?.sourceSequence, 10);
  assert.equal(trace.nodes[1]?.kind === 'tool' ? trace.nodes[1].toolCallId : null, 'call-exec-1');
  assert.deepEqual(trace.nodes[2]?.kind === 'message' ? trace.nodes[2].context : null, undefined);
  assert.deepEqual(trace.review, {
    status: 'requested',
    recording: 'transcript-only',
    requestCount: 1,
  });
});

test('projects only bounded response usage metadata into the message node', () => {
  const semanticBlocks = blocks({
    id: 'assistant-with-usage',
    role: 'assistant',
    content: 'Usage is available.',
    model: 'openai/gpt-5',
    usage: { input: 120, output: 42, cacheRead: 10 },
  });
  const messageNode = projectChatResponseTrace(buildResponseGroups(semanticBlocks)[0]).nodes
    .find((node) => node.kind === 'message');
  assert.deepEqual(messageNode?.kind === 'message' ? messageNode.context : null, {
    input: 120,
    output: 42,
    cacheRead: 10,
    model: 'openai/gpt-5',
  });
});

test('fails closed when context metadata is malformed', () => {
  const group = {
    id: 'group:malformed-context',
    sessionKey: 'agent:main:main',
    runId: 'run-malformed-context',
    role: 'assistant',
    timestamp: '2026-07-31T00:00:00.000Z',
    status: 'final',
    startedAt: Date.parse('2026-07-31T00:00:00.000Z'),
    sourceMessageIds: ['assistant-malformed-context'],
    blocks: [{
      id: 'assistant-malformed-context',
      sessionKey: 'agent:main:main',
      runId: 'run-malformed-context',
      sourceMessageId: 'assistant-malformed-context',
      timestamp: '2026-07-31T00:00:00.000Z',
      isStreaming: false,
      responseState: 'final',
      type: 'message-content',
      role: 'assistant',
      markdown: 'Still visible.',
      artifacts: [],
      images: [],
      meta: [{ kind: 'context', label: 'Context', content: '{not-json' }],
    }],
  } satisfies ResponseGroup;
  const messageNode = projectChatResponseTrace(group).nodes[0];
  assert.equal(messageNode?.kind, 'message');
  assert.equal(messageNode?.kind === 'message' ? messageNode.context : null, undefined);
});

test('does not invent run or human-review records when upstream omitted them', () => {
  const semanticBlocks = blocks({
    id: 'assistant-without-run',
    runId: null,
    role: 'assistant',
    content: 'Completed.',
  });
  const trace = projectChatResponseTrace(buildResponseGroups(semanticBlocks)[0]);

  assert.equal(trace.authority, 'gateway-transcript');
  assert.equal(trace.runId, null);
  assert.deepEqual(trace.review, {
    status: 'not-requested',
    recording: 'none',
    requestCount: 0,
  });
});

test('keeps the upstream compaction event in the structured trace', () => {
  const semanticBlocks = blocks({
    id: 'compaction-1',
    role: 'compaction',
    runId: 'run-trace',
  });
  const trace = projectChatResponseTrace(buildResponseGroups(semanticBlocks)[0]);

  assert.deepEqual(trace.nodes.map((node) => node.kind), ['compaction']);
});

test('exposes a formal review relation only when the transcript explicitly provides one', () => {
  const semanticBlocks = blocks({
    id: 'assistant-formal-review',
    role: 'assistant',
    content: 'Approval required.',
    decisionOptions: [{ text: 'Approve', value: 'approve' }],
    formalReviewId: 'review-42',
  });
  const trace = projectChatResponseTrace(buildResponseGroups(semanticBlocks)[0]);

  assert.equal(trace.review.status, 'requested');
  assert.equal(trace.review.formalReviewId, 'review-42');
});

test('source-record drilldown only resolves an already loaded transcript identity', () => {
  const nativeMessage = {
    id: 'display-message-1',
    nativeMessageId: 'gateway-message-1',
    role: 'assistant' as const,
    content: 'Gateway-provided response.',
    timestamp: '2026-07-31T00:00:00.000Z',
  };
  const localMessage = {
    id: 'local-message-1',
    role: 'user' as const,
    content: 'Pending message.',
    timestamp: '2026-07-31T00:00:01.000Z',
  };

  assert.equal(findTraceSourceMessage([nativeMessage, localMessage], 'gateway-message-1'), nativeMessage);
  assert.equal(findTraceSourceMessage([nativeMessage, localMessage], 'local-message-1'), localMessage);
  assert.equal(findTraceSourceMessage([nativeMessage, localMessage], 'missing-gateway-message'), undefined);
});

test('keeps the Gateway compaction divider in the response trace timeline', () => {
  const semanticBlocks = blocks({
    id: 'compaction-1',
    role: 'compaction',
    content: '',
    nativeSequence: 20,
  });
  const group = buildResponseGroups(semanticBlocks)[0];
  assert.equal(group?.role, 'system');
  assert.deepEqual(projectChatResponseTrace(group).nodes.map((node) => ({
    kind: node.kind,
    sourceMessageId: node.sourceMessageId,
    sourceSequence: node.sourceSequence,
  })), [{
    kind: 'compaction',
    sourceMessageId: 'compaction-1',
    sourceSequence: 20,
  }]);
});
