// ═══════════════════════════════════════════════════════════
// Workspace — kooky-style multi-pane tree.
//
// A Workspace is a recursive PaneNode tree. Each node is either a Leaf
// (a single terminal / agent session) or a Split (two children separated
// horizontally or vertically with a draggable divider).
//
// Layout math: at render time, the recursive renderer measures container
// size, then distributes each split's children via `sizes` (fractional,
// 0–1). Splitters write back new sizes via the store.
// ═══════════════════════════════════════════════════════════

/** What kind of content a leaf pane renders. */
export type LeafKind = 'shell' | 'agent';

/** Mirror of AgentRunView's local AgentType — duplicated here to avoid
 *  circular imports (AgentRunView imports from this file). */
export type AgentType = 'claude' | 'codex' | 'pi';

/** Configuration attached to a single pane leaf. */
export interface LeafConfig {
  /** Stable per-leaf id (UUID). */
  id: string;
  /** What this pane shows. */
  kind: LeafKind;
  /** For 'agent' leaves: which agent is launched. */
  agent?: AgentType;
  /** Initial cwd. Empty = home. */
  projectPath?: string;
  /** Display label shown in the tab. */
  label?: string;
  /** Optional session id (Claude/Codex JSONL file) to resume. */
  resumeId?: string;
}

/** Leaf node — a single terminal/agent pane. */
export interface PaneLeaf {
  type: 'leaf';
  id: string;
  config: LeafConfig;
}

/** Split direction. */
export type SplitDirection = 'horizontal' | 'vertical'; // horizontal = split side-by-side, vertical = top/bottom

/** Split node — two children with fractional sizes summing to 1. */
export interface PaneSplit {
  type: 'split';
  id: string;
  direction: SplitDirection;
  /** [a, b] fractions; sizes[0] + sizes[1] === 1. */
  sizes: [number, number];
  children: [PaneNode, PaneNode];
}

/** Discriminated union. */
export type PaneNode = PaneLeaf | PaneSplit;

/** Top-level workspace holding one root pane node. */
export interface Workspace {
  id: string;
  name: string;
  root: PaneNode;
  /** Currently focused pane id (used for keyboard routing). */
  focusedPaneId: string;
}

/** Helper: walk the tree to find the leaf matching id. */
export function findLeaf(root: PaneNode, leafId: string): PaneLeaf | null {
  if (root.type === 'leaf') return root.id === leafId ? root : null;
  return findLeaf(root.children[0], leafId) || findLeaf(root.children[1], leafId);
}

/** Generate a stable leaf id without pulling in crypto polyfills. */
export function newPaneId(): string {
  // crypto.randomUUID is available in modern webviews; fall back if missing.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Default leaf for new workspaces. */
export function defaultLeaf(kind: LeafKind = 'shell', label?: string): PaneLeaf {
  return {
    type: 'leaf',
    id: newPaneId(),
    config: {
      id: '',
      kind,
      label: label ?? (kind === 'shell' ? 'Shell' : 'Agent'),
      projectPath: '',
    },
  };
}

/** Build a fresh single-leaf workspace. */
export function newWorkspace(name = 'Workspace'): Workspace {
  const leaf = defaultLeaf();
  return {
    id: newPaneId(),
    name,
    root: leaf,
    focusedPaneId: leaf.id,
  };
}

/** Replace a leaf with another node by id. Returns true if replaced. */
export function replaceNode(root: PaneNode, leafId: string, replacement: PaneNode): PaneNode {
  if (root.id === leafId) return replacement;
  if (root.type === 'leaf') return root;
  const [a, b] = root.children;
  const newChildren: [PaneNode, PaneNode] = [
    replaceNode(a, leafId, replacement),
    replaceNode(b, leafId, replacement),
  ];
  return { ...root, children: newChildren };
}

/** Remove a leaf by id. If the sibling of the removed leaf becomes
 *  orphaned, the parent split collapses into that sibling (kooky pattern). */
export function removeLeaf(root: PaneNode, leafId: string): PaneNode | null {
  if (root.type === 'leaf') return root.id === leafId ? null : root;
  const [a, b] = root.children;
  if (a.id === leafId) return b;
  if (b.id === leafId) return a;
  const newA = removeLeaf(a, leafId);
  const newB = removeLeaf(b, leafId);
  if (newA === a && newB === b) return root;
  if (newA === null) return newB;
  if (newB === null) return newA;
  return { ...root, children: [newA!, newB!] };
}

/** Split a leaf horizontally or vertically, returning a new tree. */
export function splitLeaf(
  root: PaneNode,
  leafId: string,
  direction: SplitDirection,
  newLeafConfig: LeafConfig,
): PaneNode {
  const replacement: PaneSplit = {
    type: 'split',
    id: newPaneId(),
    direction,
    sizes: [0.5, 0.5],
    children: [
      // Sibling keeps the old leaf's identity by reusing its config.
      { type: 'leaf', id: root.id === leafId ? root.id : '', config: { ...(findLeaf(root, leafId)?.config ?? defaultLeaf().config) } },
      { type: 'leaf', id: newPaneId(), config: { ...newLeafConfig, id: newPaneId() } },
    ],
  };
  // Edge case: leafId points at the root itself and root is already a leaf —
  // reuse the existing leaf's config as the "kept" side instead of inserting
  // a default leaf.
  if (root.type === 'leaf' && root.id === leafId) {
    replacement.children[0] = root;
    replacement.children[1] = { type: 'leaf', id: newLeafConfig.id || newPaneId(), config: { ...newLeafConfig, id: newLeafConfig.id || newPaneId() } };
    return replacement;
  }
  return replaceNode(root, leafId, replacement);
}

/** Update sizes of a split by id. Clamps to [0.15, 0.85] per side. */
export function resizeSplit(root: PaneNode, splitId: string, ratio: number): PaneNode {
  if (root.type === 'leaf') return root;
  if (root.id === splitId) {
    const clamped = Math.max(0.15, Math.min(0.85, ratio));
    return { ...root, sizes: [clamped, 1 - clamped] };
  }
  const [a, b] = root.children;
  return { ...root, children: [resizeSplit(a, splitId, ratio), resizeSplit(b, splitId, ratio)] };
}

/** Walk all leaf ids in depth-first order. */
export function listLeafIds(root: PaneNode): string[] {
  if (root.type === 'leaf') return [root.id];
  return [...listLeafIds(root.children[0]), ...listLeafIds(root.children[1])];
}