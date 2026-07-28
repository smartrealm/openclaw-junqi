import type { TabGroupId, TabGroupLayoutNode } from './types';

export const MIN_SPLIT_RATIO = 0.15;
export const MAX_SPLIT_RATIO = 0.85;

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

export function listTabGroupIds(node: TabGroupLayoutNode): TabGroupId[] {
  return node.type === 'group'
    ? [node.groupId]
    : [...listTabGroupIds(node.first), ...listTabGroupIds(node.second)];
}

export function splitTabGroup(
  node: TabGroupLayoutNode,
  targetGroupId: TabGroupId,
  splitId: string,
  newGroupId: TabGroupId,
  direction: 'horizontal' | 'vertical',
  placement: 'before' | 'after' = 'after',
): TabGroupLayoutNode {
  if (node.type === 'group') {
    if (node.groupId !== targetGroupId) return node;
    const added: TabGroupLayoutNode = { type: 'group', groupId: newGroupId };
    return {
      type: 'split',
      id: splitId,
      direction,
      ratio: 0.5,
      first: placement === 'before' ? added : node,
      second: placement === 'before' ? node : added,
    };
  }
  const first = splitTabGroup(node.first, targetGroupId, splitId, newGroupId, direction, placement);
  if (first !== node.first) return { ...node, first };
  const second = splitTabGroup(node.second, targetGroupId, splitId, newGroupId, direction, placement);
  return second === node.second ? node : { ...node, second };
}

export function removeTabGroup(node: TabGroupLayoutNode, groupId: TabGroupId): TabGroupLayoutNode | null {
  if (node.type === 'group') return node.groupId === groupId ? null : node;
  const first = removeTabGroup(node.first, groupId);
  const second = removeTabGroup(node.second, groupId);
  if (!first) return second;
  if (!second) return first;
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function resizeTabGroupSplit(node: TabGroupLayoutNode, splitId: string, ratio: number): TabGroupLayoutNode {
  if (node.type === 'group') return node;
  if (node.id === splitId) return { ...node, ratio: clampSplitRatio(ratio) };
  const first = resizeTabGroupSplit(node.first, splitId, ratio);
  const second = resizeTabGroupSplit(node.second, splitId, ratio);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}
