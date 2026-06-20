// ── Shared types for the Git subsystem ─────────────────────────────────────────

export interface GitFileChange {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitCommit {
  hash: string;
  short_hash: string;
  author: string;
  date: string;
  message: string;
  refs: string[];
}

export interface GitCommitFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface GitCommitDetail {
  hash: string;
  short_hash: string;
  author: string;
  date: string;
  message: string;
  files: GitCommitFile[];
  total_additions: number;
  total_deletions: number;
}

export interface GitRemoteCounts {
  ahead: number;
  behind: number;
  branch: string;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
}

export interface GitDirectoryActionTarget {
  name: string;
  filePaths: string[];
  staged: boolean;
  untracked: boolean;
}

// ── Diff types ────────────────────────────────────────────────────────────────

export type DiffViewMode = "unified" | "split";

export interface DiffHunkLine {
  kind: "context" | "add" | "delete" | "meta";
  text: string;
  oldLineNo?: number;
  newLineNo?: number;
  highlighted?: boolean;
}

export interface DiffHunk {
  header: string;
  lines: DiffHunkLine[];
}

export interface DiffFile {
  displayPath: string;
  oldPath: string;
  newPath: string;
  status: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  binary: boolean;
}

export type FileViewMode = "tree" | "list";

// ── File browser scroll context ───────────────────────────────────────────────

export interface GitFileBrowserScrollContext {
  containerRef: React.RefObject<HTMLDivElement | null>;
  scrollTop: number;
  viewportHeight: number;
  layoutKey: string;
}

// ── Git utility functions ─────────────────────────────────────────────────────

export function getGitStatusColor(status: string): string {
  switch (status) {
    case "A": return "#3fb950";
    case "D": return "#f85149";
    case "M": return "#e3b341";
    case "R": return "#79c0ff";
    case "?": return "#79c0ff";
    case "U": return "#f85149";
    default: return "#a4adc2";
  }
}

export function getGitStatusLabel(status: string): string {
  switch (status) {
    case "A": return "A";
    case "D": return "D";
    case "M": return "M";
    case "R": return "R";
    case "?": return "U";
    case "U": return "!";
    default: return status;
  }
}

export function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}
