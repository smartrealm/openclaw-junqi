// ═══════════════════════════════════════════════════════════
// FileExplorer — tree utilities
// ═══════════════════════════════════════════════════════════

import type { FsEntry, TreeNode, CreateKind, FlatEntry, FlatInputRow, FlatRow } from "./types";

export function pathSeparator(p: string): string {
  return p.includes("\\") ? "\\" : "/";
}

export function parentPathOf(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(0, idx) : p;
}

export function joinPath(parent: string, child: string): string {
  if (parent.endsWith("/") || parent.endsWith("\\")) return parent + child;
  return parent + pathSeparator(parent) + child;
}

/**
 * Find a node in the tree by path, depth-first.
 */
export function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Convert a flat FsEntry list into TreeNode list.
 */
export function entriesToNodes(
  entries: FsEntry[],
  existingChildren: TreeNode[] | null,
): TreeNode[] {
  const existingMap = new Map<string, TreeNode>();
  if (existingChildren) {
    for (const child of existingChildren) {
      existingMap.set(child.path, child);
    }
  }
  return entries.map((e) => {
    const prev = existingMap.get(e.path);
    return {
      name: e.name,
      path: e.path,
      is_dir: e.is_dir,
      expanded: prev?.expanded ?? false,
      children: prev?.children ?? (e.is_dir ? [] : null),
      is_gitignored: e.is_gitignored,
      extension: e.extension,
    };
  });
}

/**
 * Recursively update a node by path. Returns a new array.
 */
export function updateNode(
  nodes: TreeNode[],
  targetPath: string,
  updater: (node: TreeNode) => TreeNode,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return updater(node);
    }
    if (node.children) {
      const updated = updateNode(node.children, targetPath, updater);
      if (updated !== node.children) {
        return { ...node, children: updated };
      }
    }
    return node;
  });
}

/**
 * Load entries for a path and merge with existing nodes.
 */
export async function loadTreeNodes(
  dirPath: string,
  existingChildren: TreeNode[] | null,
  readEntries: (path: string) => Promise<FsEntry[] | null>,
): Promise<TreeNode[] | null> {
  const entries = await readEntries(dirPath);
  if (entries === null) return null;
  return entriesToNodes(entries, existingChildren);
}

/**
 * Flatten the tree into a visible row list for virtualized rendering.
 * If a create-input is active under `creatingParent`, inject an "input"
 * row just after that parent.
 */
export function flattenVisible(
  nodes: TreeNode[],
  projectPath: string,
  creating: { parentPath: string; kind: CreateKind } | null,
): FlatEntry[] {
  const result: FlatEntry[] = [];
  const seen = new Set<string>();

  function walk(list: TreeNode[], depth: number) {
    for (const node of list) {
      if (seen.has(node.path)) continue;
      seen.add(node.path);
      result.push({ kind: "node", node, depth });

      // Inject create-input row right after this directory if it's the creating parent.
      if (
        creating &&
        node.path === creating.parentPath &&
        node.is_dir &&
        (node.expanded || node.path === projectPath)
      ) {
        result.push({ kind: "input", depth: depth + 1, createKind: creating.kind });
      }

      if (node.expanded && node.children) {
        walk(node.children, depth + 1);
      }
    }
  }

  walk(nodes, 0);
  return result;
}
