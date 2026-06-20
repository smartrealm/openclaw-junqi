// ── Git subsystem barrel export ────────────────────────────────────────────────

export { GitChanges } from "./GitChanges";
export { GitHistory } from "./GitHistory";
export { GitDiffViewer } from "./GitDiffViewer";
export { GitFileBrowser, GitFileViewToggle, useGitFileViewMode } from "./GitFileBrowser";
export { DiffFileBlock } from "./DiffFileBlock";
export { parseDiff } from "./parseDiff";

export type {
  GitFileChange,
  GitCommit,
  GitCommitFile,
  GitCommitDetail,
  GitRemoteCounts,
  GitBranchInfo,
  GitDirectoryActionTarget,
  DiffViewMode,
  DiffHunkLine,
  DiffHunk,
  DiffFile,
  FileViewMode,
  GitFileBrowserScrollContext,
} from "./types";
