import type { ResponseGroup } from '@/types/ResponseGroup';
import type { SemanticBlock } from '@/types/SemanticBlock';

export type ResponseGroupMessagePosition = 'standalone' | 'first' | 'middle' | 'last';

export type ResponseGroupChromeProjection =
  | { owner: 'group'; representativeMessageId: string | null }
  | { owner: 'message'; representativeMessageId: null };

function inferGroupRole(block: SemanticBlock): ResponseGroup['role'] {
  switch (block.type) {
    case 'message-content':
      return block.role;
    case 'compaction':
      return 'system';
    default:
      return 'assistant';
  }
}

function inferGroupStatus(blocks: SemanticBlock[]): ResponseGroup['status'] {
  if (blocks.some((block) => block.responseState === 'error')) return 'error';
  if (blocks.some((block) => block.responseState === 'aborted')) return 'aborted';
  return blocks.some((block) => block.isStreaming || block.responseState === 'streaming')
    ? 'streaming'
    : 'final';
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function buildIdentity(block: SemanticBlock): string {
  if (block.type === 'compaction') return `compaction:${block.sourceMessageId}`;
  const role = inferGroupRole(block);
  if (role === 'user') return `user:${block.sourceMessageId}`;
  if (role === 'system') return `system:${block.sourceMessageId}`;
  if (block.runId) return `run:${block.runId}`;
  return `message:${block.sourceMessageId}`;
}

function createGroup(block: SemanticBlock): ResponseGroup {
  const startedAt = parseTimestamp(block.timestamp);
  const status = inferGroupStatus([block]);
  return {
    id: `group:${block.sessionKey}:${buildIdentity(block)}`,
    sessionKey: block.sessionKey,
    runId: block.runId ?? null,
    role: inferGroupRole(block),
    timestamp: block.timestamp,
    status,
    startedAt,
    ...(status === 'streaming' ? {} : { completedAt: startedAt }),
    sourceMessageIds: [block.sourceMessageId],
    blocks: [block],
  };
}

function canAppend(last: ResponseGroup | null, block: SemanticBlock): boolean {
  if (!last) return false;
  if (block.type === 'compaction') return false;
  if (last.sessionKey !== block.sessionKey) return false;

  if (last.id === `group:${block.sessionKey}:${buildIdentity(block)}`) {
    return true;
  }

  // Historical rows do not always carry a run id. A user row is the durable
  // turn boundary in that representation, so adjacent assistant-side rows
  // belong to the same response until another user/system group starts.
  return last.role === 'assistant'
    && inferGroupRole(block) === 'assistant'
    && !last.runId
    && !block.runId;
}

export function buildResponseGroups(blocks: SemanticBlock[]): ResponseGroup[] {
  const groups: ResponseGroup[] = [];

  for (const block of blocks) {
    const last = groups[groups.length - 1] ?? null;
    if (canAppend(last, block)) {
      last.blocks.push(block);
      if (!last.sourceMessageIds.includes(block.sourceMessageId)) {
        last.sourceMessageIds.push(block.sourceMessageId);
      }
      last.status = inferGroupStatus(last.blocks);
      if (last.status !== 'streaming') {
        last.completedAt = Math.max(...last.blocks.map((item) => parseTimestamp(item.timestamp)));
      } else {
        delete last.completedAt;
      }
    } else {
      groups.push(createGroup(block));
    }
  }

  return groups;
}

export function projectResponseGroupMessagePositions(
  group: ResponseGroup,
): ReadonlyMap<string, ResponseGroupMessagePosition> {
  const messageIds = group.blocks
    .filter((block) => block.type === 'message-content')
    .map((block) => block.id);
  const positions = new Map<string, ResponseGroupMessagePosition>();

  if (messageIds.length === 1) {
    positions.set(messageIds[0], 'standalone');
    return positions;
  }

  messageIds.forEach((id, index) => {
    positions.set(
      id,
      index === 0 ? 'first' : index === messageIds.length - 1 ? 'last' : 'middle',
    );
  });

  return positions;
}

/**
 * Assistant chrome belongs to the response, not to an individual text block.
 * This keeps one avatar and one trailing footer even when a response ends in a
 * tool/result block or contains no message-content block at all.
 */
export function projectResponseGroupChrome(
  group: ResponseGroup,
): ResponseGroupChromeProjection {
  if (group.role !== 'assistant') {
    return { owner: 'message', representativeMessageId: null };
  }

  const representative = [...group.blocks]
    .reverse()
    .find((block) => block.type === 'message-content' && block.role === 'assistant');
  return {
    owner: 'group',
    representativeMessageId: representative?.id ?? null,
  };
}
