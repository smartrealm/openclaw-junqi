// Workspace pane tree.
//
// The model deliberately keeps pane identity separate from pane metadata. A
// previous version stored a second `config.id`, which could diverge from the
// leaf id after nested splits and leave focus pointing at a pane that did not
// exist. Kooky uses one identity per pane; JunQi does the same here.

/** What kind of content a leaf pane renders. */
export type LeafKind = 'shell' | 'agent';

/** Mirror of AgentRunView's local AgentType to avoid a circular import. */
export type AgentType = 'claude' | 'codex' | 'pi';

/** Runtime-independent configuration attached to one pane. */
export interface LeafConfig {
  kind: LeafKind;
  agent?: AgentType;
  /** Last known working directory. Empty means the workspace fallback. */
  cwd?: string;
  /** User supplied display label. */
  label?: string;
  /** Optional agent session id to resume. */
  resumeId?: string;
}

export interface PaneLeaf {
  type: 'leaf';
  id: string;
  config: LeafConfig;
}

/** horizontal = side-by-side, vertical = top/bottom. */
export type SplitDirection = 'horizontal' | 'vertical';

export interface PaneSplit {
  type: 'split';
  id: string;
  direction: SplitDirection;
  /** Fractions sum to one. */
  sizes: [number, number];
  children: [PaneNode, PaneNode];
}

export type PaneNode = PaneLeaf | PaneSplit;

