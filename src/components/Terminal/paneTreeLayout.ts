import type { PaneNode, PaneSplit } from '@/workspace/types';

export type ZoomedSplitBranch = 'first' | 'second' | null;

export interface PaneSplitLayout {
  firstFlex: number;
  secondFlex: number;
  firstVisible: boolean;
  secondVisible: boolean;
  splitterVisible: boolean;
}

export function paneNodeContains(node: PaneNode, paneId: string): boolean {
  if (node.type === 'leaf') return node.id === paneId;
  return paneNodeContains(node.children[0], paneId)
    || paneNodeContains(node.children[1], paneId);
}

/** Return the direct child branch that contains the zoomed pane. */
export function zoomedBranchForSplit(
  node: PaneSplit,
  zoomedPaneId: string | null,
): ZoomedSplitBranch {
  if (!zoomedPaneId) return null;
  if (paneNodeContains(node.children[0], zoomedPaneId)) return 'first';
  if (paneNodeContains(node.children[1], zoomedPaneId)) return 'second';
  return null;
}

export function resolvePaneSplitLayout(
  node: PaneSplit,
  zoomedPaneId: string | null,
  firstFraction = node.sizes[0],
): PaneSplitLayout {
  const zoomedBranch = zoomedBranchForSplit(node, zoomedPaneId);
  if (zoomedBranch === 'first') {
    return {
      firstFlex: 1,
      secondFlex: 0,
      firstVisible: true,
      // Keep the terminal mounted through the transition. Removing it causes
      // xterm to lose its measured container and makes restoring look like a
      // fresh render rather than Kooky's push-out animation.
      secondVisible: true,
      splitterVisible: false,
    };
  }
  if (zoomedBranch === 'second') {
    return {
      firstFlex: 0,
      secondFlex: 1,
      firstVisible: true,
      secondVisible: true,
      splitterVisible: false,
    };
  }
  return {
    firstFlex: firstFraction,
    secondFlex: 1 - firstFraction,
    firstVisible: true,
    secondVisible: true,
    splitterVisible: true,
  };
}
