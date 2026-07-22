import type { ResponseGroup } from '@/types/ResponseGroup';

/** Return only the response groups produced after the latest user turn. */
export function projectQuickChatResponseGroups(
  groups: readonly ResponseGroup[],
): ResponseGroup[] {
  const lastGroup = groups[groups.length - 1];
  if (!lastGroup) return [];

  let lastUserIndex = -1;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    if (groups[index].role === 'user') {
      lastUserIndex = index;
      break;
    }
  }

  if (lastUserIndex >= 0) {
    return groups.slice(lastUserIndex + 1).filter((group) => group.role !== 'user');
  }
  return lastGroup.role === 'user' ? [] : [lastGroup];
}