export interface Workspace {
  id: string;
  name: string;
  /** Project root / fallback cwd for new panes and sessions. */
  workingDirectory: string;
  root: PaneNode;
  /** Currently focused leaf id. */
  focusedPaneId: string;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeLeafKind(value: unknown): LeafKind {
  return value === 'agent' ? 'agent' : 'shell';
}

function normalizeAgentType(value: unknown): AgentType | undefined {
  return value === 'claude' || value === 'codex' || value === 'pi' ? value : undefined;
}

function normalizeSplitDirection(value: unknown): SplitDirection {
  return value === 'vertical' ? 'vertical' : 'horizontal';
}

function normalizeSizes(value: unknown): [number, number] {
  const first = Array.isArray(value) ? Number(value[0]) : Number.NaN;
  if (!Number.isFinite(first)) return [0.5, 0.5];
  const ratio = Math.max(0.15, Math.min(0.85, first));
  return [ratio, 1 - ratio];
}

function uniqueId(requested: unknown, used: Set<string>): string {
  let id = nonEmptyString(requested) ?? newPaneId();
  while (used.has(id)) id = newPaneId();
  used.add(id);
  return id;
}

/** Generate a stable id without requiring a polyfill in the Tauri webview. */
export function newPaneId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Create a pane leaf. Its id has exactly one source of truth. */
export function createLeaf(config: LeafConfig, id = newPaneId()): PaneLeaf {
  const kind = normalizeLeafKind(config.kind);
  const agent = kind === 'agent' ? normalizeAgentType(config.agent) : undefined;
  return {
    type: 'leaf',
    id,
    config: {
      kind,
      ...(agent ? { agent } : {}),
      ...(nonEmptyString(config.cwd) ? { cwd: nonEmptyString(config.cwd) } : {}),
      ...(nonEmptyString(config.label) ? { label: nonEmptyString(config.label) } : {}),
      ...(nonEmptyString(config.resumeId) ? { resumeId: nonEmptyString(config.resumeId) } : {}),
    },
  };
}

/** Default leaf for new workspaces and an empty split tree. */
export function defaultLeaf(kind: LeafKind = 'shell', label?: string, cwd = ''): PaneLeaf {
  return createLeaf({
    kind,
    label: label ?? (kind === 'shell' ? 'Shell' : 'Agent'),
    cwd,
  });
}

/** Build a fresh single-pane workspace. */
export function newWorkspace(name = 'Workspace', workingDirectory = ''): Workspace {
  const leaf = defaultLeaf('shell', undefined, workingDirectory);
  return {
    id: newPaneId(),
    name: nonEmptyString(name) ?? 'Workspace',
    workingDirectory: nonEmptyString(workingDirectory) ?? '',
    root: leaf,
    focusedPaneId: leaf.id,
  };
}

export function findLeaf(root: PaneNode, leafId: string): PaneLeaf | null {
  if (root.type === 'leaf') return root.id === leafId ? root : null;
  return findLeaf(root.children[0], leafId) ?? findLeaf(root.children[1], leafId);
}

export function listLeafIds(root: PaneNode): string[] {
  if (root.type === 'leaf') return [root.id];
  return [...listLeafIds(root.children[0]), ...listLeafIds(root.children[1])];
}

export function replaceNode(root: PaneNode, leafId: string, replacement: PaneNode): PaneNode {
  if (root.type === 'leaf') return root.id === leafId ? replacement : root;
  const first = replaceNode(root.children[0], leafId, replacement);
  const second = replaceNode(root.children[1], leafId, replacement);
  if (first === root.children[0] && second === root.children[1]) return root;
  return { ...root, children: [first, second] };
}

/** Apply a transform to every leaf without mutating persisted state. */
export function mapLeaves(root: PaneNode, transform: (leaf: PaneLeaf) => PaneLeaf): PaneNode {
  if (root.type === 'leaf') return transform(root);
  const first = mapLeaves(root.children[0], transform);
  const second = mapLeaves(root.children[1], transform);
  if (first === root.children[0] && second === root.children[1]) return root;
  return { ...root, children: [first, second] };
}

/**
 * Remove one leaf. Its sibling is promoted through the tree, matching Kooky's
 * pane collapse behaviour.
 */
export function removeLeaf(root: PaneNode, leafId: string): PaneNode | null {
  if (root.type === 'leaf') return root.id === leafId ? null : root;

  const first = removeLeaf(root.children[0], leafId);
  const second = removeLeaf(root.children[1], leafId);
  if (first === root.children[0] && second === root.children[1]) return root;
  if (first === null) return second;
  if (second === null) return first;
  return { ...root, children: [first, second] };
}

/**
 * Replace an existing leaf with a split that preserves the old leaf and adds
 * the supplied new leaf. The caller owns the new leaf id, so focus can never
 * target a separately-generated config id.
 */
export function splitLeaf(
  root: PaneNode,
  leafId: string,
  direction: SplitDirection,
  newLeaf: PaneLeaf,
): PaneNode {
  const existing = findLeaf(root, leafId);
  if (!existing) return root;
  return replaceNode(root, leafId, {
    type: 'split',
    id: newPaneId(),
    direction,
    sizes: [0.5, 0.5],
    children: [existing, newLeaf],
  });
}

/** Update one split ratio while preserving the rest of the tree. */
export function resizeSplit(root: PaneNode, splitId: string, ratio: number): PaneNode {
  if (root.type === 'leaf') return root;
  if (root.id === splitId) {
    const clamped = Math.max(0.15, Math.min(0.85, ratio));
    return { ...root, sizes: [clamped, 1 - clamped] };
  }
  const first = resizeSplit(root.children[0], splitId, ratio);
  const second = resizeSplit(root.children[1], splitId, ratio);
  if (first === root.children[0] && second === root.children[1]) return root;
  return { ...root, children: [first, second] };
}

function normalizeNode(
  value: unknown,
  fallbackCwd: string,
  usedIds: Set<string>,
  persistedLeafIds: Map<string, string>,
): PaneNode {
  const source = asRecord(value);
  if (source?.type === 'split' && Array.isArray(source.children) && source.children.length === 2) {
    return {
      type: 'split',
      id: uniqueId(source.id, usedIds),
      direction: normalizeSplitDirection(source.direction),
      sizes: normalizeSizes(source.sizes),
      children: [
        normalizeNode(source.children[0], fallbackCwd, usedIds, persistedLeafIds),
        normalizeNode(source.children[1], fallbackCwd, usedIds, persistedLeafIds),
      ],
    };
  }

  const config = asRecord(source?.config) ?? {};
  const kind = normalizeLeafKind(config.kind);
  const agent = kind === 'agent' ? normalizeAgentType(config.agent) : undefined;
  // `projectPath` is the pre-v2 persisted field. Read it once during
  // migration, then retain only `cwd` in the in-memory model.
  const cwd = nonEmptyString(config.cwd) ?? nonEmptyString(config.projectPath) ?? fallbackCwd;
  const persistedPaneId = nonEmptyString(source?.id);
  const id = uniqueId(persistedPaneId, usedIds);
  if (persistedPaneId && !persistedLeafIds.has(persistedPaneId)) {
    persistedLeafIds.set(persistedPaneId, id);
  }
  const legacyConfigId = nonEmptyString(config.id);
  if (legacyConfigId && !persistedLeafIds.has(legacyConfigId)) {
    persistedLeafIds.set(legacyConfigId, id);
  }
  return createLeaf({
    kind,
    ...(agent ? { agent } : {}),
    ...(cwd ? { cwd } : {}),
    ...(nonEmptyString(config.label) ? { label: nonEmptyString(config.label) } : {}),
    ...(nonEmptyString(config.resumeId) ? { resumeId: nonEmptyString(config.resumeId) } : {}),
  }, id);
}

/**
 * Normalize persisted data from every historical workspace shape. This is a
 * defensive boundary: no corrupted localStorage entry may leave focus pointing
 * at a split or a missing pane.
 */
function normalizeWorkspaceWithPaneIds(
  value: unknown,
  fallbackCwd: string,
  usedPaneIds: Set<string>,
): Workspace {
  const source = asRecord(value) ?? {};
  const persistedLeafIds = new Map<string, string>();
  const root = normalizeNode(source.root, fallbackCwd, usedPaneIds, persistedLeafIds);
  const leafIds = listLeafIds(root);
  const requestedFocus = nonEmptyString(source.focusedPaneId);
  const resolvedFocus = requestedFocus && (
    leafIds.includes(requestedFocus) ? requestedFocus : persistedLeafIds.get(requestedFocus)
  );
  const focusedPaneId = resolvedFocus && leafIds.includes(resolvedFocus)
    ? resolvedFocus
    : leafIds[0];
  const focusedLeaf = findLeaf(root, focusedPaneId);
  const firstLeaf = findLeaf(root, leafIds[0]);
  const workingDirectory = nonEmptyString(source.workingDirectory)
    ?? focusedLeaf?.config.cwd
    ?? firstLeaf?.config.cwd
    ?? nonEmptyString(fallbackCwd)
    ?? '';
  const hydratedRoot = mapLeaves(root, (leaf) => (
    leaf.config.cwd ? leaf : { ...leaf, config: { ...leaf.config, cwd: workingDirectory } }
  ));

  return {
    id: nonEmptyString(source.id) ?? newPaneId(),
    name: nonEmptyString(source.name) ?? 'Workspace',
    workingDirectory,
    root: hydratedRoot,
    focusedPaneId,
  };
}

export function normalizeWorkspace(value: unknown, fallbackCwd = ''): Workspace {
  return normalizeWorkspaceWithPaneIds(value, fallbackCwd, new Set());
}

/** Normalize a persisted workspace collection and de-duplicate workspace ids. */
export function normalizeWorkspaces(value: unknown, fallbackCwd = ''): Workspace[] {
  if (!Array.isArray(value)) return [];
  const usedWorkspaceIds = new Set<string>();
  const usedPaneIds = new Set<string>();
  return value.map((entry) => {
    const workspace = normalizeWorkspaceWithPaneIds(entry, fallbackCwd, usedPaneIds);
    workspace.id = uniqueId(workspace.id, usedWorkspaceIds);
    return workspace;
  });
}
