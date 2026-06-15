// Merge older history pages into an existing in-memory message list.
//
// The cursor-paginated history endpoint returns messages strictly older than
// the cursor, so the natural merge is "older on top". We dedupe by ID
// (existing wins on collision — pagination is the source of truth for old
// messages, but live arrivals can race with cursor fetches and should not be
// overwritten) and keep the final list sorted by timestamp ascending so
// downstream render code sees a stable order.
import type { ChatMessage } from '@/stores/chatStore';

export interface MergeResult {
  merged: ChatMessage[];
  addedCount: number;
}

/**
 * Prepend `incoming` older messages to `existing`. Dedupes by message ID —
 * if the same ID appears in both lists the existing entry is preserved
 * (live state wins over historical fetch). Returns the merged list sorted
 * ascending by timestamp.
 */
export function prependOlderMessages(
  existing: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): MergeResult {
  if (incoming.length === 0) {
    return { merged: [...existing], addedCount: 0 };
  }
  if (existing.length === 0) {
    return { merged: sortByTimestamp(incoming), addedCount: incoming.length };
  }

  const existingIds = new Set(existing.map((m) => m.id));
  const trulyNew = incoming.filter((m) => !existingIds.has(m.id));

  if (trulyNew.length === 0) {
    return { merged: [...existing], addedCount: 0 };
  }

  // Existing entries are kept in their original order; new older messages
  // are inserted at the front then re-sorted by timestamp. Sorting by
  // timestamp (not by insertion order) keeps the rendering monotonic even
  // if the server returns messages out of order across pages.
  const merged = sortByTimestamp([...trulyNew, ...existing]);
  return { merged, addedCount: trulyNew.length };
}

/** Sort messages ascending by ISO timestamp. Stable for equal timestamps. */
export function sortByTimestamp(messages: readonly ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => {
    const ta = Date.parse(a.timestamp);
    const tb = Date.parse(b.timestamp);
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return -1;
    if (Number.isNaN(tb)) return 1;
    return ta - tb;
  });
}
