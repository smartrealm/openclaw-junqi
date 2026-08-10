export interface OpenClawConfigPatchPlan {
  patch: Record<string, unknown>;
  replacePaths: string[];
}

type PatchValue = { changed: false } | { changed: true; value: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isIdEntry(value: unknown): value is Record<string, unknown> & { id: string } {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0;
}

function buildArrayPatch(
  original: unknown[],
  current: unknown[],
  path: string,
  replacePaths: Set<string>,
): PatchValue {
  if (valuesEqual(original, current)) return { changed: false };
  if (!original.every(isIdEntry) || !current.every(isIdEntry)) {
    replacePaths.add(path);
    return { changed: true, value: structuredClone(current) };
  }

  const originalById = new Map(original.map((entry) => [entry.id, entry]));
  const currentIds = current.map((entry) => entry.id);
  const originalIds = original.map((entry) => entry.id);
  const hasRemoval = originalIds.some((id) => !currentIds.includes(id));
  const originalOrder = originalIds.filter((id) => currentIds.includes(id));
  const currentOrder = currentIds.filter((id) => originalById.has(id));
  const appendedIds = currentIds.filter((id) => !originalById.has(id));
  const gatewayMergeOrder = [...originalOrder, ...appendedIds];
  if (hasRemoval || !valuesEqual(originalOrder, currentOrder) || !valuesEqual(gatewayMergeOrder, currentIds)) {
    replacePaths.add(path);
    return { changed: true, value: structuredClone(current) };
  }

  const entries: unknown[] = [];
  for (const entry of current) {
    const previous = originalById.get(entry.id);
    if (!previous) {
      entries.push(structuredClone(entry));
      continue;
    }
    const next = buildPatchValue(previous, entry, `${path}[]`, replacePaths);
    if (next.changed && isRecord(next.value)) {
      entries.push({ id: entry.id, ...next.value });
    }
  }
  return entries.length > 0 ? { changed: true, value: entries } : { changed: false };
}

function buildPatchValue(
  original: unknown,
  current: unknown,
  path: string,
  replacePaths: Set<string>,
): PatchValue {
  if (valuesEqual(original, current)) return { changed: false };
  if (Array.isArray(original) && Array.isArray(current)) {
    return buildArrayPatch(original, current, path, replacePaths);
  }
  if (!isRecord(original) || !isRecord(current)) {
    return { changed: true, value: structuredClone(current) };
  }

  const patch: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(original), ...Object.keys(current)])) {
    const childPath = path ? `${path}.${key}` : key;
    if (!hasOwn(current, key)) {
      patch[key] = null;
      continue;
    }
    if (!hasOwn(original, key)) {
      patch[key] = structuredClone(current[key]);
      continue;
    }
    const child = buildPatchValue(original[key], current[key], childPath, replacePaths);
    if (child.changed) patch[key] = child.value;
  }
  return Object.keys(patch).length > 0 ? { changed: true, value: patch } : { changed: false };
}

/** 以官方 config.patch 语义生成最小补丁和显式数组替换路径。 */
export function buildOpenClawConfigPatch(
  original: Record<string, unknown>,
  current: Record<string, unknown>,
): OpenClawConfigPatchPlan {
  const replacePaths = new Set<string>();
  const result = buildPatchValue(original, current, '', replacePaths);
  return {
    patch: result.changed && isRecord(result.value) ? result.value : {},
    replacePaths: [...replacePaths],
  };
}
