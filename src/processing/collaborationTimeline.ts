import type { CollaborationRunSummary } from '@/services/collaboration/types';
import type { ChatMessage } from '@/stores/chatStore';
import type { ResponseGroup } from '@/types/ResponseGroup';

export type ChatTimelineItem =
  | { type: 'response'; id: string; group: ResponseGroup }
  | { type: 'collaboration'; id: string; runId: string };

export interface CollaborationTimelineProjection {
  timelineItems: ChatTimelineItem[];
  anchoredRunIds: Set<string>;
}

export function buildCollaborationChatTimeline(
  responseGroups: ResponseGroup[],
  messages: ChatMessage[],
  runs: CollaborationRunSummary[],
): CollaborationTimelineProjection {
  const runsByDisplayMessageId = new Map<string, CollaborationRunSummary[]>();
  for (const run of [...runs].sort((left, right) => left.createdAt - right.createdAt)) {
    const message = messages.find((candidate) =>
      (candidate.nativeMessageId && candidate.nativeMessageId === run.origin.nativeMessageId)
      || (candidate.clientMessageId && candidate.clientMessageId === run.origin.clientMessageId));
    if (!message) continue;
    const matches = runsByDisplayMessageId.get(message.id) ?? [];
    matches.push(run);
    runsByDisplayMessageId.set(message.id, matches);
  }

  const anchoredRunIds = new Set<string>();
  const timelineItems: ChatTimelineItem[] = [];
  for (const group of responseGroups) {
    timelineItems.push({ type: 'response', id: `response:${group.id}`, group });
    for (const sourceMessageId of group.sourceMessageIds) {
      for (const run of runsByDisplayMessageId.get(sourceMessageId) ?? []) {
        if (anchoredRunIds.has(run.runId)) continue;
        anchoredRunIds.add(run.runId);
        timelineItems.push({
          type: 'collaboration',
          id: `collaboration:${run.runId}`,
          runId: run.runId,
        });
      }
    }
  }
  return { timelineItems, anchoredRunIds };
}
