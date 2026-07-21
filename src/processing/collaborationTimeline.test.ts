import assert from 'node:assert/strict';
import test from 'node:test';
import type { CollaborationRunSummary } from '@/services/collaboration/types';
import type { ChatMessage } from '@/stores/chatStore';
import type { ResponseGroup } from '@/types/ResponseGroup';
import { buildCollaborationChatTimeline } from './collaborationTimeline';

function run(overrides: Partial<CollaborationRunSummary> = {}): CollaborationRunSummary {
  return {
    runId: 'run-1',
    status: 'RUNNING',
    dispatchState: 'OPEN',
    archiveState: 'ACTIVE',
    reconcileState: 'IDLE',
    completionOutcome: null,
    revision: 1,
    lastEventSequence: 1,
    goal: 'Check the task',
    origin: {
      runtimeId: 'instance-1',
      agentId: 'main',
      sessionKey: 'agent:main:main',
      sessionId: 'session-1',
      nativeMessageId: 'native-1',
      clientMessageId: 'client-1',
    },
    currentPlanRevisionId: null,
    allowedActions: ['CANCEL'],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const message: ChatMessage = {
  id: 'display-1',
  clientMessageId: 'client-1',
  nativeMessageId: 'native-1',
  role: 'user',
  content: 'Check the task',
  timestamp: '2026-07-16T00:00:00.000Z',
};

const group: ResponseGroup = {
  id: 'group-1',
  sessionKey: 'agent:main:main',
  role: 'user',
  timestamp: message.timestamp,
  status: 'final',
  startedAt: 1,
  sourceMessageIds: ['display-1'],
  blocks: [],
};

test('places a collaboration anchor immediately after its origin response group', () => {
  const projection = buildCollaborationChatTimeline([group], [message], [run()]);
  assert.deepEqual(
    projection.timelineItems.map((item) => [item.type, item.id]),
    [
      ['response', 'response:group-1'],
      ['collaboration', 'collaboration:run-1'],
    ],
  );
  assert.deepEqual([...projection.anchoredRunIds], ['run-1']);
});

test('keeps a run unanchored when the origin message is outside loaded history', () => {
  const projection = buildCollaborationChatTimeline([group], [], [run()]);
  assert.equal(projection.timelineItems.length, 1);
  assert.equal(projection.timelineItems[0]?.type, 'response');
  assert.equal(projection.anchoredRunIds.size, 0);
});

test('client identity anchors an optimistic message before native reconciliation', () => {
  const optimistic = { ...message, nativeMessageId: undefined };
  const projection = buildCollaborationChatTimeline([group], [optimistic], [run()]);
  assert.equal(projection.timelineItems[1]?.type, 'collaboration');
});
