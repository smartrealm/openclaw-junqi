export interface HistoryPageMetadata {
  hasMore: boolean;
  nextOffset?: number;
}

export function resolveHistoryPageMetadata(
  value: unknown,
  requestedOffset: number,
): HistoryPageMetadata {
  const result = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const nextOffset = typeof result.nextOffset === 'number'
    && Number.isSafeInteger(result.nextOffset)
    && result.nextOffset > requestedOffset
    ? result.nextOffset
    : undefined;
  return {
    hasMore: result.hasMore === true && nextOffset !== undefined,
    ...(nextOffset !== undefined ? { nextOffset } : {}),
  };
}
