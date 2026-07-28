import type { GitFileChange } from "./types";

export function filterGitChanges(
  changes: readonly GitFileChange[],
  query: string,
): GitFileChange[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...changes];
  return changes.filter((change) =>
    change.path.toLowerCase().includes(normalized),
  );
}
