/**
 * Apply only the user's changes (original → current) over the latest disk
 * value. Unknown fields and concurrent external additions are preserved.
 * Arrays are atomic because their order and item identity are Runtime-owned.
 */
export function smartMerge(disk: unknown, original: unknown, current: unknown): unknown {
  if (disk === null || disk === undefined) return current;
  if (
    typeof disk !== 'object' ||
    typeof original !== 'object' ||
    typeof current !== 'object'
  ) {
    return JSON.stringify(original) !== JSON.stringify(current) ? current : disk;
  }

  if (Array.isArray(current) || Array.isArray(disk)) {
    return JSON.stringify(original) !== JSON.stringify(current) ? current : disk;
  }

  const diskRecord = disk as Record<string, unknown>;
  const originalRecord = (original ?? {}) as Record<string, unknown>;
  const currentRecord = current as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  const allKeys = new Set([
    ...Object.keys(diskRecord),
    ...Object.keys(currentRecord),
  ]);

  for (const key of allKeys) {
    const inDisk = key in diskRecord;
    const inOriginal = key in originalRecord;
    const inCurrent = key in currentRecord;

    if (inCurrent && !inOriginal && !inDisk) {
      result[key] = currentRecord[key];
    } else if (!inCurrent && inOriginal) {
      continue;
    } else if (inDisk && !inCurrent && !inOriginal) {
      result[key] = diskRecord[key];
    } else if (inCurrent && inDisk) {
      result[key] = smartMerge(diskRecord[key], originalRecord[key], currentRecord[key]);
    } else if (inCurrent) {
      result[key] = currentRecord[key];
    } else if (inDisk) {
      result[key] = diskRecord[key];
    }
  }

  return result;
}
