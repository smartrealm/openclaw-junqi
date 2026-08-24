export interface OpenClawCommandGroupPosition {
  readonly id: string;
  readonly top: number;
}

/** 根据分组标题相对路由视口的位置，解析当前应高亮的真实命令分组。 */
export function resolveOpenClawCommandScrollGroup(
  positions: readonly OpenClawCommandGroupPosition[],
  anchorTop: number,
  atScrollEnd: boolean,
): string | null {
  if (positions.length === 0) return null;
  if (atScrollEnd) return positions[positions.length - 1]?.id ?? null;

  let active: string | null = null;
  for (const position of positions) {
    if (position.top > anchorTop) break;
    active = position.id;
  }
  return active;
}

export function openClawCommandCategoryFromHash(hash: string): string | null {
  const category = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('category');
  return category?.trim() || null;
}

export function openClawCommandCategoryHash(category: string | null): string {
  return category ? `#category=${encodeURIComponent(category)}` : '';
}
