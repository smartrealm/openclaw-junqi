import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSemanticBlocks } from '@/processing/buildSemanticBlocks';
import { buildResponseGroups } from '@/processing/buildResponseGroups';
import { normalizeGatewayMessage } from '@/processing/normalizeGatewayMessage';
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
  assert.deepEqual(trace.review, {
    status: 'requested',
    recording: 'transcript-only',
    requestCount: 1,
  });
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
