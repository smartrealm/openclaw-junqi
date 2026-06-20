// ═══════════════════════════════════════════════════════════
// FileExplorer — shared types
// ═══════════════════════════════════════════════════════════

export const ROW_HEIGHT = 24;
export const AUTO_REFRESH_MS = 5_000;

export type CreateKind = "file" | "folder";

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  extension: string | null;
  is_gitignored: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  expanded: boolean;
  children: TreeNode[] | null;
  is_gitignored: boolean;
  extension: string | null;
}

export interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
  isRoot: boolean;
}

export interface FlatRow {
  kind: "node";
  node: TreeNode;
  depth: number;
}

export interface FlatInputRow {
  kind: "input";
  depth: number;
  createKind: CreateKind;
}

export type FlatEntry = FlatRow | FlatInputRow;
